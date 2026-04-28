import fs from 'node:fs';
import path from 'node:path';
import { readJsonIfExists } from '../json.js';

export type ReactProjectInfo = {
  root: string;
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown';
  scripts: Record<string, string>;
  likelyFramework: 'next' | 'vite' | 'remix' | 'cra' | 'unknown';
  warnings: string[];
};

export function inspectReactProject(projectRoot: string): ReactProjectInfo {
  const root = path.resolve(projectRoot);
  const pkg = readJsonIfExists<{ scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>(path.join(root, 'package.json'));
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = pkg?.scripts || {};
  const warnings: string[] = [];
  if (!pkg) warnings.push('package.json not found');
  if (!deps.react) warnings.push('react dependency not found');
  return {
    root,
    packageManager: detectPackageManager(root),
    scripts,
    likelyFramework: detectFramework(deps, scripts),
    warnings,
  };
}

export async function waitForRoute(route: string, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
  const timeoutMs = options.timeoutMs || 45000;
  const intervalMs = options.intervalMs || 750;
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(route, { method: 'GET' });
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Route not reachable after ${timeoutMs}ms: ${route}${lastError ? ` (${lastError})` : ''}`);
}

export function defaultDevCommand(info: ReactProjectInfo): string | null {
  if (info.scripts.dev) return `${info.packageManager === 'unknown' ? 'npm' : info.packageManager} run dev`;
  if (info.scripts.start) return `${info.packageManager === 'unknown' ? 'npm' : info.packageManager} run start`;
  return null;
}

function detectPackageManager(root: string): ReactProjectInfo['packageManager'] {
  if (fs.existsSync(path.join(root, 'bun.lock')) || fs.existsSync(path.join(root, 'bun.lockb'))) return 'bun';
  if (fs.existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fs.existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (fs.existsSync(path.join(root, 'package-lock.json'))) return 'npm';
  return 'unknown';
}

function detectFramework(deps: Record<string, string>, scripts: Record<string, string>): ReactProjectInfo['likelyFramework'] {
  if (deps.next) return 'next';
  if (deps['@remix-run/react'] || deps['@remix-run/node']) return 'remix';
  if (deps.vite || /vite/.test(scripts.dev || '')) return 'vite';
  if (deps['react-scripts']) return 'cra';
  return 'unknown';
}
