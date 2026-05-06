import fs from 'node:fs';
import path from 'node:path';
import { execaCommand } from 'execa';
import sharp from 'sharp';
import { ArtifactStore } from '../artifact/store.js';
import { createId, nowIso } from '../ids.js';
import { readJsonIfExists, writeJsonFile } from '../json.js';
import { relativeArtifactPath } from '../paths.js';
import { repairPlanSchema, restoreAttemptSchema, type RestoreAttempt, type VerifyReport } from '../schema.js';
import { waitForRoute } from '../react/project.js';
import { normalizeServiceError } from '../service/errors.js';
import { createAgentBriefFromFiles } from '../summary/agent-brief.js';
import { createImplementationBriefFromFiles } from '../summary/implementation-brief.js';
import { runVerification, type ResponsiveViewportSpec } from '../verify/report.js';
import { createRepairPlanFromFile } from './repair-plan.js';

export type RestoreOptions = {
  projectRoot: string;
  route: string;
  runId: string;
  devCommand?: string;
  maxIterations?: number;
  waitMs?: number;
  responsiveSmoke?: boolean;
  responsiveViewports?: ResponsiveViewportSpec[];
  archiveFinalArtifacts?: boolean;
};

export type RestoreResult = {
  status: 'passed' | 'needs-agent-patch' | 'needs-initial-implementation' | 'blocked';
  attempt: RestoreAttempt;
  reportPath?: string;
  repairPlanPath?: string;
  agentBriefPath?: string;
  implementationBriefPath?: string;
  blockedReason?: string;
};

const DEFAULT_MAX_ITERATIONS = 3;
const DEV_COMMAND_SHUTDOWN_TIMEOUT_MS = 5000;

