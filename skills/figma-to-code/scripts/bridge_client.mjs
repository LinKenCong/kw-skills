#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_FILE = path.resolve(__dirname, '..', 'bridge.mjs');
const BRIDGE_URL = 'http://localhost:3333';
const STARTUP_RETRIES = 12;
const STARTUP_WAIT_MS = 500;

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
  const flags = { assets: false, screenshot: false };
  const positional = [];
  for (const arg of args) {
    if (arg === '--assets') flags.assets = true;
    else if (arg === '--screenshot') flags.screenshot = true;
    else positional.push(arg);
  }
  return { flags, input: positional.join(' ').trim() };
}

function printResult(result) {
  console.log(JSON.stringify(result, null, 2));
  if (!result || result.ok !== true) process.exitCode = 1;
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

  if (command === 'extract') {
    const { flags, input } = parseFlags(restArgs);
    if (!input) {
      printResult({ ok: false, error: '用法: bridge_client.mjs extract "<figma-url-or-nodeId>" [--assets] [--screenshot]' });
      return;
    }

    const ensured = await ensureBridge();
    if (!ensured.ok) { printResult(ensured); return; }

    try {
      const result = await fetchJson(`${BRIDGE_URL}/extract`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          options: {
            exportAssets: flags.assets,
            exportFormats: flags.assets ? ['SVG', 'PNG'] : [],
            screenshot: flags.screenshot,
          },
        }),
      }, 65000);
      printResult(result.data);
    } catch (error) {
      printResult({ ok: false, error: error.message });
    }
    return;
  }

  if (command === 'extract-selection') {
    const { flags } = parseFlags(restArgs);

    const ensured = await ensureBridge();
    if (!ensured.ok) { printResult(ensured); return; }

    try {
      const result = await fetchJson(`${BRIDGE_URL}/extract-selection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          options: {
            exportAssets: flags.assets,
            exportFormats: flags.assets ? ['SVG', 'PNG'] : [],
            screenshot: flags.screenshot,
          },
        }),
      }, 65000);
      printResult(result.data);
    } catch (error) {
      printResult({ ok: false, error: error.message });
    }
    return;
  }

  if (command === 'query') {
    const { handleQuery } = await import('./query.mjs');
    printResult(await handleQuery(restArgs));
    return;
  }

  printResult({
    ok: false,
    error: 'Usage: bridge_client.mjs <health|ensure|extract|extract-selection|query> [args]',
  });
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
