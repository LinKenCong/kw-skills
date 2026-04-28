import fs from 'node:fs';
import path from 'node:path';
import { execaCommand } from 'execa';
import { ArtifactStore } from '../artifact/store.js';
import { createId, nowIso } from '../ids.js';
import { readJsonIfExists, writeJsonFile } from '../json.js';
import { relativeArtifactPath } from '../paths.js';
import { repairPlanSchema, restoreAttemptSchema, type RestoreAttempt, type VerifyReport } from '../schema.js';
import { waitForRoute } from '../react/project.js';
import { createAgentBriefFromFiles } from '../summary/agent-brief.js';
import { runVerification } from '../verify/report.js';
import { createRepairPlanFromFile } from './repair-plan.js';

export type RestoreOptions = {
  projectRoot: string;
  route: string;
  runId: string;
  devCommand?: string;
  maxIterations?: number;
  waitMs?: number;
};

export type RestoreResult = {
  status: 'passed' | 'needs-agent-patch' | 'blocked';
  attempt: RestoreAttempt;
  reportPath?: string;
  repairPlanPath?: string;
  agentBriefPath?: string;
  blockedReason?: string;
};

const DEFAULT_MAX_ITERATIONS = 3;

export async function runRestoreAttempt(options: RestoreOptions, store = new ArtifactStore({ workspaceRoot: options.projectRoot })): Promise<RestoreResult> {
  const run = store.readRun(options.runId);
  const specRef = run.artifactRefs.find((artifact) => artifact.kind === 'fidelity-spec');
  const specPath = specRef ? store.resolveArtifactPath(specRef.path) : store.getRunFile(options.runId, 'fidelity-spec.json');
  if (!fs.existsSync(specPath)) throw new Error(`Missing fidelity spec for run ${options.runId}. Run build-ir first.`);

  const attemptIndex = nextAttemptIndex(store, options.runId);
  const maxIterations = options.maxIterations || DEFAULT_MAX_ITERATIONS;
  const attemptId = createId('attempt');
  const attemptDir = path.join(store.getRunDir(options.runId), 'restore', 'attempts', String(attemptIndex).padStart(3, '0'));
  const attempt: RestoreAttempt = restoreAttemptSchema.parse({
    attemptId,
    index: attemptIndex,
    startedAt: nowIso(),
    status: 'running',
  });
  writeJsonFile(path.join(attemptDir, 'attempt.json'), attempt);
  if (attemptIndex > maxIterations) {
    const blockedReason = `blocked-max-iterations: restore already reached ${maxIterations} attempts`;
    const blocked = restoreAttemptSchema.parse({ ...attempt, completedAt: nowIso(), status: 'blocked' });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), blocked);
    writeFinalReport(store, options.runId, { status: 'blocked', attempt: blocked, blockedReason });
    return { status: 'blocked', attempt: blocked, blockedReason };
  }

  let devProcess: ReturnType<typeof execaCommand> | null = null;
  try {
    if (options.devCommand) {
      devProcess = execaCommand(options.devCommand, { cwd: options.projectRoot, stdio: 'pipe' });
      await waitForRoute(options.route, { timeoutMs: 60000 }).catch(() => undefined);
    }
    const verifyOptions = {
      projectRoot: options.projectRoot,
      route: options.route,
      specPath,
      outputDir: attemptDir,
      attemptId,
      ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
    };
    const { report, reportPath } = await runVerification(verifyOptions);
    const { plan, planPath } = createRepairPlanFromFile(reportPath, path.join(attemptDir, 'repair-plan.json'));
    const briefPath = path.join(attemptDir, 'agent-brief.json');
    createAgentBriefFromFiles({ reportPath, planPath, outputPath: briefPath });
    recordAttemptArtifacts(store, options.runId, report, reportPath, planPath, briefPath, attemptDir);
    const completed = restoreAttemptSchema.parse({
      ...attempt,
      completedAt: nowIso(),
      status: report.status === 'passed' ? 'passed' : plan.status === 'blocked' ? 'blocked' : 'failed',
      reportPath,
      repairPlanPath: planPath,
      agentBriefPath: briefPath,
    });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), completed);
    appendAttempt(store, options.runId, completed, report);
    const plateauReason = detectPlateau(store, options.runId);
    if (report.status !== 'passed' && plateauReason) {
      const blockedReason = `blocked-no-improvement: ${plateauReason}`;
      const blockedPlan = repairPlanSchema.parse({ ...plan, status: 'blocked' as const, blockedReason, summary: blockedReason });
      writeJsonFile(planPath, blockedPlan);
      createAgentBriefFromFiles({ reportPath, planPath, outputPath: briefPath });
      const result = { status: 'blocked' as const, attempt: completed, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, blockedReason };
      writeFinalReport(store, options.runId, result);
      return result;
    }
    if (report.status !== 'passed' && completed.index >= maxIterations) {
      const blockedReason = `blocked-max-iterations: reached ${maxIterations} restore attempts`;
      const blockedPlan = repairPlanSchema.parse({ ...plan, status: 'blocked' as const, blockedReason, summary: blockedReason });
      writeJsonFile(planPath, blockedPlan);
      createAgentBriefFromFiles({ reportPath, planPath, outputPath: briefPath });
      const blockedAttempt = restoreAttemptSchema.parse({ ...completed, status: 'blocked' });
      writeJsonFile(path.join(attemptDir, 'attempt.json'), blockedAttempt);
      const result = { status: 'blocked' as const, attempt: blockedAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, blockedReason };
      writeFinalReport(store, options.runId, result);
      return result;
    }
    if (report.status === 'passed') {
      const result = { status: 'passed' as const, attempt: completed, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath };
      writeFinalReport(store, options.runId, result);
      return result;
    }
    if (plan.status === 'blocked') {
      const result = { status: 'blocked' as const, attempt: completed, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, ...(plan.blockedReason ? { blockedReason: plan.blockedReason } : {}) };
      writeFinalReport(store, options.runId, result);
      return result;
    }
    const result = { status: 'needs-agent-patch' as const, attempt: completed, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath };
    writeFinalReport(store, options.runId, result);
    return result;
  } catch (error) {
    const failed = restoreAttemptSchema.parse({ ...attempt, completedAt: nowIso(), status: 'blocked' });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), failed);
    throw error;
  } finally {
    if (devProcess) {
      devProcess.kill('SIGTERM');
    }
  }
}