export async function runRestoreAttempt(options: RestoreOptions, store = new ArtifactStore({ workspaceRoot: options.projectRoot })): Promise<RestoreResult> {
  const run = store.readRun(options.runId);
  const specRef = run.artifactRefs.find((artifact) => artifact.kind === 'fidelity-spec');
  const specPath = specRef ? store.resolveArtifactPath(specRef.path) : store.getRunFile(options.runId, 'fidelity-spec.json');
  if (!fs.existsSync(specPath)) throw new Error(`Missing fidelity spec for run ${options.runId}. Run build-ir first.`);

  const state = readRestoreState(store, options.runId);
  const attemptIndex = nextAttemptIndex(state);
  const phase = nextAttemptPhase(state);
  const repairCount = countRepairAttemptsForHistory(state.attempts);
  const repairIndex = phase === 'repair' ? repairCount + 1 : undefined;
  const maxIterations = options.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const attemptId = createId('attempt');
  const attemptDir = path.join(store.getRunDir(options.runId), 'restore', 'attempts', String(attemptIndex).padStart(3, '0'));
  const attempt: RestoreAttempt = restoreAttemptSchema.parse({
    attemptId,
    index: attemptIndex,
    phase,
    ...(repairIndex ? { repairIndex } : {}),
    startedAt: nowIso(),
    status: 'running',
  });
  writeJsonFile(path.join(attemptDir, 'attempt.json'), attempt);
  if (phase === 'repair' && repairCount >= maxIterations) {
    const blockedReason = `blocked-max-iterations: restore already reached ${maxIterations} repair attempts`;
    const blocked = restoreAttemptSchema.parse({ ...attempt, completedAt: nowIso(), status: 'blocked', resultStatus: 'blocked' });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), blocked);
    writeFinalReport(store, options.runId, { status: 'blocked', attempt: blocked, blockedReason }, options.archiveFinalArtifacts !== false);
    return { status: 'blocked', attempt: blocked, blockedReason };
  }

  let devProcess: ReturnType<typeof execaCommand> | null = null;
  try {
    if (options.devCommand) {
      devProcess = execaCommand(options.devCommand, {
        cwd: options.projectRoot,
        stdio: 'pipe',
        detached: true,
      });
      await waitForRoute(options.route, { timeoutMs: 60000 }).catch(() => undefined);
    }
    const verifyOptions = {
      projectRoot: options.projectRoot,
      route: options.route,
      specPath,
      outputDir: attemptDir,
      attemptId,
      ...(options.waitMs !== undefined ? { waitMs: options.waitMs } : {}),
      ...(options.responsiveSmoke ? { responsiveSmoke: options.responsiveSmoke } : {}),
      ...(options.responsiveViewports && options.responsiveViewports.length > 0 ? { responsiveViewports: options.responsiveViewports } : {}),
    };
    const { report, reportPath } = await runVerification(verifyOptions);
    const { plan, planPath } = createRepairPlanFromFile(reportPath, path.join(attemptDir, 'repair-plan.json'));
    const briefPath = path.join(attemptDir, 'agent-brief.json');
    createAgentBriefFromFiles({ reportPath, planPath, outputPath: briefPath });
    const implementationBriefPath = path.join(attemptDir, 'implementation-brief.json');
    createImplementationBriefFromFiles({
      reportPath,
      agentBriefPath: briefPath,
      outputPath: implementationBriefPath,
      projectRoot: options.projectRoot,
    });
    recordAttemptArtifacts(store, options.runId, report, reportPath, planPath, briefPath, attemptDir);
    const completed = restoreAttemptSchema.parse({
      ...attempt,
      completedAt: nowIso(),
      status: report.status === 'passed' ? 'passed' : plan.status === 'blocked' ? 'blocked' : 'failed',
      reportPath,
      repairPlanPath: planPath,
      agentBriefPath: briefPath,
      implementationBriefPath,
    });
    if (await shouldRequestInitialImplementation(completed, report, reportPath, store)) {
      const initialAttempt = restoreAttemptSchema.parse({ ...completed, resultStatus: 'needs-initial-implementation' });
      writeJsonFile(path.join(attemptDir, 'attempt.json'), initialAttempt);
      appendAttempt(store, options.runId, initialAttempt, report);
      const result = { status: 'needs-initial-implementation' as const, attempt: initialAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, implementationBriefPath };
      writeFinalReport(store, options.runId, result, options.archiveFinalArtifacts !== false);
      return result;
    }
    const plateauReason = phase === 'repair' ? detectPlateau(store, options.runId, completed, report) : null;
    if (report.status !== 'passed' && plateauReason) {
      const blockedReason = `blocked-no-improvement: ${plateauReason}`;
      const blockedPlan = repairPlanSchema.parse({ ...plan, status: 'blocked' as const, blockedReason, summary: blockedReason });
      writeJsonFile(planPath, blockedPlan);
      createAgentBriefFromFiles({ reportPath, planPath, outputPath: briefPath });
      createImplementationBriefFromFiles({ reportPath, agentBriefPath: briefPath, outputPath: implementationBriefPath, projectRoot: options.projectRoot });
      const blockedAttempt = restoreAttemptSchema.parse({ ...completed, status: 'blocked', resultStatus: 'blocked' });
      writeJsonFile(path.join(attemptDir, 'attempt.json'), blockedAttempt);
      appendAttempt(store, options.runId, blockedAttempt, report);
      const result = { status: 'blocked' as const, attempt: blockedAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, implementationBriefPath, blockedReason };
      writeFinalReport(store, options.runId, result, options.archiveFinalArtifacts !== false);
      return result;
    }
    if (report.status !== 'passed' && phase === 'repair' && repairIndex !== undefined && repairIndex >= maxIterations) {
      const blockedReason = `blocked-max-iterations: reached ${maxIterations} repair attempts`;
      const blockedPlan = repairPlanSchema.parse({ ...plan, status: 'blocked' as const, blockedReason, summary: blockedReason });
      writeJsonFile(planPath, blockedPlan);
      createAgentBriefFromFiles({ reportPath, planPath, outputPath: briefPath });
      createImplementationBriefFromFiles({ reportPath, agentBriefPath: briefPath, outputPath: implementationBriefPath, projectRoot: options.projectRoot });
      const blockedAttempt = restoreAttemptSchema.parse({ ...completed, status: 'blocked', resultStatus: 'blocked' });
      writeJsonFile(path.join(attemptDir, 'attempt.json'), blockedAttempt);
      appendAttempt(store, options.runId, blockedAttempt, report);
      const result = { status: 'blocked' as const, attempt: blockedAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, implementationBriefPath, blockedReason };
      writeFinalReport(store, options.runId, result, options.archiveFinalArtifacts !== false);
      return result;
    }
    if (report.status === 'passed') {
      const passedAttempt = restoreAttemptSchema.parse({ ...completed, resultStatus: 'passed' });
      writeJsonFile(path.join(attemptDir, 'attempt.json'), passedAttempt);
      appendAttempt(store, options.runId, passedAttempt, report);
      const result = { status: 'passed' as const, attempt: passedAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, implementationBriefPath };
      writeFinalReport(store, options.runId, result, options.archiveFinalArtifacts !== false);
      return result;
    }
    if (plan.status === 'blocked') {
      const blockedAttempt = restoreAttemptSchema.parse({ ...completed, resultStatus: 'blocked' });
      writeJsonFile(path.join(attemptDir, 'attempt.json'), blockedAttempt);
      appendAttempt(store, options.runId, blockedAttempt, report);
      const result = { status: 'blocked' as const, attempt: blockedAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, implementationBriefPath, ...(plan.blockedReason ? { blockedReason: plan.blockedReason } : {}) };
      writeFinalReport(store, options.runId, result, options.archiveFinalArtifacts !== false);
      return result;
    }
    const patchAttempt = restoreAttemptSchema.parse({ ...completed, resultStatus: 'needs-agent-patch' });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), patchAttempt);
    appendAttempt(store, options.runId, patchAttempt, report);
    const result = { status: 'needs-agent-patch' as const, attempt: patchAttempt, reportPath, repairPlanPath: planPath, agentBriefPath: briefPath, implementationBriefPath };
    writeFinalReport(store, options.runId, result, options.archiveFinalArtifacts !== false);
    return result;
  } catch (error) {
    const normalized = normalizeServiceError(error);
    const failed = restoreAttemptSchema.parse({
      ...attempt,
      completedAt: nowIso(),
      status: 'blocked',
      resultStatus: 'blocked',
      error: {
        code: normalized.code,
        message: normalized.message,
        recoverable: normalized.recoverable,
        ...(normalized.hint ? { hint: normalized.hint } : {}),
        ...(normalized.httpStatus ? { httpStatus: normalized.httpStatus } : {}),
      },
    });
    writeJsonFile(path.join(attemptDir, 'attempt.json'), failed);
    appendAttempt(store, options.runId, failed);
    writeFinalReport(store, options.runId, {
      status: 'blocked',
      attempt: failed,
      blockedReason: `blocked-error: ${normalized.code}`,
    }, options.archiveFinalArtifacts !== false);
    throw error;
  } finally {
    if (devProcess) {
      await terminateDevProcess(devProcess, DEV_COMMAND_SHUTDOWN_TIMEOUT_MS);
    }
  }
}

