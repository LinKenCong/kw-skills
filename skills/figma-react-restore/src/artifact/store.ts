import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { artifactRefSchema, runSchema, type ArtifactKind, type ArtifactRef, type Run, type Warning } from '../schema.js';
import { createId, nowIso } from '../ids.js';
import { readJsonFile, readJsonIfExists, writeJsonFile } from '../json.js';
import { relativeArtifactPath, resolveArtifactRoot, resolveSafePath, resolveWorkspaceRoot, toPosixPath } from '../paths.js';

export type ArtifactStoreOptions = { workspaceRoot?: string; artifactRoot?: string };

export class ArtifactStore {
  readonly workspaceRoot: string;
  readonly artifactRoot: string;

  constructor(options: ArtifactStoreOptions = {}) {
    this.workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot || process.cwd());
    this.artifactRoot = path.resolve(options.artifactRoot || resolveArtifactRoot(this.workspaceRoot));
  }

  ensure(): void {
    fs.mkdirSync(this.artifactRoot, { recursive: true });
    fs.mkdirSync(path.join(this.artifactRoot, 'runs'), { recursive: true });
    fs.mkdirSync(path.join(this.artifactRoot, 'assets'), { recursive: true });
  }

  createRun(kind: Run['kind'], inputs: Record<string, unknown> = {}): Run {
    this.ensure();
    const run: Run = {
      runId: createId('run'),
      kind,
      createdAt: nowIso(),
      status: 'running',
      workspaceRoot: this.workspaceRoot,
      artifactRoot: this.artifactRoot,
      inputs,
      artifactRefs: [],
      warnings: [],
    };
    this.writeRun(run);
    writeJsonFile(path.join(this.getRunDir(run.runId), 'artifacts.json'), { artifacts: [] });
    return run;
  }

  listRuns(): Run[] {
    const runsDir = path.join(this.artifactRoot, 'runs');
    if (!fs.existsSync(runsDir)) return [];
    return fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runsDir, entry.name, 'run.json'))
      .filter((filePath) => fs.existsSync(filePath))
      .map((filePath) => runSchema.parse(readJsonFile(filePath)))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  getRunDir(runId: string): string {
    return path.join(this.artifactRoot, 'runs', sanitizeSegment(runId));
  }

  getRunFile(runId: string, relativePath: string): string {
    return resolveSafePath(this.getRunDir(runId), relativePath);
  }

  readRun(runId: string): Run {
    return runSchema.parse(readJsonFile(path.join(this.getRunDir(runId), 'run.json')));
  }

  writeRun(run: Run): void {
    writeJsonFile(path.join(this.getRunDir(run.runId), 'run.json'), runSchema.parse(run));
  }

  updateRun(runId: string, patch: Partial<Pick<Run, 'status' | 'warnings' | 'artifactRefs'>>): Run {
    const run = this.readRun(runId);
    const next: Run = { ...run, ...patch };
    this.writeRun(next);
    return next;
  }

  addWarning(runId: string, warning: Warning): void {
    const run = this.readRun(runId);
    run.warnings.push(warning);
    this.writeRun(run);
  }

  writeRunJson(
    runId: string,
    relativePath: string,
    data: unknown,
    artifact?: Omit<ArtifactRef, 'artifactId' | 'path'> & { artifactId?: string }
  ): ArtifactRef | null {
    const filePath = this.getRunFile(runId, relativePath);
    writeJsonFile(filePath, data);
    if (!artifact) return null;
    return this.addArtifact(runId, buildArtifactRef(artifact, relativeArtifactPath(this.artifactRoot, filePath)));
  }

  writeRunBuffer(
    runId: string,
    relativePath: string,
    buffer: Buffer,
    artifact: Omit<ArtifactRef, 'artifactId' | 'path' | 'contentHash'> & { artifactId?: string }
  ): ArtifactRef {
    const filePath = this.getRunFile(runId, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
    return this.addArtifact(runId, buildArtifactRef({ ...artifact, contentHash: sha256(buffer) }, relativeArtifactPath(this.artifactRoot, filePath)));
  }

  addArtifact(runId: string, artifact: ArtifactRef): ArtifactRef {
    const parsed = artifactRefSchema.parse(artifact);
    const run = this.readRun(runId);
    const existingIndex = run.artifactRefs.findIndex((item) => item.artifactId === parsed.artifactId);
    if (existingIndex >= 0) run.artifactRefs[existingIndex] = parsed;
    else run.artifactRefs.push(parsed);
    this.writeRun(run);

    const artifactFile = path.join(this.getRunDir(runId), 'artifacts.json');
    const current = readJsonIfExists<{ artifacts: ArtifactRef[] }>(artifactFile) || { artifacts: [] };
    const idx = current.artifacts.findIndex((item) => item.artifactId === parsed.artifactId);
    if (idx >= 0) current.artifacts[idx] = parsed;
    else current.artifacts.push(parsed);
    writeJsonFile(artifactFile, current);
    return parsed;
  }

  resolveArtifactPath(refOrPath: string): string {
    const cleaned = refOrPath.startsWith('artifact:') ? refOrPath.slice('artifact:'.length) : refOrPath;
    if (path.isAbsolute(cleaned)) return cleaned;
    return resolveSafePath(this.artifactRoot, cleaned);
  }

  resolveRunPath(runId: string, refOrPath: string): string {
    const cleaned = refOrPath.startsWith('artifact:') ? refOrPath.slice('artifact:'.length) : refOrPath;
    if (path.isAbsolute(cleaned)) return cleaned;
    return resolveSafePath(this.getRunDir(runId), cleaned);
  }

  findArtifact(runId: string, kind: ArtifactKind): ArtifactRef | null {
    const run = this.readRun(runId);
    return run.artifactRefs.find((item) => item.kind === kind) || null;
  }

  findArtifacts(runId: string, kind: ArtifactKind): ArtifactRef[] {
    const run = this.readRun(runId);
    return run.artifactRefs.filter((item) => item.kind === kind);
  }
}

export function sha256(buffer: Buffer): string {
  return `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
}

export function sanitizeSegment(value: string): string {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function sanitizeFileName(value: string): string {
  const base = path.basename(value || 'artifact.bin');
  return base.replace(/[^a-zA-Z0-9._-]+/g, '-').slice(0, 160) || 'artifact.bin';
}

export function inferExtension(mediaType = '', fallback = 'bin'): string {
  if (mediaType.includes('png')) return 'png';
  if (mediaType.includes('jpeg') || mediaType.includes('jpg')) return 'jpg';
  if (mediaType.includes('svg')) return 'svg';
  if (mediaType.includes('json')) return 'json';
  return fallback.replace(/^\./, '') || 'bin';
}

function buildArtifactRef(input: Omit<ArtifactRef, 'artifactId' | 'path'> & { artifactId?: string }, artifactPath: string): ArtifactRef {
  const ref: Record<string, unknown> = {
    artifactId: input.artifactId || createId('art'),
    kind: input.kind,
    path: toPosixPath(artifactPath),
  };
  for (const key of ['contentHash', 'mediaType', 'sourceNodeId', 'sourcePageId'] as const) {
    const value = input[key];
    if (value !== undefined) ref[key] = value;
  }
  return artifactRefSchema.parse(ref);
}
