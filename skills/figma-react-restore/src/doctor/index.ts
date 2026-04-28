import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { ArtifactStore } from '../artifact/store.js';
import { readServiceLock } from '../service/lockfile.js';
import { inspectReactProject, waitForRoute } from '../react/project.js';

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  fix?: string;
};

export type DoctorReport = {
  ok: boolean;
  checks: DoctorCheck[];
  failures: Array<{ code: string; message: string; fix?: string }>;
  project?: ReturnType<typeof inspectReactProject>;
};

export async function runDoctor(options: { projectRoot?: string; route?: string; checkBrowser?: boolean } = {}): Promise<DoctorReport> {
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const checks: DoctorCheck[] = [];
  checks.push(checkNodeVersion());
  checks.push(checkArtifactRoot(projectRoot));
  const project = inspectReactProject(projectRoot);
  checks.push({ name: 'react-project', ok: project.warnings.length === 0, message: project.warnings.length === 0 ? `Detected ${project.likelyFramework} React project` : project.warnings.join('; ') });
  checks.push(await checkSharp());
  if (options.checkBrowser !== false) checks.push(await checkPlaywrightBrowser());
  checks.push(await checkService(projectRoot));
  if (options.route) checks.push(await checkRoute(options.route));

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    code: check.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    message: check.message,
    ...(check.fix ? { fix: check.fix } : {}),
  }));
  return { ok: failures.length === 0, checks, failures, project };
}

function checkNodeVersion(): DoctorCheck {
  const major = Number.parseInt(process.versions.node.split('.')[0] || '0', 10);
  return {
    name: 'node-version',
    ok: major >= 18,
    message: `Node.js ${process.versions.node}`,
    ...(major >= 18 ? {} : { fix: 'Use Node.js 18 or newer' }),
  };
}

function checkArtifactRoot(projectRoot: string): DoctorCheck {
  try {
    const store = new ArtifactStore({ workspaceRoot: projectRoot });
    store.ensure();
    const probe = path.join(store.artifactRoot, `.write-test-${process.pid}`);
    fs.writeFileSync(probe, `${os.hostname()}\n`);
    fs.rmSync(probe);
    return { name: 'artifact-root-writable', ok: true, message: `${store.artifactRoot} is writable` };
  } catch (error) {
    return { name: 'artifact-root-writable', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Ensure project root is writable' };
  }
}

async function checkSharp(): Promise<DoctorCheck> {
  try {
    await sharp({ create: { width: 1, height: 1, channels: 4, background: '#fff' } }).png().toBuffer();
    return { name: 'sharp', ok: true, message: 'sharp can encode PNG' };
  } catch (error) {
    return { name: 'sharp', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Reinstall dependencies for figma-react-restore' };
  }
}

async function checkPlaywrightBrowser(): Promise<DoctorCheck> {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    return { name: 'playwright-browser', ok: true, message: 'Chromium can launch' };
  } catch (error) {
    return { name: 'playwright-browser', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'npx playwright install chromium' };
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

async function checkService(projectRoot: string): Promise<DoctorCheck> {
  const lock = readServiceLock(projectRoot);
  if (!lock) return { name: 'runtime-service', ok: false, message: 'Runtime service lockfile not found', fix: 'Run figma-react-restore service start' };
  try {
    const response = await fetch(`${lock.url}/health`);
    const data = await response.json() as { pluginConnected?: boolean };
    return { name: 'runtime-service', ok: response.ok, message: response.ok ? `Runtime service healthy; pluginConnected=${Boolean(data.pluginConnected)}` : `Runtime service returned HTTP ${response.status}` };
  } catch (error) {
    return { name: 'runtime-service', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Restart figma-react-restore service start' };
  }
}

async function checkRoute(route: string): Promise<DoctorCheck> {
  try {
    await waitForRoute(route, { timeoutMs: 5000 });
    return { name: 'route-reachable', ok: true, message: `${route} is reachable` };
  } catch (error) {
    return { name: 'route-reachable', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Start the React dev server or fix the route URL' };
  }
}