type RestoreState = {
  attempts: Array<RestoreAttempt & {
    fullPageDiffRatio?: number;
    failedTextCount?: number;
    errorCode?: string;
    errorMessage?: string;
  }>;
};

function nextAttemptIndex(state: RestoreState): number {
  return state.attempts.length + 1;
}

function readRestoreState(store: ArtifactStore, runId: string): RestoreState {
  const statePath = path.join(store.getRunDir(runId), 'restore', 'state.json');
  return readJsonIfExists<RestoreState>(statePath) || { attempts: [] };
}

function nextAttemptPhase(state: RestoreState): RestoreAttempt['phase'] {
  if (state.attempts.length === 0) return 'baseline';
  const latest = state.attempts.at(-1);
  if (!latest) return 'repair';
  if (latest.phase === 'baseline' && latest.status === 'blocked') return 'baseline';
  return 'repair';
}

type AttemptPhaseLike = { phase?: RestoreAttempt['phase'] };
type AttemptPlateauMetrics = AttemptPhaseLike & {
  fullPageDiffRatio?: number;
  failedTextCount?: number;
};

export function nextRestoreAttemptPhaseForHistory(attempts: AttemptPhaseLike[]): RestoreAttempt['phase'] {
  return nextAttemptPhase({ attempts: attempts as RestoreState['attempts'] });
}

function isRepairAttempt(attempt: AttemptPhaseLike): boolean {
  return attempt.phase === undefined || attempt.phase === 'repair';
}

export function countRepairAttemptsForHistory(attempts: AttemptPhaseLike[]): number {
  return attempts.filter(isRepairAttempt).length;
}

