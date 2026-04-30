import { serve } from '@hono/node-server';
import { ArtifactStore } from '../artifact/store.js';
import { DEFAULT_PORT } from '../paths.js';
import { createRuntimeApp } from './http.js';
import {
  createServiceLock,
  isServiceLockAlive,
  readServiceLock,
  removeServiceLock,
  touchServiceLockHeartbeat,
  writeServiceLock,
} from './lockfile.js';
import { RuntimeState } from './state.js';
import { readServiceHealth, validateServiceHealth } from './control.js';

export type StartServiceOptions = {
  workspaceRoot?: string;
  artifactRoot?: string;
  port?: number;
  silent?: boolean;
  idleTimeoutMs?: number;
  startupTimeoutMs?: number;
  createdByCommand?: string;
};

export type StartRuntimeServiceResult = {
  ok: true;
  status: 'started' | 'existing';
  service: 'figma-react-restore';
  url: string;
  lockFile: string;
  pid: number;
  idleTimeoutMs?: number;
  lock: ReturnType<typeof createServiceLock>;
  close?: () => Promise<void>;
};

const DEFAULT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_STARTUP_TIMEOUT_MS = 5000;
const HEARTBEAT_INTERVAL_MS = 5000;

export async function startRuntimeService(options: StartServiceOptions = {}): Promise<StartRuntimeServiceResult> {
  const port = options.port || DEFAULT_PORT;
  const existing = await findExistingHealthyService(options);
  if (existing) {
    const result = buildStartResult('existing', existing, options.idleTimeoutMs);
    if (!options.silent) printStartResult(result);
    return result;
  }

  const lock = createServiceLock({ ...options, port });
  const store = new ArtifactStore({ workspaceRoot: lock.workspaceRoot, artifactRoot: lock.artifactRoot });
  store.ensure();
  const state = new RuntimeState({ store, adminToken: lock.adminToken });
  const app = createRuntimeApp(state);
  let server: ReturnType<typeof serve> | null = null;
  let lockWritten = false;
  let closed = false;
  const timers: NodeJS.Timeout[] = [];

  async function cleanup() {
    if (closed) return;
    closed = true;
    for (const timer of timers) clearInterval(timer);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    if (lockWritten) removeServiceLock(lock.workspaceRoot, lock);
    if (server) await closeServer(server);
  }

  function onSigint() {
    void cleanup().finally(() => {
      process.exit(0);
    });
  }

  function onSigterm() {
    void cleanup().finally(() => {
      process.exit(0);
    });
  }

  try {
    server = await listen(app, port, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);
    writeServiceLock(lock);
    lockWritten = true;
  } catch (error) {
    if (server) await closeServer(server).catch(() => undefined);
    removeServiceLock(lock.workspaceRoot, lock);
    throw error;
  }

  const heartbeat = setInterval(() => {
    touchServiceLockHeartbeat(lock);
  }, HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();
  timers.push(heartbeat);

  const idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
  if (idleTimeoutMs > 0) {
    let idleSince = Date.now();
    const idleIntervalMs = Math.max(500, Math.min(5000, Math.floor(idleTimeoutMs / 4) || 500));
    const idleTimer = setInterval(() => {
      if (state.connectedSessionCount() > 0 || state.activeJobCount() > 0) {
        idleSince = Date.now();
        return;
      }
      if (Date.now() - idleSince < idleTimeoutMs) return;
      void cleanup().finally(() => process.exit(0));
    }, idleIntervalMs);
    idleTimer.unref();
    timers.push(idleTimer);
  }

  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  const result = { ...buildStartResult('started', lock, idleTimeoutMs), close: cleanup };
  if (!options.silent) printStartResult(result);
  return result;
}

async function findExistingHealthyService(options: StartServiceOptions): Promise<ReturnType<typeof createServiceLock> | null> {
  const workspaceRoot = options.workspaceRoot || process.cwd();
  const lock = readServiceLock(workspaceRoot);
  if (!lock) return null;
  try {
    const health = await readServiceHealth(lock, 750);
    const mismatch = validateServiceHealth(lock, health);
    if (mismatch) throw new Error(mismatch);
    return lock;
  } catch (error) {
    if (!isServiceLockAlive(lock)) {
      removeServiceLock(workspaceRoot, lock);
      return null;
    }
    throw new Error(`Existing runtime service lock could not be verified: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function listen(app: ReturnType<typeof createRuntimeApp>, port: number, timeoutMs: number): Promise<ReturnType<typeof serve>> {
  let server: ReturnType<typeof serve> | null = null;
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`Timed out while binding runtime service on 127.0.0.1:${port}`));
    }, timeoutMs);

    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server?.off?.('error', finish);
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      if (!server) {
        reject(new Error('Runtime service did not return a server handle'));
        return;
      }
      resolve(server);
    };

    try {
      server = serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, () => finish());
      server.once('error', finish);
    } catch (error) {
      finish(error);
    }
  });
}

function buildStartResult(status: 'started' | 'existing', lock: ReturnType<typeof createServiceLock>, idleTimeoutMs: number | undefined): StartRuntimeServiceResult {
  return {
    ok: true,
    status,
    service: lock.service,
    url: lock.url,
    lockFile: '.figma-react-restore/service.json',
    pid: lock.pid,
    ...(idleTimeoutMs !== undefined ? { idleTimeoutMs } : {}),
    lock,
  };
}

function printStartResult(result: StartRuntimeServiceResult): void {
  process.stdout.write(`${JSON.stringify({
    ok: result.ok,
    status: result.status,
    service: result.service,
    url: result.url,
    lockFile: result.lockFile,
    pid: result.pid,
    ...(result.idleTimeoutMs !== undefined ? { idleTimeoutMs: result.idleTimeoutMs } : {}),
  }, null, 2)}\n`);
}

async function closeServer(server: ReturnType<typeof serve>): Promise<void> {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}
