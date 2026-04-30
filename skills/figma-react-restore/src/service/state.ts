import { createId, nowIso } from '../ids.js';
import type { ArtifactRef, ErrorPayload, JobCapability, JobProgress, SessionRegister } from '../schema.js';
import { ArtifactStore } from '../artifact/store.js';
import { createRuntimeSecret } from './lockfile.js';
import { ServiceError } from './errors.js';

export type RuntimeSession = SessionRegister & {
  connected: boolean;
  registeredAt: string;
  lastSeenAt: string;
};

export type RuntimeJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

export type RuntimeJob = {
  jobId: string;
  jobSecret: string;
  capability: JobCapability;
  sessionId: string;
  status: RuntimeJobStatus;
  options: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  progress: JobProgress[];
  result?: unknown;
  error?: ErrorPayload;
  runId?: string;
  artifactRefs: ArtifactRef[];
};

export type RuntimeEvent =
  | { type: 'job.created'; job: RuntimeJob }
  | { type: 'job.canceled'; job: RuntimeJob }
  | { type: 'ping'; time: string };

export type EventSubscriber = {
  id: string;
  send: (event: RuntimeEvent) => void;
};

const SESSION_TTL_MS = 15_000;
const TERMINAL_JOB_STATUSES = new Set<RuntimeJobStatus>(['completed', 'failed', 'canceled']);

export class RuntimeStateError extends ServiceError {
  constructor(code: string, message: string, status: number, options: { recoverable?: boolean; hint?: string } = {}) {
    super(code, message, {
      httpStatus: status,
      ...(options.recoverable !== undefined ? { recoverable: options.recoverable } : {}),
      ...(options.hint ? { hint: options.hint } : {}),
    });
    this.name = 'RuntimeStateError';
  }
}

export class RuntimeState {
  readonly store: ArtifactStore;
  readonly adminToken: string;
  readonly sessions = new Map<string, RuntimeSession>();
  readonly jobs = new Map<string, RuntimeJob>();
  readonly subscribers = new Map<string, Set<EventSubscriber>>();

  constructor(options: { store: ArtifactStore; adminToken: string }) {
    this.store = options.store;
    this.adminToken = options.adminToken;
  }

  registerSession(payload: SessionRegister): RuntimeSession {
    const now = nowIso();
    const existing = this.sessions.get(payload.pluginSessionId);
    const session: RuntimeSession = {
      ...payload,
      connected: true,
      registeredAt: existing?.registeredAt || now,
      lastSeenAt: now,
    };
    this.sessions.set(session.pluginSessionId, session);
    return session;
  }

