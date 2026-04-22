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
const STARTUP_RETRIES = 12;
const STARTUP_WAIT_MS = 500;
const BASE_REQUEST_TIMEOUT_MS = 60_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || 3000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return { ok: response.ok, status: response.status, data: await response.json() };
  } finally {
    clearTimeout(timer);
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
  const child = spawn(process.execPath, [BRIDGE_FILE], {
    cwd: path.dirname(BRIDGE_FILE),
    detached: true,
    stdio: 'ignore',
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

function parseFlags(args) {
  const flags = {
    assets: false,
    screenshot: false,
    pageScreenshots: false,
    selectionUnion: false,
    nodeScreenshots: false,
    pages: '',
  };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--assets') flags.assets = true;
    else if (arg === '--screenshot') flags.screenshot = true;
    else if (arg === '--page-screenshots') flags.pageScreenshots = true;
    else if (arg === '--selection-union') flags.selectionUnion = true;
    else if (arg === '--node-screenshots') flags.nodeScreenshots = true;
    else if (arg === '--pages' && i + 1 < args.length) flags.pages = args[++i];
    else positional.push(arg);
  }

  return { flags, input: positional.join(' ').trim() };
}

function buildExtractOptions(flags, defaults = {}) {
  return {
    exportAssets: flags.assets,
    exportFormats: flags.assets ? ['SVG', 'PNG'] : [],
    screenshot: flags.screenshot || !!defaults.screenshot,
    pageScreenshots: flags.pageScreenshots || !!defaults.pageScreenshots,
    selectionUnionScreenshot: flags.selectionUnion || !!defaults.selectionUnionScreenshot,
    nodeScreenshots: flags.nodeScreenshots || flags.selectionUnion || !!defaults.nodeScreenshots,
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

function resolveRequestTimeoutMs(pathname, body) {
  let workUnits = 1;
  const options = body && body.options ? body.options : {};

  if (options.screenshot || options.pageScreenshots || options.selectionUnionScreenshot || options.nodeScreenshots) {
    workUnits += 2;
  }
  if (pathname === '/extract-pages' || pathname === '/extract-selected-pages-bundle') {
    workUnits += 1;
  }

  return (BASE_REQUEST_TIMEOUT_MS * workUnits) + 15_000;
}

async function postJson(pathname, body) {
  const ensured = await ensureBridge();
  if (!ensured.ok) return ensured;

  try {
    const result = await fetchJson(`${BRIDGE_URL}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, resolveRequestTimeoutMs(pathname, body));
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
    printResult(health ? { ok: true, health } : { ok: false, error: 'Bridge 未启动或不可达' });
    return;
  }

  if (command === 'ensure') {
    printResult(await ensureBridge());
    return;
  }

  if (command === 'capabilities') {
    printResult(readCapabilitiesRegistry());
    return;
  }

  if (command === 'extract') {
    const { flags, input } = parseFlags(restArgs);
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
    const { flags } = parseFlags(restArgs);
    printResult(await postJson('/extract-selection', {
      options: buildExtractOptions(flags),
    }));
    return;
  }

  if (command === 'extract-pages') {
    const { flags } = parseFlags(restArgs);
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
    const { flags } = parseFlags(restArgs);
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

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
