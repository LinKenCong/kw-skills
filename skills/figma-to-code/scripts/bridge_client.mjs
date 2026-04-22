#!/usr/bin/env node
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_FILE = path.resolve(__dirname, '..', 'bridge.mjs');
const BRIDGE_URL = 'http://localhost:3333';
const CAPABILITIES_FILE = path.resolve(__dirname, '..', 'plugin', 'capabilities.json');
const PLUGIN_MANIFEST_FILE = path.resolve(__dirname, '..', 'plugin', 'manifest.json');
const DEFAULT_CACHE_DIRNAME = '.figma-to-code';
const STARTUP_RETRIES = 12;
const STARTUP_WAIT_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options, timeoutMs) {
  const controller = timeoutMs ? new AbortController() : null;
  const timer = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, controller ? { ...options, signal: controller.signal } : options);
    return { ok: response.ok, status: response.status, data: await response.json() };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function getHealth() {
  try {
    const result = await fetchJson(`${BRIDGE_URL}/health`, {}, 1500);
    return result.ok && result.data?.ok ? result.data : null;
  } catch {
    return null;
  }
}

function startBridge() {
  const env = {
    ...process.env,
    FIGMA_TO_CODE_CACHE_ROOT: resolveWorkspaceCacheRoot(),
  };
  const child = spawn(process.execPath, [BRIDGE_FILE], {
    cwd: path.dirname(BRIDGE_FILE),
    detached: true,
    stdio: 'ignore',
    env,
  });
  child.unref();
  return child.pid;
}

async function ensureBridge() {
  let health = await getHealth();
  if (health) return { ok: true, started: false, health };

  const pid = startBridge();
  for (let attempt = 0; attempt < STARTUP_RETRIES; attempt++) {
    await sleep(STARTUP_WAIT_MS);
    health = await getHealth();
    if (health) return { ok: true, started: true, pid, health };
  }

  return { ok: false, started: true, pid, error: 'Bridge 启动超时' };
}

export function resolveWorkspaceCacheRoot(cwd = process.cwd()) {
  return path.resolve(cwd, DEFAULT_CACHE_DIRNAME);
}

export function buildRequestContext(cwd = process.cwd()) {
  return {
    workspaceRoot: path.resolve(cwd),
    cacheRoot: resolveWorkspaceCacheRoot(cwd),
  };
}

export function parseFlags(args) {
  const flags = {
    assets: false,
    screenshot: false,
    pageScreenshots: false,
    nodeScreenshots: false,
    pages: '',
  };
  const positional = [];
  const errors = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--assets') flags.assets = true;
    else if (arg === '--screenshot') flags.screenshot = true;
    else if (arg === '--page-screenshots') flags.pageScreenshots = true;
    else if (arg === '--selection-union') {
      errors.push('--selection-union has been removed. Use --node-screenshots instead.');
    }
    else if (arg === '--node-screenshots') flags.nodeScreenshots = true;
    else if (arg === '--pages' && i + 1 < args.length) flags.pages = args[++i];
    else positional.push(arg);
  }

  return { flags, input: positional.join(' ').trim(), errors };
}

export function buildExtractOptions(flags, defaults = {}) {
  return {
    exportAssets: flags.assets,
    exportFormats: flags.assets ? ['SVG', 'PNG'] : [],
    screenshot: flags.screenshot || !!defaults.screenshot,
    pageScreenshots: flags.pageScreenshots || !!defaults.pageScreenshots,
    nodeScreenshots: flags.nodeScreenshots || !!defaults.nodeScreenshots,
  };
}

function readCapabilitiesRegistry() {
  if (!fs.existsSync(CAPABILITIES_FILE)) {
    return { ok: false, error: `Capability registry not found: ${CAPABILITIES_FILE}` };
  }
  try {
    return { ok: true, ...JSON.parse(fs.readFileSync(CAPABILITIES_FILE, 'utf-8')) };
  } catch (error) {
    return { ok: false, error: `Failed to parse capability registry: ${error.message}` };
  }
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result || result.ok !== true) process.exitCode = 1;
}

async function postJson(pathname, body) {
  const ensured = await ensureBridge();
  if (!ensured.ok) return ensured;

  try {
    const payload = {
      ...(body || {}),
      context: {
        ...buildRequestContext(),
        ...((body && body.context) || {}),
      },
    };
    const result = await fetchJson(`${BRIDGE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return result.data;
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function main() {
  const command = process.argv[2];
  const restArgs = process.argv.slice(3);

  if (command === 'health') {
    const health = await getHealth();
    printResult(health ? {
      ok: true,
      health,
      pluginManifestPath: PLUGIN_MANIFEST_FILE,
      workspaceCacheRoot: resolveWorkspaceCacheRoot(),
    } : { ok: false, error: 'Bridge 未启动或不可达' });
    return;
  }

  if (command === 'ensure') {
    printResult({
      ...(await ensureBridge()),
      pluginManifestPath: PLUGIN_MANIFEST_FILE,
      workspaceCacheRoot: resolveWorkspaceCacheRoot(),
    });
    return;
  }

  if (command === 'capabilities') {
    printResult(readCapabilitiesRegistry());
    return;
  }

  if (command === 'extract') {
    const { flags, input, errors } = parseFlags(restArgs);
    if (errors.length > 0) {
      printResult({ ok: false, error: errors.join(' ') });
      return;
    }
    if (!input) {
      printResult({ ok: false, error: '用法: bridge_client.mjs extract "<figma-url-or-nodeId>" [--assets] [--screenshot] [--node-screenshots]' });
      return;
    }

    printResult(await postJson('/extract', {
      input,
      options: buildExtractOptions(flags),
    }));
    return;
  }

  if (command === 'extract-selection') {
    const { flags, errors } = parseFlags(restArgs);
    if (errors.length > 0) {
      printResult({ ok: false, error: errors.join(' ') });
      return;
    }
    printResult(await postJson('/extract-selection', {
      options: buildExtractOptions(flags),
    }));
    return;
  }

  if (command === 'extract-pages') {
    const { flags, errors } = parseFlags(restArgs);
    if (errors.length > 0) {
      printResult({ ok: false, error: errors.join(' ') });
      return;
    }
    const pages = String(flags.pages || '').split(',').map((item) => item.trim()).filter(Boolean);
    if (pages.length === 0) {
      printResult({ ok: false, error: '用法: bridge_client.mjs extract-pages --pages "Page A,Page B" [--assets] [--page-screenshots] [--node-screenshots]' });
      return;
    }

    printResult(await postJson('/extract-pages', {
      pages,
      options: buildExtractOptions(flags, {
        pageScreenshots: true,
      }),
    }));
    return;
  }

  if (command === 'extract-selected-pages-bundle') {
    const { flags, errors } = parseFlags(restArgs);
    if (errors.length > 0) {
      printResult({ ok: false, error: errors.join(' ') });
      return;
    }
    printResult(await postJson('/extract-selected-pages-bundle', {
      options: buildExtractOptions(flags, {
        pageScreenshots: true,
        nodeScreenshots: true,
      }),
    }));
    return;
  }

  if (command === 'query') {
    const { handleQuery } = await import('./query.mjs');
    printResult(await handleQuery(restArgs));
    return;
  }

  printResult({
    ok: false,
    error: 'Usage: bridge_client.mjs <health|ensure|capabilities|extract|extract-selection|extract-pages|extract-selected-pages-bundle|query> [args]',
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  main().catch((error) => {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  });
}