type RestoreState = { attempts: Array<RestoreAttempt & { fullPageDiffRatio?: number; failedTextCount?: number }> };

function nextAttemptIndex(store: ArtifactStore, runId: string): number {
  const state = readRestoreState(store, runId);
  return state.attempts.length + 1;
}

function readRestoreState(store: ArtifactStore, runId: string): RestoreState {
  const statePath = path.join(store.getRunDir(runId), 'restore', 'state.json');
  return readJsonIfExists<RestoreState>(statePath) || { attempts: [] };
}

function appendAttempt(store: ArtifactStore, runId: string, attempt: RestoreAttempt, report: VerifyReport): void {
  const state = readRestoreState(store, runId);
  state.attempts.push({
    ...attempt,
    fullPageDiffRatio: report.fullPage.diffRatio,
    failedTextCount: report.textResults.filter((result) => result.status === 'failed' || result.status === 'missing' || result.status === 'mapping-missing').length,
  });
  writeJsonFile(path.join(store.getRunDir(runId), 'restore', 'state.json'), state);
}

function detectPlateau(store: ArtifactStore, runId: string): string | null {
  const state = readRestoreState(store, runId);
  const latest = state.attempts.slice(-3).map((attempt) => attempt.fullPageDiffRatio).filter((value): value is number => typeof value === 'number');
  if (detectPlateauForRatios(latest)) return 'full-page diff did not improve across the latest attempts';
  const textCounts = state.attempts.slice(-3).map((attempt) => attempt.failedTextCount).filter((value): value is number => typeof value === 'number');
  if (detectTextPlateau(textCounts)) return 'exact text-content failures did not decrease across the latest attempts';
  return null;
}

export function detectPlateauForRatios(values: number[]): boolean {
  if (values.length < 3) return false;
  const latest = values.slice(-3);
  return latest[2]! >= latest[0]! - 0.002 && latest[1]! >= latest[0]! - 0.002;
}

export function detectTextPlateau(values: number[]): boolean {
  if (values.length < 3) return false;
  const latest = values.slice(-3);
  return latest[0]! > 0 && latest[1]! >= latest[0]! && latest[2]! >= latest[1]!;
}

function recordAttemptArtifacts(store: ArtifactStore, runId: string, report: VerifyReport, reportPath: string, planPath: string, briefPath: string, attemptDir: string): void {
  store.addArtifact(runId, {
    artifactId: createId('art'),
    kind: 'verify-report',
    path: relativeArtifactPath(store.artifactRoot, reportPath),
    mediaType: 'application/json',
  });
  store.addArtifact(runId, {
    artifactId: createId('art'),
    kind: 'repair-plan',
    path: relativeArtifactPath(store.artifactRoot, planPath),
    mediaType: 'application/json',
  });
  store.addArtifact(runId, {
    artifactId: createId('art'),
    kind: 'agent-brief',
    path: relativeArtifactPath(store.artifactRoot, briefPath),
    mediaType: 'application/json',
  });
  if (report.fullPage.diffPath) {
    store.addArtifact(runId, {
      artifactId: createId('art'),
      kind: 'diff',
      path: report.fullPage.diffPath,
      mediaType: 'image/png',
    });
  }
  const tracePath = path.join(attemptDir, 'trace.zip');
  if (fs.existsSync(tracePath)) {
    store.addArtifact(runId, {
      artifactId: createId('art'),
      kind: 'trace',
      path: relativeArtifactPath(store.artifactRoot, tracePath),
      mediaType: 'application/zip',
    });
  }
}

function writeFinalReport(store: ArtifactStore, runId: string, result: RestoreResult): void {
  writeJsonFile(path.join(store.getRunDir(runId), 'final-report.json'), {
    schemaVersion: 1,
    runId,
    completedAt: nowIso(),
    status: result.status,
    attempt: result.attempt,
    ...(result.reportPath ? { reportPath: relativeArtifactPath(store.artifactRoot, result.reportPath) } : {}),
    ...(result.repairPlanPath ? { repairPlanPath: relativeArtifactPath(store.artifactRoot, result.repairPlanPath) } : {}),
    ...(result.agentBriefPath ? { agentBriefPath: relativeArtifactPath(store.artifactRoot, result.agentBriefPath) } : {}),
    ...(result.blockedReason ? { blockedReason: result.blockedReason } : {}),
  });
}
