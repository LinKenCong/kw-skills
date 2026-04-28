import { createId, nowIso } from '../ids.js';
import type { ArtifactRef, ErrorPayload, JobProgress, SessionRegister } from '../schema.js';
import { ArtifactStore } from '../artifact/store.js';

export type RuntimeSession = SessionRegister & {
  connected: boolean;
  registeredAt: string;
  lastSeenAt: string;
};

export type RuntimeJobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'canceled';

export type RuntimeJob = {
  jobId: string;
  capability: string;
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

export class RuntimeState {
  readonly token: string;
  readonly store: ArtifactStore;
  readonly sessions = new Map<string, RuntimeSession>();
  readonly jobs = new Map<string, RuntimeJob>();
  readonly subscribers = new Map<string, Set<EventSubscriber>>();

  constructor(options: { token: string; store: ArtifactStore }) {
    this.token = options.token;
    this.store = options.store;
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
    return [...this.sessions.values()].sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
  }

  chooseSession(sessionId?: string): RuntimeSession {
    if (sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session || !session.connected) throw new Error(`Plugin session not connected: ${sessionId}`);
      return session;
    }
    const connected = this.listSessions().filter((session) => session.connected);
    if (connected.length === 0) throw new Error('No Figma plugin session connected');
    if (connected.length > 1) throw new Error('Multiple plugin sessions connected; pass --session <id>');
    const session = connected[0];
    if (!session) throw new Error('No Figma plugin session connected');
    return session;
  }

  createJob(input: { capability: string; sessionId?: string; options?: Record<string, unknown> }): RuntimeJob {
    const session = this.chooseSession(input.sessionId);
    const run = this.store.createRun('extract', {
      capability: input.capability,
      sessionId: session.pluginSessionId,
      options: input.options || {},
    });
    const job: RuntimeJob = {
      jobId: createId('job'),
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
    if (!job) throw new Error(`Unknown job: ${jobId}`);
    return job;
  }

  updateJob(jobId: string, patch: Partial<RuntimeJob>): RuntimeJob {
    const job = this.getJob(jobId);
    const next: RuntimeJob = { ...job, ...patch, updatedAt: nowIso() };
    this.jobs.set(jobId, next);
    return next;
  }

  addProgress(jobId: string, progress: JobProgress): RuntimeJob {
    const job = this.getJob(jobId);
    const status: RuntimeJobStatus = job.status === 'pending' ? 'running' : job.status;
    return this.updateJob(jobId, { status, progress: [...job.progress, progress] });
  }

  addArtifact(jobId: string, ref: ArtifactRef): RuntimeJob {
    const job = this.getJob(jobId);
    return this.updateJob(jobId, { artifactRefs: [...job.artifactRefs, ref] });
  }

  completeJob(jobId: string, result: unknown): RuntimeJob {
    return this.updateJob(jobId, { status: 'completed', result });
  }

  failJob(jobId: string, error: ErrorPayload): RuntimeJob {
    return this.updateJob(jobId, { status: 'failed', error });
  }

  cancelJob(jobId: string): RuntimeJob {
    const job = this.updateJob(jobId, { status: 'canceled' });
    this.emit(job.sessionId, { type: 'job.canceled', job });
    return job;
  }

  subscribe(sessionId: string, subscriber: EventSubscriber): () => void {
    const set = this.subscribers.get(sessionId) || new Set<EventSubscriber>();
    set.add(subscriber);
    this.subscribers.set(sessionId, set);
    return () => {
      const current = this.subscribers.get(sessionId);
      current?.delete(subscriber);
      if (current && current.size === 0) this.subscribers.delete(sessionId);
    };
  }

  emit(sessionId: string, event: RuntimeEvent): void {
    const subscribers = this.subscribers.get(sessionId);
    if (!subscribers) return;
    for (const subscriber of subscribers) subscriber.send(event);
  }

  activeJobCount(): number {
    return [...this.jobs.values()].filter((job) => job.status === 'pending' || job.status === 'running').length;
  }
}