  listSessions(): RuntimeSession[] {
    this.pruneStaleSessions();
    return [...this.sessions.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  }

  chooseSession(sessionId?: string): RuntimeSession {
    this.pruneStaleSessions();
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session || !session.connected) {
        throw new RuntimeStateError('SESSION_NOT_CONNECTED', `Plugin session not connected: ${sessionId}`, 424, {
          recoverable: true,
          hint: 'Open the Figma plugin or choose a connected session id.',
        });
      }
      return session;
    }
    const connected = this.listSessions().filter((session) => session.connected);
    if (connected.length === 0) {
      throw new RuntimeStateError('NO_PLUGIN_SESSION', 'No Figma plugin session connected', 409, {
        recoverable: true,
        hint: 'Open the Figma React Restore plugin and keep it connected, then retry.',
      });
    }
    if (connected.length > 1) {
      throw new RuntimeStateError('MULTIPLE_PLUGIN_SESSIONS', 'Multiple plugin sessions connected; pass --session <id>', 409, {
        recoverable: true,
        hint: 'Pass --session with the intended pluginSessionId.',
      });
    }
    const session = connected[0];
    if (!session) {
      throw new RuntimeStateError('NO_PLUGIN_SESSION', 'No Figma plugin session connected', 409, {
        recoverable: true,
        hint: 'Open the Figma React Restore plugin and keep it connected, then retry.',
      });
    }
    return session;
  }

  createJob(input: { capability: JobCapability; sessionId?: string; options?: Record<string, unknown> }): RuntimeJob {
    const session = this.chooseSession(input.sessionId);
    const run = this.store.createRun('extract', {
      capability: input.capability,
      sessionId: session.pluginSessionId,
      options: input.options || {},
    });
    const job: RuntimeJob = {
      jobId: createId('job'),
      jobSecret: createRuntimeSecret(),
      capability: input.capability,
      sessionId: session.pluginSessionId,
      status: 'pending',
      options: input.options || {},
      createdAt: nowIso(),
      updatedAt: nowIso(),
      progress: [],
      runId: run.runId,
      artifactRefs: [],
    };
    this.jobs.set(job.jobId, job);
    this.emit(session.pluginSessionId, { type: 'job.created', job });
    return job;
  }

  getJob(jobId: string): RuntimeJob {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new RuntimeStateError('JOB_NOT_FOUND', `Unknown job: ${jobId}`, 404, {
        recoverable: false,
        hint: 'Confirm the job id belongs to this runtime service instance.',
      });
    }
    return job;
  }

  listJobsForSession(sessionId: string): RuntimeJob[] {
    return [...this.jobs.values()]
      .filter((job) => job.sessionId === sessionId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  updateJob(jobId: string, patch: Partial<RuntimeJob>): RuntimeJob {
    const job = this.getJob(jobId);
    const next: RuntimeJob = { ...job, ...patch, updatedAt: nowIso() };
    this.jobs.set(jobId, next);
    return next;
  }

  assertActiveJob(jobId: string, action: string): RuntimeJob {
    const job = this.getJob(jobId);
    assertJobActive(job, action);
    return job;
  }

  addProgress(jobId: string, progress: JobProgress): RuntimeJob {
    const job = this.assertActiveJob(jobId, 'record progress');
    const status: RuntimeJobStatus = job.status === 'pending' ? 'running' : job.status;
    return this.updateJob(jobId, { status, progress: [...job.progress, progress] });
  }

  addArtifact(jobId: string, ref: ArtifactRef): RuntimeJob {
    const job = this.assertActiveJob(jobId, 'add artifacts');
    return this.updateJob(jobId, { artifactRefs: [...job.artifactRefs, ref] });
  }

  completeJob(jobId: string, result: unknown): RuntimeJob {
    this.assertActiveJob(jobId, 'complete');
    return this.updateJob(jobId, { status: 'completed', result });
  }

  failJob(jobId: string, error: ErrorPayload): RuntimeJob {
    this.assertActiveJob(jobId, 'fail');
    return this.updateJob(jobId, { status: 'failed', error });
  }

  cancelJob(jobId: string): RuntimeJob {
    this.assertActiveJob(jobId, 'cancel');
    const job = this.updateJob(jobId, { status: 'canceled' });
    this.emit(job.sessionId, { type: 'job.canceled', job });
    return job;
  }

  subscribe(sessionId: string, subscriber: EventSubscriber): () => void {
    const set = this.subscribers.get(sessionId) || new Set<EventSubscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionId, set);
    this.touchSession(sessionId);
    return () => {
      const current = this.subscribers.get(sessionId);
      current?.delete(subscriber);
      if (current && current.size === 0) this.subscribers.delete(sessionId);
    };
  }

  touchSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.sessions.set(sessionId, { ...session, connected: true, lastSeenAt: nowIso() });
  }

  emit(sessionId: string, event: RuntimeEvent): void {
    const subscribers = this.subscribers.get(sessionId);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber.send(event);
  }

  activeJobCount(): number {
    return [...this.jobs.values()].filter((job) => job.status === 'pending' || job.status === 'running').length;
  }

  connectedSessionCount(): number {
    return this.listSessions().filter((session) => session.connected).length;
  }

  private pruneStaleSessions(): void {
    const now = Date.now();
    for (const [sessionId, session] of this.sessions) {
      const lastSeen = Date.parse(session.lastSeenAt);
      if (!Number.isFinite(lastSeen) || now - lastSeen <= SESSION_TTL_MS) continue;
      this.sessions.set(sessionId, { ...session, connected: false });
    }
  }
}

export function isTerminalJobStatus(status: RuntimeJobStatus): boolean {
  return TERMINAL_JOB_STATUSES.has(status);
}

function assertJobActive(job: RuntimeJob, action: string): void {
  if (!isTerminalJobStatus(job.status)) return;
  throw new RuntimeStateError(
    'INVALID_JOB_TRANSITION',
    `Cannot ${action} terminal job ${job.jobId} with status ${job.status}`,
    409,
    { recoverable: false, hint: 'Create a new job instead of mutating a terminal job.' }
  );
}
