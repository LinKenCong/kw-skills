import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { serviceLockSchema, type ServiceLock } from '../schema.js';
import { nowIso } from '../ids.js';
import { readJsonIfExists, writeJsonFile } from '../json.js';
import { DEFAULT_PORT, resolveArtifactRoot, resolveWorkspaceRoot, serviceLockPath } from '../paths.js';

export const SERVICE_VERSION = '0.1.0';

export function createRuntimeSecret(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function createServiceLock(options: { workspaceRoot?: string; artifactRoot?: string; port?: number; createdByCommand?: string; ownerPid?: number } = {}): ServiceLock {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot || process.cwd());
  const artifactRoot = path.resolve(options.artifactRoot || resolveArtifactRoot(workspaceRoot));
  const port = options.port || DEFAULT_PORT;
  const now = nowIso();
  const createdByCommand = (options.createdByCommand || process.argv.join(' ') || 'unknown').slice(0, 512);
  return serviceLockSchema.parse({
    service: 'figma-react-restore',
    version: SERVICE_VERSION,
    pid: process.pid,
    port,
    url: `http://127.0.0.1:${port}`,
    adminToken: createRuntimeSecret(),
    startedAt: now,
    hostname: os.hostname(),
    createdByCommand,
    lastHeartbeatAt: now,
    ownerPid: options.ownerPid || process.pid,
    workspaceRoot,
    artifactRoot,
  });
}

export function writeServiceLock(lock: ServiceLock): void {
  const filePath = serviceLockPath(lock.workspaceRoot);
  writeJsonFile(filePath, serviceLockSchema.parse(lock));
  fs.chmodSync(filePath, 0o600);
}

export function readServiceLock(workspaceRoot = process.cwd()): ServiceLock | null {
  const filePath = serviceLockPath(workspaceRoot);
  const value = readJsonIfExists(filePath);
  if (!value) return null;
  return serviceLockSchema.parse(value);
}

export function removeServiceLock(workspaceRoot = process.cwd(), expectedLock?: ServiceLock): boolean {
  const filePath = serviceLockPath(workspaceRoot);
  if (!fs.existsSync(filePath)) return false;
  if (expectedLock) {
    const current = readServiceLock(workspaceRoot);
    if (
      !current ||
      current.pid !== expectedLock.pid ||
      current.adminToken !== expectedLock.adminToken ||
      current.startedAt !== expectedLock.startedAt
    ) {
      return false;
    }
  }
  fs.rmSync(filePath);
  return true;
}

export function isServiceLockAlive(lock: ServiceLock): boolean {
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function touchServiceLockHeartbeat(lock: ServiceLock, time = nowIso()): ServiceLock | null {
  const current = readServiceLock(lock.workspaceRoot);
  if (!current || current.pid !== lock.pid || current.adminToken !== lock.adminToken) return null;
  const next = serviceLockSchema.parse({ ...current, lastHeartbeatAt: time });
  writeServiceLock(next);
  return next;
}
