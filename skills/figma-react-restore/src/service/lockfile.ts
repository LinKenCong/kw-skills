import fs from 'node:fs';
import path from 'node:path';
import { serviceLockSchema, type ServiceLock } from '../schema.js';
import { nowIso } from '../ids.js';
import { readJsonIfExists, writeJsonFile } from '../json.js';
import { DEFAULT_PORT, resolveArtifactRoot, resolveWorkspaceRoot, serviceLockPath } from '../paths.js';

export const SERVICE_VERSION = '0.1.0';

export function createServiceLock(options: { workspaceRoot?: string; artifactRoot?: string; port?: number } = {}): ServiceLock {
  const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot || process.cwd());
  const artifactRoot = path.resolve(options.artifactRoot || resolveArtifactRoot(workspaceRoot));
  const port = options.port || DEFAULT_PORT;
  return serviceLockSchema.parse({
    service: 'figma-react-restore',
    version: SERVICE_VERSION,
    pid: process.pid,
    port,
    url: `http://localhost:${port}`,
    startedAt: nowIso(),
    workspaceRoot,
    artifactRoot,
  });
}

export function writeServiceLock(lock: ServiceLock): void {
  writeJsonFile(serviceLockPath(lock.workspaceRoot), serviceLockSchema.parse(lock));
}

export function readServiceLock(workspaceRoot = process.cwd()): ServiceLock | null {
  const filePath = serviceLockPath(workspaceRoot);
  const value = readJsonIfExists(filePath);
  if (!value) return null;
  return serviceLockSchema.parse(value);
}

export function removeServiceLock(workspaceRoot = process.cwd()): void {
  const filePath = serviceLockPath(workspaceRoot);
  if (fs.existsSync(filePath)) fs.rmSync(filePath);
}

export function isServiceLockAlive(lock: ServiceLock): boolean {
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}
