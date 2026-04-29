#!/usr/bin/env node
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { ArtifactStore } from '../artifact/store.js';
import { buildMinimalDesignIr } from '../ir/build.js';
import { buildFidelitySpec } from '../ir/spec.js';
import { runDoctor } from '../doctor/index.js';
import { readJsonFile } from '../json.js';
import { DEFAULT_PORT } from '../paths.js';
import { createRepairPlanFromFile } from '../restore/repair-plan.js';
import { assertReactProjectRoot } from '../react/project.js';
import { runRestoreAttempt } from '../restore/loop.js';
import { startDevRuntimeService } from '../service/dev.js';
import { isServiceLockAlive, readServiceLock, removeServiceLock } from '../service/lockfile.js';
import { startRuntimeService } from '../service/index.js';
import { readServiceHealth, stopRuntimeService, validateServiceHealth } from '../service/control.js';
import { createAgentBriefFromFiles, createCliSummary } from '../summary/agent-brief.js';
import { runVerification } from '../verify/report.js';

const program = new Command();

program
  .name('figma-react-restore')
  .description('Agent-oriented Figma to React restoration runtime')
  .version('0.1.0');

program.command('doctor')
  .option('--project <dir>', 'React project root', process.cwd())
  .option('--route <url>', 'Route URL to check')
  .option('--skip-browser', 'Skip Playwright browser launch check')
  .action(wrap(async (options) => {
    const report = await runDoctor({ projectRoot: options.project, route: options.route, checkBrowser: !options.skipBrowser });
    printJson(report);
    if (!report.ok) process.exitCode = 1;
  }));

const service = program.command('service').description('Runtime service commands');
service.command('start')
  .option('--project <dir>', 'Workspace/project root', process.cwd())
  .option('--silent', 'Do not print startup JSON')
  .action(wrap(async (options) => {
    const projectRoot = path.resolve(options.project);
    assertReactProjectRoot(projectRoot);
    startRuntimeService({ workspaceRoot: projectRoot, port: DEFAULT_PORT, silent: Boolean(options.silent) });
  }));
service.command('dev')
  .description('Start runtime service with TypeScript watch rebuild and automatic service restart')
  .option('--project <dir>', 'Workspace/project root', process.cwd())
  .option('--no-compile', 'Do not run tsc --watch; only restart when dist files change')
  .action(wrap(async (options) => {
    const projectRoot = path.resolve(options.project);
    assertReactProjectRoot(projectRoot);
    startDevRuntimeService({
      projectRoot,
      port: DEFAULT_PORT,
      compile: options.compile,
    });
  }));
service.command('stop')
  .description('Stop the runtime service for a project')
  .option('--project <dir>', 'Workspace/project root', process.cwd())
  .option('--force', 'Stop even when extraction jobs are active')
  .option('--timeout <ms>', 'Health and shutdown timeout', parseIntOption, 5000)
  .action(wrap(async (options) => {
    const result = await stopRuntimeService({
      projectRoot: path.resolve(options.project),
      force: Boolean(options.force),
      timeoutMs: Number(options.timeout),
    });
    printJson(result);
    if (!result.ok) process.exitCode = 1;
  }));

program.command('sessions')
  .option('--project <dir>', 'Workspace/project root', process.cwd())
  .action(wrap(async (options) => {
    const lock = requireLock(options.project);
    printJson(await serviceFetch(lock, '/sessions'));
  }));

