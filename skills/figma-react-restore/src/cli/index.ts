#!/usr/bin/env node
import path from 'node:path';
import { Command } from 'commander';
import { ArtifactStore } from '../artifact/store.js';
import { buildMinimalDesignIr } from '../ir/build.js';
import { buildFidelitySpec } from '../ir/spec.js';
import { runDoctor } from '../doctor/index.js';
import { readJsonFile } from '../json.js';
import { DEFAULT_PORT } from '../paths.js';
import { createRepairPlanFromFile } from '../restore/repair-plan.js';
import { runRestoreAttempt } from '../restore/loop.js';
import { readServiceLock } from '../service/lockfile.js';
import { startRuntimeService } from '../service/index.js';
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
  .option('--port <port>', 'Service port', parseIntOption, DEFAULT_PORT)
  .option('--token <token>', 'Explicit token for automation')
  .action(wrap(async (options) => {
    startRuntimeService({ workspaceRoot: path.resolve(options.project), port: options.port, token: options.token });
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
  .action(wrap(async (options) => {
    const lock = requireLock(options.project);
    const create = await serviceFetch(lock, '/jobs', {
      method: 'POST',
      body: {
        capability: 'extract.selection',
        ...(options.session ? { sessionId: options.session } : {}),
        options: { screenshots: true, assets: true },
      },
    }) as { ok: boolean; job: { jobId: string } };
    const job = await waitForJob(lock, create.job.jobId, Number(options.timeout));
    printJson({ ok: true, runId: job.runId, job });
    if (job.status !== 'completed') process.exitCode = 1;
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
    printJson({ ok: true, runId: options.run, designIrPath: store.findArtifact(options.run, 'design-ir')?.path, fidelitySpecPath: store.findArtifact(options.run, 'fidelity-spec')?.path, evidenceLevel: ir.evidenceLevel, viewport: spec.viewport });
  }));

program.command('verify')
  .requiredOption('--project <dir>', 'React project root')
  .requiredOption('--route <url>', 'Route URL')
  .requiredOption('--spec <path>', 'Fidelity spec JSON path')
  .option('--output-dir <dir>', 'Output directory for screenshots/report')
  .option('--wait-ms <ms>', 'Extra wait before screenshot', parseIntOption, 0)
  .action(wrap(async (options) => {
    const verifyOptions = {
      projectRoot: path.resolve(options.project),
      route: options.route,
      specPath: path.resolve(options.spec),
      waitMs: Number(options.waitMs),
      ...(options.outputDir ? { outputDir: path.resolve(options.outputDir) } : {}),
    };
    const result = await runVerification(verifyOptions);
    printJson({ ok: result.report.status === 'passed', reportPath: result.reportPath, report: result.report });
    if (result.report.status !== 'passed') process.exitCode = 1;
  }));

program.command('repair-plan')
  .requiredOption('--report <path>', 'Verify report JSON path')
  .option('--output <path>', 'Repair plan output path')
  .action(wrap(async (options) => {
    const { plan, planPath } = createRepairPlanFromFile(path.resolve(options.report), options.output ? path.resolve(options.output) : undefined);
    printJson({ ok: plan.status !== 'blocked', planPath, plan });
    if (plan.status === 'blocked') process.exitCode = 1;
  }));

program.command('restore')
  .requiredOption('--project <dir>', 'React project root')
  .requiredOption('--route <url>', 'Route URL')
  .requiredOption('--run <runId>', 'Extraction/build-ir run id')
  .option('--dev-command <cmd>', 'Command to start the React dev server')
  .option('--wait-ms <ms>', 'Extra wait before screenshot', parseIntOption, 0)
  .action(wrap(async (options) => {
    const projectRoot = path.resolve(options.project);
    const result = await runRestoreAttempt({
      projectRoot,
      route: options.route,
      runId: options.run,
      devCommand: options.devCommand,
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

function requireLock(projectRoot: string): ServiceLock {
  const lock = readServiceLock(path.resolve(projectRoot));
  if (!lock) throw new Error('Runtime service is not running. Run figma-react-restore service start.');
  return lock;
}

async function serviceFetch(lock: ServiceLock, endpoint: string, options: { method?: string; body?: unknown } = {}): Promise<unknown> {
  const init: RequestInit = {
    method: options.method || 'GET',
    headers: { authorization: `Bearer ${lock.token}`, ...(options.body ? { 'content-type': 'application/json' } : {}) },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Timed out waiting for extraction job ${jobId}`);
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
