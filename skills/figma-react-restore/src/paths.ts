import fs from 'node:fs';
import path from 'node:path';

export const DEFAULT_ARTIFACT_DIR = '.figma-react-restore';
export const DEFAULT_PORT = 49327;
export const SERVICE_LOCK_FILE = 'service.json';

export function resolveWorkspaceRoot(input = process.cwd()): string {
  return path.resolve(input);
}

export function resolveArtifactRoot(workspaceRoot = process.cwd()): string {
  return path.join(resolveWorkspaceRoot(workspaceRoot), DEFAULT_ARTIFACT_DIR);
}

export function resolveSafePath(baseDir: string, relativePath: string): string {
  if (!relativePath || typeof relativePath !== 'string') throw new Error('relativePath must be a non-empty string');
  if (relativePath.includes('\0')) throw new Error('relativePath must not contain null bytes');
  if (path.isAbsolute(relativePath)) throw new Error('relativePath must stay within artifact root');
  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(resolvedBase, relativePath);
  const rel = path.relative(resolvedBase, resolved);
  if (!rel || rel === '.' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error('relativePath must stay within artifact root');
  }
  return resolved;
}

export function toPosixPath(value: string): string {
  return value.split(path.sep).join('/');
}

export function relativeArtifactPath(artifactRoot: string, filePath: string): string {
  return toPosixPath(path.relative(artifactRoot, filePath));
}

export function findAncestorDir(start: string, predicate: (dir: string) => boolean): string | null {
  let current = path.resolve(start);
  while (true) {
    if (predicate(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function inferArtifactRootFromPath(inputPath: string): string | null {
  const absolute = path.resolve(inputPath);
  const start = fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() ? absolute : path.dirname(absolute);
  return findAncestorDir(start, (dir) => path.basename(dir) === DEFAULT_ARTIFACT_DIR);
}

export function resolveReferencePath(reference: string, options: { baseDir?: string; artifactRoot?: string; cwd?: string } = {}): string {
  if (path.isAbsolute(reference)) return reference;
  const candidates = [
    options.baseDir ? path.resolve(options.baseDir, reference) : null,
    options.artifactRoot ? path.resolve(options.artifactRoot, reference) : null,
    path.resolve(options.cwd || process.cwd(), reference),
  ].filter((item): item is string => Boolean(item));
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0] || path.resolve(reference);
}

export function serviceLockPath(workspaceRoot = process.cwd()): string {
  return path.join(resolveArtifactRoot(workspaceRoot), SERVICE_LOCK_FILE);
}