program.command('extract')
  .requiredOption('--selection', 'Extract the current Figma selection')
  .option('--project <dir>', 'Workspace/project root', process.cwd())
  .option('--session <id>', 'Plugin session id')
  .option('--timeout <ms>', 'Wait timeout', parseIntOption, 120000)
  .option('--manage-service', 'Start the runtime service if needed and stop it when extraction finishes')
  .option('--stop-service-after', 'Stop the runtime service after extraction finishes')
  .option('--wait-session <ms>', 'Wait for a plugin session before creating the extraction job')
  .action(wrap(async (options) => {
    const projectRoot = path.resolve(options.project);
    const managed = Boolean(options.manageService);
    const managedService = managed ? await ensureManagedService(projectRoot) : null;
    const shouldStopService = Boolean(options.stopServiceAfter) || Boolean(managedService?.started);
    let cleanupDone = false;
    try {
      const lock = managedService?.lock || requireLock(projectRoot);
      const waitSessionMs = options.waitSession === undefined
        ? (managed ? 60000 : 0)
        : parseIntOption(String(options.waitSession));
      if (waitSessionMs > 0) {
        await waitForPluginSession(lock, { sessionId: options.session, timeoutMs: waitSessionMs });
      }
      const create = await serviceFetch(lock, '/jobs', {
        method: 'POST',
        body: {
          capability: 'extract.selection',
          ...(options.session ? { sessionId: options.session } : {}),
          options: { screenshots: true, assets: true },
        },
      }) as { ok: boolean; job: { jobId: string } };
      const job = await waitForJob(lock, create.job.jobId, Number(options.timeout));
      const serviceStop = shouldStopService
        ? await stopRuntimeService({ projectRoot, force: Boolean(managedService?.started), timeoutMs: 5000 })
        : undefined;
      cleanupDone = true;
      printJson({ ok: job.status === 'completed' && (serviceStop ? serviceStop.ok : true), runId: job.runId, job, ...(serviceStop ? { serviceStop } : {}) });
      if (job.status !== 'completed' || serviceStop?.ok === false) process.exitCode = 1;
    } finally {
      if (shouldStopService && !cleanupDone) {
        const serviceStop = await stopRuntimeService({ projectRoot, force: Boolean(managedService?.started), timeoutMs: 5000 });
        if (!serviceStop.ok) process.stderr.write(`[figma-react-restore] failed to stop runtime service: ${serviceStop.message}\n`);
      }
    }
  }));

program.command('build-ir')
  .requiredOption('--run <runId>', 'Extraction run id')
  .option('--project <dir>', 'Workspace/project root', process.cwd())
  .option('--route <url>', 'Route URL to embed in fidelity spec', '')
  .option('--viewport <size>', 'Viewport WIDTHxHEIGHT, defaults to frame size')
  .option('--dpr <number>', 'Device pixel ratio', parseFloatOption, 1)
  .action(wrap(async (options) => {
    const store = new ArtifactStore({ workspaceRoot: options.project });
    const ir = buildMinimalDesignIr(options.run, store);
    const viewport = parseViewport(options.viewport, options.dpr);
    const spec = buildFidelitySpec({ runId: options.run, ir, route: options.route, viewport, store });
    printJson({
      ok: true,
      runId: options.run,
      designIrPath: store.findArtifact(options.run, 'design-ir')?.path,
      textManifestPath: store.findArtifact(options.run, 'text-manifest')?.path,
      fidelitySpecPath: store.findArtifact(options.run, 'fidelity-spec')?.path,
      evidenceLevel: ir.evidenceLevel,
      viewport: spec.viewport,
    });
  }));

program.command('verify')
  .requiredOption('--project <dir>', 'React project root')
  .requiredOption('--route <url>', 'Route URL')
  .requiredOption('--spec <path>', 'Fidelity spec JSON path')
  .option('--output-dir <dir>', 'Output directory for screenshots/report')
  .option('--wait-ms <ms>', 'Extra wait before screenshot', parseIntOption, 0)
  .option('--full-report', 'Print full verify report instead of token-optimized summary')
  .action(wrap(async (options) => {
    const verifyOptions = {
      projectRoot: path.resolve(options.project),
      route: options.route,
      specPath: path.resolve(options.spec),
      waitMs: Number(options.waitMs),
      ...(options.outputDir ? { outputDir: path.resolve(options.outputDir) } : {}),
    };
    const result = await runVerification(verifyOptions);
    const { brief, briefPath } = createAgentBriefFromFiles({ reportPath: result.reportPath });
    printJson({
      ok: result.report.status === 'passed',
      reportPath: result.reportPath,
      briefPath,
      summary: createCliSummary(brief),
      ...(options.fullReport ? { report: result.report } : {}),
    });
    if (result.report.status !== 'passed') process.exitCode = 1;
  }));

