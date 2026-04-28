import fs from 'node:fs';
import path from 'node:path';
import { execaCommand } from 'execa';
import { ArtifactStore } from '../artifact/store.js';
import { createId, nowIso } from '../ids.js';
import { readJsonFile, readJsonIfExists, writeJsonFile } from '../json.js';
import { restoreAttemptSchema, type RestoreAttempt } from '../schema.js';
import { waitForRoute } from '../react/project.js';
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
  blockedReason?: string;
};

export async function runRestoreAttempt(options: RestoreOptions, store = new ArtifactStore({ workspaceRoot: options.projectRoot })): Promise<RestoreResult> {
  const run = store.readRun(options.runId);
  const specRef = run.artifactRefs.find((artifact) => artifact.kind === 'fidelity-spec');
  const specPath = specRef ? store.resolveArtifactPath(specRef.path) : store.getRunFile(options.runId, 'fidelity-spec.json');
  if (!fs.existsSync(specPath)) throw new Error(`Missing fidelity spec for run ${options.runId}. Run build-ir first.`);

  const attemptIndex = nextAttemptIndex(store, options.runId);
  const attemptId = createId('attempt');
  const attemptDir = path.join(store.getRunDir(options.runId), 'restore', 'attempts', String(attemptIndex).padStart(3, '0'));
  const attempt: RestoreAttempt = restoreAttemptSchema.parse({
    attemptId,
    index: attemptIndex,
    startedAt: nowIso(),
    status: 'running',
  });
  writeJsonFile(path.join(attemptDir, 'attempt.json'), attempt);

  let devProcess: ReturnType<typeof execaCommand> | null = null;
  try {
    if (options.devCommand) {
      devProcess = execaCommand(options.devCommand, { cwd: options.projectRoot, stdio: 'pipe' });
      await waitForRoute(options.route, { timeoutMs: 60000 });
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
    const completed = restoreAttemptSchema.parse({
      ...attempt,
      completedAt: nowIso(),
      status: report.status === 'passed' ? 'passed' : plan.status === 'blocked' ? 'blocked' : 'failed',
      reportPath,
      repairPlanPath: planPath,
    });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), completed);
    appendAttempt(store, options.runId, completed, report.fullPage.diffRatio);
    const plateau = detectPlateau(store, options.runId);
    if (report.status !== 'passed' && plateau) {
      const blockedReason = 'blocked-no-improvement: full-page diff did not improve across the latest attempts';
      const blockedPlan = { ...plan, status: 'blocked' as const, blockedReason, summary: blockedReason };
      writeJsonFile(planPath, blockedPlan);
      return { status: 'blocked', attempt: completed, reportPath, repairPlanPath: planPath, blockedReason };
    }
    if (report.status === 'passed') return { status: 'passed', attempt: completed, reportPath, repairPlanPath: planPath };
    if (plan.status === 'blocked') {
      return { status: 'blocked', attempt: completed, reportPath, repairPlanPath: planPath, ...(plan.blockedReason ? { blockedReason: plan.blockedReason } : {}) };
    }
    return { status: 'needs-agent-patch', attempt: completed, reportPath, repairPlanPath: planPath };
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

type RestoreState = { attempts: Array<RestoreAttempt & { fullPageDiffRatio?: number }> };

function nextAttemptIndex(store: ArtifactStore, runId: string): number {
  const state = readRestoreState(store, runId);
  return state.attempts.length + 1;
}

function readRestoreState(store: ArtifactStore, runId: string): RestoreState {
  const statePath = path.join(store.getRunDir(runId), 'restore', 'state.json');
  return readJsonIfExists<RestoreState>(statePath) || { attempts: [] };
}

function appendAttempt(store: ArtifactStore, runId: string, attempt: RestoreAttempt, diffRatio: number): void {
  const state = readRestoreState(store, runId);
  state.attempts.push({ ...attempt, fullPageDiffRatio: diffRatio });
  writeJsonFile(path.join(store.getRunDir(runId), 'restore', 'state.json'), state);
}

function detectPlateau(store: ArtifactStore, runId: string): boolean {
  const state = readRestoreState(store, runId);
  if (state.attempts.length < 3) return false;
  const latest = state.attempts.slice(-3).map((attempt) => attempt.fullPageDiffRatio).filter((value): value is number => typeof value === 'number');
  if (latest.length < 3) return false;
  return latest[2]! >= latest[0]! - 0.002 && latest[1]! >= latest[0]! - 0.002;
}