function appendAttempt(store: ArtifactStore, runId: string, attempt: RestoreAttempt, report?: VerifyReport): void {
  const state = readRestoreState(store, runId);
  state.attempts.push({
    ...attempt,
    ...(report ? {
      fullPageDiffRatio: report.fullPage.diffRatio,
      failedTextCount: report.textResults.filter((result) => result.status === 'failed' || result.status === 'missing' || result.status === 'mapping-missing').length,
    } : {}),
    ...(attempt.error ? {
      errorCode: attempt.error.code,
      errorMessage: attempt.error.message,
    } : {}),
  });
  writeJsonFile(path.join(store.getRunDir(runId), 'restore', 'state.json'), state);
}

function detectPlateau(store: ArtifactStore, runId: string, currentAttempt: RestoreAttempt, currentReport?: VerifyReport): string | null {
  const state = readRestoreState(store, runId);
  const candidate = {
    ...currentAttempt,
    ...(currentReport ? {
      fullPageDiffRatio: currentReport.fullPage.diffRatio,
      failedTextCount: currentReport.textResults.filter((result) => result.status === 'failed' || result.status === 'missing' || result.status === 'mapping-missing').length,
    } : {}),
  };
  return detectPlateauForAttemptHistory([...state.attempts, candidate]);
}