program.command('repair-plan')
  .requiredOption('--report <path>', 'Verify report JSON path')
  .option('--output <path>', 'Repair plan output path')
  .option('--full-plan', 'Print full repair plan instead of token-optimized summary')
  .action(wrap(async (options) => {
    const reportPath = path.resolve(options.report);
    const { plan, planPath } = createRepairPlanFromFile(reportPath, options.output ? path.resolve(options.output) : undefined);
    const { brief, briefPath } = createAgentBriefFromFiles({ reportPath, planPath });
    printJson({
      ok: plan.status !== 'blocked',
      planPath,
      briefPath,
      summary: createCliSummary(brief),
      ...(options.fullPlan ? { plan } : {}),
    });
    if (plan.status === 'blocked') process.exitCode = 1;
  }));

program.command('brief')
  .description('Create a token-optimized agent brief from verify report and optional repair plan')
  .requiredOption('--report <path>', 'Verify report JSON path')
  .option('--plan <path>', 'Repair plan JSON path; defaults to sibling repair-plan.json when present')
  .option('--output <path>', 'Agent brief output path; defaults to sibling agent-brief.json')
  .option('--max-failures <count>', 'Maximum top failures to include', parseIntOption, 10)
  .action(wrap(async (options) => {
    const { brief, briefPath } = createAgentBriefFromFiles({
      reportPath: path.resolve(options.report),
      ...(options.plan ? { planPath: path.resolve(options.plan) } : {}),
      ...(options.output ? { outputPath: path.resolve(options.output) } : {}),
      maxFailures: Number(options.maxFailures),
    });
    printJson({ ok: true, briefPath, summary: createCliSummary(brief) });
  }));

program.command('restore')
  .requiredOption('--project <dir>', 'React project root')
  .requiredOption('--route <url>', 'Route URL')
  .requiredOption('--run <runId>', 'Extraction/build-ir run id')
  .option('--dev-command <cmd>', 'Command to start the React dev server')
  .option('--max-iterations <count>', 'Maximum restore attempts before blocking', parseIntOption, 3)
  .option('--wait-ms <ms>', 'Extra wait before screenshot', parseIntOption, 0)
  .action(wrap(async (options) => {
    const projectRoot = path.resolve(options.project);
    const result = await runRestoreAttempt({
      projectRoot,
      route: options.route,
      runId: options.run,
      devCommand: options.devCommand,
      maxIterations: Number(options.maxIterations),
      waitMs: Number(options.waitMs),
    }, new ArtifactStore({ workspaceRoot: projectRoot }));
    printJson({ ok: result.status === 'passed', ...result });
    if (result.status !== 'passed') process.exitCode = 1;
  }));

program.command('read')
  .description('Read a JSON artifact or run file')
  .requiredOption('--path <path>', 'File path')
  .action(wrap(async (options) => {
    printJson(readJsonFile(path.resolve(options.path)));
  }));

program.parseAsync(process.argv).catch((error: unknown) => {
  printJson({ ok: false, error: error instanceof Error ? { code: 'ERROR', message: error.message, stack: process.env.DEBUG ? error.stack : undefined } : { code: 'ERROR', message: String(error) } });
  process.exitCode = 1;
});

type ServiceLock = NonNullable<ReturnType<typeof readServiceLock>>;

type ServiceJob = {
  jobId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'canceled';
  runId?: string;
  error?: unknown;
};

type ManagedService = {
  lock: ServiceLock;
  started: boolean;
  child?: ChildProcess;
};

type RuntimeSessionSummary = {
  pluginSessionId: string;
  connected?: boolean;
};

function requireLock(projectRoot: string): ServiceLock {
  const lock = readServiceLock(path.resolve(projectRoot));
  if (!lock) throw new Error('Runtime service is not running. Run figma-react-restore service start.');
  return lock;
}

