import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { resolveArtifactRoot } from '../paths.js';
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
  checks.push(checkSkillDependencies());
  checks.push(await checkSharp());
  if (options.checkBrowser !== false) checks.push(await checkPlaywrightBrowser());
  checks.push(...await checkService(projectRoot));
  checks.push(checkFontsBestEffort());
  if (options.route) checks.push(await checkRoute(options.route));

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    code: check.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    message: check.message,
    ...(check.fix ? { fix: check.fix } : {}),
  }));
  return { ok: failures.length === 0, checks, failures, project };
}

function checkSkillDependencies(): DoctorCheck {
  const require = createRequire(import.meta.url);
  const dependencies = ['@hono/node-server', 'commander', 'execa', 'hono', 'pixelmatch', 'playwright', 'pngjs', 'sharp', 'zod'];
  const missing = dependencies.filter((dependency) => {
    try {
      require.resolve(dependency);
      return false;
    } catch {
      return true;
    }
  });
  return {
    name: 'package-dependencies',
    ok: missing.length === 0,
    message: missing.length === 0 ? 'Skill runtime dependencies are installed' : `Missing dependencies: ${missing.join(', ')}`,
    ...(missing.length === 0 ? {} : { fix: 'Run npm install inside skills/figma-react-restore' }),
  };
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
  const artifactRoot = resolveArtifactRoot(projectRoot);
  const probePrefix = path.join(projectRoot, `.figma-react-restore-write-probe-${process.pid}-`);
  let probeDir: string | null = null;
  try {
    probeDir = fs.mkdtempSync(probePrefix);
    const probe = path.join(probeDir, 'probe.txt');
    fs.writeFileSync(probe, `${os.hostname()}\n`);
    fs.rmSync(probeDir, { recursive: true, force: true });
    probeDir = null;
    return { name: 'artifact-root-writable', ok: true, message: `${artifactRoot} can be created when a run starts` };
  } catch (error) {
    return { name: 'artifact-root-writable', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Ensure project root is writable' };
  } finally {
    if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
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

async function checkService(projectRoot: string): Promise<DoctorCheck[]> {
  const lock = readServiceLock(projectRoot);
  if (!lock) {
    return [
      { name: 'runtime-service', ok: false, message: 'Runtime service lockfile not found', fix: 'Run figma-react-restore service start' },
      { name: 'plugin-session', ok: false, message: 'No runtime service, so plugin session cannot be checked', fix: 'Start service, then open the Figma React Restore development plugin' },
    ];
  }
  try {
    const response = await fetch(`${lock.url}/health`);
    const data = await response.json() as { pluginConnected?: boolean };
    return [
      { name: 'runtime-service', ok: response.ok, message: response.ok ? 'Runtime service healthy' : `Runtime service returned HTTP ${response.status}` },
      {
        name: 'plugin-session',
        ok: response.ok && Boolean(data.pluginConnected),
        message: response.ok && data.pluginConnected ? 'Figma plugin session is connected' : 'Figma plugin session is not connected',
        ...(response.ok && data.pluginConnected ? {} : { fix: 'Open or reopen the Figma React Restore development plugin; it registers automatically' }),
      },
    ];
  } catch (error) {
    return [
      { name: 'runtime-service', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Restart figma-react-restore service start' },
      { name: 'plugin-session', ok: false, message: 'Runtime service is not reachable, so plugin session cannot be checked', fix: 'Restart service, then reopen the Figma plugin if it does not reconnect automatically' },
    ];
  }
}

function checkFontsBestEffort(): DoctorCheck {
  const directories = [
    '/System/Library/Fonts',
    '/Library/Fonts',
    path.join(os.homedir(), 'Library/Fonts'),
    '/usr/share/fonts',
    path.join(os.homedir(), '.local/share/fonts'),
  ];
  const existing = directories.filter((directory) => fs.existsSync(directory));
  return {
    name: 'fonts-best-effort',
    ok: existing.length > 0,
    message: existing.length > 0
      ? `Font directories available: ${existing.slice(0, 3).join(', ')}`
      : 'No standard font directories found; Figma font matching may be unreliable',
    ...(existing.length > 0 ? {} : { fix: 'Install required design fonts locally before verification' }),
  };
}

async function checkRoute(route: string): Promise<DoctorCheck> {
  try {
    await waitForRoute(route, { timeoutMs: 5000 });
    return { name: 'route-reachable', ok: true, message: `${route} is reachable` };
  } catch (error) {
    return { name: 'route-reachable', ok: false, message: error instanceof Error ? error.message : String(error), fix: 'Start the React dev server or fix the route URL' };
  }
}
