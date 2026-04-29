import path from 'node:path';
import { serviceLockPath } from '../paths.js';
import type { ServiceLock } from '../schema.js';
import { isServiceLockAlive, readServiceLock, removeServiceLock } from './lockfile.js';

export type ServiceHealth = {
  ok?: boolean;
  service?: string;
  version?: string;
  pid?: number;
  workspaceRoot?: string;
  artifactRoot?: string;
  pluginConnected?: boolean;
  activeJobs?: number;
};

export type StopServiceOptions = {
  projectRoot?: string;
  timeoutMs?: number;
  force?: boolean;
};

export type StopServiceResult = {
  ok: boolean;
  status: 'not-running' | 'stopped' | 'stale-lock-removed' | 'refused-active-jobs' | 'refused-unverified' | 'timeout';
  message: string;
  workspaceRoot: string;
  lockFile: string;
  pid?: number;
  activeJobs?: number;
  error?: string;
};

const DEFAULT_FETCH_TIMEOUT_MS = 1500;
const DEFAULT_STOP_TIMEOUT_MS = 5000;

export async function readServiceHealth(lock: ServiceLock, timeoutMs = DEFAULT_FETCH_TIMEOUT_MS): Promise<ServiceHealth> {
  const response = await fetchWithTimeout(`${lock.url}/health`, timeoutMs);
  const data = await response.json() as ServiceHealth;
  if (!response.ok) throw new Error(`Runtime service returned HTTP ${response.status}`);
  return data;
}

export function validateServiceHealth(lock: ServiceLock, health: ServiceHealth): string | null {
  if (health.service !== 'figma-react-restore') return `Unexpected service: ${String(health.service || 'unknown')}`;
  if (health.pid !== lock.pid) return `Health pid ${String(health.pid)} does not match lock pid ${lock.pid}`;
  if (!health.workspaceRoot) return 'Health response is missing workspaceRoot';
  if (path.resolve(health.workspaceRoot) !== path.resolve(lock.workspaceRoot)) {
    return `Health workspace ${health.workspaceRoot} does not match lock workspace ${lock.workspaceRoot}`;
  }
  return null;
}

export async function stopRuntimeService(options: StopServiceOptions = {}): Promise<StopServiceResult> {
  const workspaceRoot = path.resolve(options.projectRoot || process.cwd());
  const lockFile = serviceLockPath(workspaceRoot);
  const lock = readServiceLock(workspaceRoot);
  if (!lock) {
    return { ok: true, status: 'not-running', message: 'Runtime service lockfile not found', workspaceRoot, lockFile };
  }

  const base = { workspaceRoot, lockFile, pid: lock.pid };
  if (path.resolve(lock.workspaceRoot) !== workspaceRoot) {
    return {
      ...base,
      ok: false,
      status: 'refused-unverified',
      message: `Lock workspace ${lock.workspaceRoot} does not match requested workspace ${workspaceRoot}`,
    };
  }

  let health: ServiceHealth;
  try {
    health = await readServiceHealth(lock, options.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS);
  } catch (error) {
    if (!isServiceLockAlive(lock)) {
      removeServiceLock(workspaceRoot);
      return {
        ...base,
        ok: true,
        status: 'stale-lock-removed',
        message: 'Removed stale runtime service lockfile for a dead process',
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      ...base,
      ok: false,
      status: 'refused-unverified',
      message: 'Runtime service health could not be verified while the lock pid is alive; refusing to kill the process',
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const mismatch = validateServiceHealth(lock, health);
  if (mismatch) {
    return { ...base, ok: false, status: 'refused-unverified', message: mismatch };
  }

  const activeJobs = health.activeJobs || 0;
  if (activeJobs > 0 && !options.force) {
    return {
      ...base,
      ok: false,
      status: 'refused-active-jobs',
      message: `Runtime service has ${activeJobs} active job(s); pass --force to stop it anyway`,
      activeJobs,
    };
  }

  try {
    process.kill(lock.pid, 'SIGTERM');
  } catch (error) {
    if (!isServiceLockAlive(lock)) {
      removeServiceLock(workspaceRoot);
      return {
        ...base,
        ok: true,
        status: 'stale-lock-removed',
        message: 'Removed stale runtime service lockfile after stop found no live process',
        activeJobs,
      };
    }
    return {
      ...base,
      ok: false,
      status: 'refused-unverified',
      message: 'Failed to signal the runtime service process',
      activeJobs,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  const stopped = await waitForProcessExit(lock, options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS);
  if (!stopped) {
    return {
      ...base,
      ok: false,
      status: 'timeout',
      message: `Runtime service did not exit within ${options.timeoutMs ?? DEFAULT_STOP_TIMEOUT_MS}ms`,
      activeJobs,
    };
  }

  removeServiceLock(workspaceRoot);
  return { ...base, ok: true, status: 'stopped', message: 'Runtime service stopped', activeJobs };
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function waitForProcessExit(lock: ServiceLock, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isServiceLockAlive(lock)) return true;
    await delay(100);
  }
  return !isServiceLockAlive(lock);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