async function ensureManagedService(projectRoot: string): Promise<ManagedService> {
  const existing = await readUsableServiceLock(projectRoot);
  if (existing) return { lock: existing, started: false };

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'service', 'start', '--project', projectRoot, '--silent'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  child.stdout?.on('data', (chunk) => process.stderr.write(String(chunk)));
  child.stderr?.on('data', (chunk) => process.stderr.write(String(chunk)));
  const cleanup = () => {
    if (child.exitCode === null) child.kill('SIGTERM');
  };
  process.once('SIGINT', cleanup);
  process.once('SIGTERM', cleanup);

  try {
    const lock = await waitForRuntimeService(projectRoot, child, 5000);
    return { lock, started: true, child };
  } catch (error) {
    cleanup();
    throw error;
  }
}

async function readUsableServiceLock(projectRoot: string): Promise<ServiceLock | null> {
  const lock = readServiceLock(projectRoot);
  if (!lock) return null;
  try {
    const health = await readServiceHealth(lock, 500);
    const mismatch = validateServiceHealth(lock, health);
    if (mismatch) throw new Error(mismatch);
    return lock;
  } catch (error) {
    if (!isServiceLockAlive(lock)) {
      removeServiceLock(projectRoot);
      return null;
    }
    throw new Error(`Existing runtime service could not be verified: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function waitForRuntimeService(projectRoot: string, child: ChildProcess, timeoutMs: number): Promise<ServiceLock> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const lock = readServiceLock(projectRoot);
    if (lock) {
      try {
        const health = await readServiceHealth(lock, 500);
        const mismatch = validateServiceHealth(lock, health);
        if (!mismatch) return lock;
      } catch {
        // Keep polling until the child exits or the timeout is reached.
      }
    }
    if (child.exitCode !== null) throw new Error(`Managed runtime service exited before becoming healthy with code ${child.exitCode}`);
    await delay(100);
  }
  throw new Error(`Timed out waiting for managed runtime service at http://localhost:${DEFAULT_PORT}`);
}

async function waitForPluginSession(lock: ServiceLock, options: { sessionId?: string; timeoutMs: number }): Promise<void> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const data = await serviceFetch(lock, '/sessions') as { sessions?: RuntimeSessionSummary[] };
    const sessions = data.sessions || [];
    const connected = sessions.filter((session) => session.connected);
    if (options.sessionId) {
      if (connected.some((session) => session.pluginSessionId === options.sessionId)) return;
    } else if (connected.length > 0) {
      return;
    }
    await delay(1000);
  }
  const target = options.sessionId ? `plugin session ${options.sessionId}` : 'a plugin session';
  throw new Error(`Timed out waiting for ${target}. Open the Figma React Restore development plugin and keep it open.`);
}

async function serviceFetch(lock: ServiceLock, endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const init: RequestInit = {
    method: options.method || 'GET',
    ...(options.body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(options.body) } : {}),
  };
  const response = await fetch(`${lock.url}${endpoint}`, init);
  const data = await response.json() as unknown;
  if (!response.ok) throw new Error(JSON.stringify(data));
  return data;
}

async function waitForJob(lock: ServiceLock, jobId: string, timeoutMs: number): Promise<ServiceJob> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const data = await serviceFetch(lock, `/jobs/${jobId}`) as { job: ServiceJob };
    if (data.job.status === 'completed' || data.job.status === 'failed' || data.job.status === 'canceled') return data.job;
    await delay(1000);
  }
  throw new Error(`Timed out waiting for extraction job ${jobId}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function printJson(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function wrap<T extends unknown[]>(fn: (...args: T) => Promise<void>): (...args: T) => Promise<void> {
  return async (...args: T) => {
    try {
      await fn(...args);
    } catch (error: unknown) {
      printJson({ ok: false, error: error instanceof Error ? { code: 'ERROR', message: error.message } : { code: 'ERROR', message: String(error) } });
      process.exitCode = 1;
    }
  };
}

function parseIntOption(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) throw new Error(`Expected integer option, got ${value}`);
  return parsed;
}

function parseFloatOption(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected numeric option, got ${value}`);
  return parsed;
}

function parseViewport(value: string | undefined, dpr: number): { width?: number; height?: number; dpr?: number } {
  if (!value) return { dpr };
  const match = /^(\d+)x(\d+)$/i.exec(value.trim());
  if (!match) throw new Error('Viewport must be WIDTHxHEIGHT, for example 1440x900');
  return { width: Number(match[1]), height: Number(match[2]), dpr };
}