export function detectPlateauForAttemptHistory(attempts: AttemptPlateauMetrics[]): string | null {
  const repairAttempts = attempts.filter(isRepairAttempt);
  const latest = repairAttempts.slice(-3).map((attempt) => attempt.fullPageDiffRatio).filter((value): value is number => typeof value === 'number');
  if (detectPlateauForRatios(latest)) return 'full-page diff did not improve across the latest repair attempts';
  const textCounts = repairAttempts.slice(-3).map((attempt) => attempt.failedTextCount).filter((value): value is number => typeof value === 'number');
  if (detectTextPlateau(textCounts)) return 'exact text-content failures did not decrease across the latest repair attempts';
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

async function shouldRequestInitialImplementation(attempt: RestoreAttempt, report: VerifyReport, reportPath: string, store: ArtifactStore): Promise<boolean> {
  if (attempt.phase !== 'baseline') return false;
  const actualPath = resolveReportArtifactPath(report.fullPage.actualPath, reportPath, store);
  return shouldRequestInitialImplementationForReport(report, actualPath);
}

export async function shouldRequestInitialImplementationForReport(report: VerifyReport, actualPath?: string | null): Promise<boolean> {
  if (report.status !== 'failed') return false;
  if (report.failures.some((failure) => failure.category === 'wrong-state' || failure.category === 'blocked-environment' || failure.category === 'insufficient-design-data')) return false;
  const textMissingRatio = failureRatio(
    report.textResults.length,
    report.textResults.filter((result) => result.status === 'missing' || result.status === 'mapping-missing').length,
  );
  const requiredDomResults = report.domResults.filter((result) => (result.mapping || 'required') === 'required');
  const requiredDomMissingRatio = failureRatio(
    requiredDomResults.length,
    requiredDomResults.filter((result) => result.status === 'missing').length,
  );
  const failedRegionRatio = failureRatio(
    report.regionResults.length,
    report.regionResults.filter((result) => result.status === 'failed' || result.status === 'skipped').length,
  );
  const blankActual = actualPath ? await isNearlyBlankImage(actualPath).catch(() => false) : false;

  if (blankActual && report.fullPage.diffRatio >= 0.08) return true;
  const noTextMatch = report.textResults.length > 0 && textMissingRatio >= 0.9;
  const noRequiredDomMatch = requiredDomResults.length > 0 && requiredDomMissingRatio >= 0.9;
  const noRegionMatch = report.regionResults.length > 0 && failedRegionRatio >= 0.9;
  return report.fullPage.diffRatio >= 0.35 && (noTextMatch || (noRequiredDomMatch && noRegionMatch));
}

function failureRatio(total: number, failed: number): number {
  return total > 0 ? failed / total : 0;
}

function resolveReportArtifactPath(artifactPath: string, reportPath: string, store: ArtifactStore): string | null {
  if (path.isAbsolute(artifactPath)) return artifactPath;
  const artifactRootPath = path.join(store.artifactRoot, artifactPath);
  if (fs.existsSync(artifactRootPath)) return artifactRootPath;
  const siblingPath = path.resolve(path.dirname(reportPath), artifactPath);
  return fs.existsSync(siblingPath) ? siblingPath : null;
}

async function isNearlyBlankImage(imagePath: string): Promise<boolean> {
  const stats = await sharp(imagePath).stats();
  const channels = stats.channels.slice(0, 3);
  if (channels.length === 0) return false;
  const meanSpread = Math.max(...channels.map((channel) => channel.mean)) - Math.min(...channels.map((channel) => channel.mean));
  const maxDeviation = Math.max(...channels.map((channel) => channel.stdev));
  const bright = channels.every((channel) => channel.mean >= 245);
  return bright && meanSpread <= 4 && maxDeviation <= 6;
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

function writeFinalReport(store: ArtifactStore, runId: string, result: RestoreResult, archiveFinalArtifacts: boolean): void {
  const runDir = store.getRunDir(runId);
  const finalReportPath = path.join(runDir, 'final-report.json');
  writeJsonFile(finalReportPath, {
    schemaVersion: 1,
    runId,
    completedAt: nowIso(),
    status: result.status,
    attempt: result.attempt,
    ...(result.reportPath ? { reportPath: relativeArtifactPath(store.artifactRoot, result.reportPath) } : {}),
    ...(result.repairPlanPath ? { repairPlanPath: relativeArtifactPath(store.artifactRoot, result.repairPlanPath) } : {}),
    ...(result.agentBriefPath ? { agentBriefPath: relativeArtifactPath(store.artifactRoot, result.agentBriefPath) } : {}),
    ...(result.implementationBriefPath ? { implementationBriefPath: relativeArtifactPath(store.artifactRoot, result.implementationBriefPath) } : {}),
    ...(result.blockedReason ? { blockedReason: result.blockedReason } : {}),
  });
  if (archiveFinalArtifacts) writeFinalArchiveManifest(store, runId, result, finalReportPath);
}

function writeFinalArchiveManifest(store: ArtifactStore, runId: string, result: RestoreResult, finalReportPath: string): void {
  const runDir = store.getRunDir(runId);
  const archiveDir = path.join(runDir, 'restore', 'archive');
  fs.mkdirSync(archiveDir, { recursive: true });
  const timestamp = nowIso().replace(/[:.]/g, '-');
  const archivePath = path.join(archiveDir, `${result.attempt.attemptId || timestamp}.manifest.json`);
  const refs = [
    { kind: 'final-report', path: relativeArtifactPath(store.artifactRoot, finalReportPath) },
    ...(result.reportPath ? [{ kind: 'verify-report', path: relativeArtifactPath(store.artifactRoot, result.reportPath) }] : []),
    ...(result.repairPlanPath ? [{ kind: 'repair-plan', path: relativeArtifactPath(store.artifactRoot, result.repairPlanPath) }] : []),
    ...(result.agentBriefPath ? [{ kind: 'agent-brief', path: relativeArtifactPath(store.artifactRoot, result.agentBriefPath) }] : []),
    ...(result.implementationBriefPath ? [{ kind: 'implementation-brief', path: relativeArtifactPath(store.artifactRoot, result.implementationBriefPath) }] : []),
  ];
  writeJsonFile(archivePath, {
    schemaVersion: 1,
    runId,
    archivedAt: nowIso(),
    status: result.status,
    attemptId: result.attempt.attemptId,
    refs,
  });
  writeJsonFile(path.join(archiveDir, 'latest.manifest.json'), {
    schemaVersion: 1,
    runId,
    path: relativeArtifactPath(store.artifactRoot, archivePath),
    updatedAt: nowIso(),
  });
}

async function terminateDevProcess(processHandle: ReturnType<typeof execaCommand>, timeoutMs: number): Promise<void> {
  if (processHandle.exitCode !== null) return;
  const pid = processHandle.pid;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      processHandle.kill('SIGTERM');
    }
  } else {
    processHandle.kill('SIGTERM');
  }
  const exited = await Promise.race([
    processHandle.then(() => true).catch(() => true),
    delay(timeoutMs).then(() => false),
  ]);
  if (exited) return;
  if (typeof pid === 'number') {
    try {
      process.kill(-pid, 'SIGKILL');
      return;
    } catch {
      // Fall through to direct child kill when process group termination is unavailable.
    }
  }
  processHandle.kill('SIGKILL');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
