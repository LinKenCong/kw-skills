#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3333;
const CACHE_ROOT = path.join(__dirname, 'cache');
const EXTRACT_TIMEOUT_MS = 60_000;

const sseClients = new Set();
const pendingJobs = new Map();
const startedAt = Date.now();

// ── Figma URL parsing ──

function parseFigmaInput(input) {
  const trimmed = decodeURIComponent(String(input).trim());

  const urlMatch = trimmed.match(
    /figma\.com\/(?:design|file|board|proto)\/([A-Za-z0-9]+)(?:\/[^?#]*)?(?:[?#].*node-id=([0-9]+[-:][0-9]+))?/
  );
  if (urlMatch) {
    const fileKey = urlMatch[1];
    const nodeId = urlMatch[2] ? urlMatch[2].replace(/-/g, ':') : null;
    return { fileKey, nodeId };
  }

  const nodeIdMatch = trimmed.match(/^(\d+):(\d+)$/);
  if (nodeIdMatch) {
    return { fileKey: null, nodeId: trimmed };
  }

  return { fileKey: null, nodeId: null };
}

function sanitizePathSegment(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-');
}

// ── SSE management ──

function addSseClient(response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  response.write('event: ready\ndata: {}\n\n');
  sseClients.add(response);

  const keepalive = setInterval(() => {
    response.write(': keepalive\n\n');
  }, 30_000);

  response.on('close', () => {
    clearInterval(keepalive);
    sseClients.delete(response);
  });
}

function broadcastSse(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(payload);
  }
}

function hasPluginConnection() {
  return sseClients.size > 0;
}

// ── Job management ──

function createJob(type, target, options) {
  const jobId = randomUUID();
  const job = {
    jobId,
    type,
    target,
    options: options || {},
    createdAt: new Date().toISOString(),
    resolve: null,
    reject: null,
    timer: null,
    assets: [],
  };

  const promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });

  job.timer = setTimeout(() => {
    if (pendingJobs.has(jobId)) {
      pendingJobs.delete(jobId);
      job.reject(new Error('extraction timeout after ' + EXTRACT_TIMEOUT_MS + 'ms'));
    }
  }, EXTRACT_TIMEOUT_MS);

  pendingJobs.set(jobId, job);
  return { job, promise };
}

function resolveJob(jobId, result) {
  const job = pendingJobs.get(jobId);
  if (!job) {
    return false;
  }
  clearTimeout(job.timer);
  pendingJobs.delete(jobId);

  if (result.error) {
    job.reject(new Error(result.error));
  } else {
    const assetFiles = job.assets;
    job.resolve({ ...result, assetFiles });
  }
  return true;
}

// ── Cache persistence ──

function resolveCacheDir(fileKey, nodeId) {
  return path.join(
    CACHE_ROOT,
    sanitizePathSegment(fileKey),
    sanitizePathSegment(nodeId)
  );
}

function writeExtractionToCache(result) {
  const fileKey = result.meta?.fileKey || 'unknown-file';
  const nodeId = result.meta?.nodeId;
  if (!nodeId) {
    return null;
  }

  const cacheDir = resolveCacheDir(fileKey, nodeId);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(
    path.join(cacheDir, 'extraction.json'),
    JSON.stringify(result, null, 2)
  );

  return cacheDir;
}

function writeAssetToCache(fileKey, nodeId, asset) {
  const cacheDir = resolveCacheDir(fileKey, nodeId);
  const assetsDir = path.join(cacheDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const rawFileName = asset.fileName || `${sanitizePathSegment(asset.nodeId)}.${asset.format.toLowerCase()}`;
  const fileName = path.basename(sanitizePathSegment(rawFileName));
  const filePath = path.join(assetsDir, fileName);
  const buffer = Buffer.from(asset.base64, 'base64');
  fs.writeFileSync(filePath, buffer);

  return filePath;
}

function writeScreenshotToCache(fileKey, nodeId, base64Data) {
  const cacheDir = resolveCacheDir(fileKey, nodeId);
  fs.mkdirSync(cacheDir, { recursive: true });

  const filePath = path.join(cacheDir, 'screenshot.png');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return filePath;
}

// ── HTTP helpers ──

const MAX_BODY_SIZE = 50 * 1024 * 1024;

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalLength = 0;
    let settled = false;
    request.on('data', (chunk) => {
      totalLength += chunk.length;
      if (totalLength > MAX_BODY_SIZE && !settled) {
        settled = true;
        request.destroy();
        reject(new Error('body too large (max 50MB)'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      settled = true;
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch {
        resolve(null);
      }
    });
    request.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  response.end(JSON.stringify(data));
}

function safeSendJson(response, statusCode, data) {
  if (response.headersSent) return;
  sendJson(response, statusCode, data);
}

function sendCors(response) {
  response.writeHead(204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  });
  response.end();
}

// ── Route handlers ──

function handleHealth(_request, response) {
  sendJson(response, 200, {
    ok: true,
    pluginConnected: hasPluginConnection(),
    uptime: Math.round((Date.now() - startedAt) / 1000),
  });
}

function handleEvents(_request, response) {
  addSseClient(response);
}

async function handleExtract(request, response) {
  const body = await readBody(request);
  if (!body || !body.input) {
    sendJson(response, 400, { ok: false, error: 'missing input field' });
    return;
  }

  if (!hasPluginConnection()) {
    sendJson(response, 503, {
      ok: false,
      errorCode: 'NO_PLUGIN_CONNECTION',
      message: 'No Figma plugin connected. Open Figma Desktop, run the plugin, and retry.',
    });
    return;
  }

  const parsed = parseFigmaInput(body.input);
  const options = body.options || {};

  const { job, promise } = createJob('extract', {
    input: body.input,
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
  }, options);

  broadcastSse('extract', {
    jobId: job.jobId,
    target: job.target,
    options: job.options,
  });

  try {
    const result = await promise;
    const cacheDir = writeExtractionToCache(result);
    safeSendJson(response, 200, { ok: true, cacheDir, result });
  } catch (error) {
    safeSendJson(response, 504, { ok: false, error: `extraction failed: ${error.message}` });
  }
}

async function handleExtractSelection(request, response) {
  const body = (await readBody(request)) || {};

  if (!hasPluginConnection()) {
    sendJson(response, 503, {
      ok: false,
      errorCode: 'NO_PLUGIN_CONNECTION',
      message: 'No Figma plugin connected. Open Figma Desktop, run the plugin, and retry.',
    });
    return;
  }

  const options = body.options || {};
  const { job, promise } = createJob('extract-selection', {}, options);

  broadcastSse('extract-selection', {
    jobId: job.jobId,
    options: job.options,
  });

  try {
    const result = await promise;
    const cacheDir = writeExtractionToCache(result);
    safeSendJson(response, 200, { ok: true, cacheDir, result });
  } catch (error) {
    safeSendJson(response, 504, { ok: false, error: `extraction failed: ${error.message}` });
  }
}

async function handleJobResult(request, response, jobId) {
  const body = await readBody(request);
  if (!body) {
    sendJson(response, 400, { ok: false, error: 'invalid JSON body' });
    return;
  }

  const resolved = resolveJob(jobId, body);
  if (!resolved) {
    sendJson(response, 404, { ok: false, error: 'job not found or already resolved' });
    return;
  }

  sendJson(response, 200, { ok: true });
}

async function handleJobAsset(request, response, jobId) {
  const body = await readBody(request);
  if (!body || !body.base64 || !body.format) {
    sendJson(response, 400, { ok: false, error: 'missing base64 or format' });
    return;
  }

  const job = pendingJobs.get(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: 'job not found' });
    return;
  }

  const fileKey = job.target?.fileKey || 'unknown-file';
  const rootNodeId = body.rootNodeId || job.target?.nodeId || body.nodeId || 'unknown-node';

  if (body.isScreenshot) {
    const filePath = writeScreenshotToCache(fileKey, rootNodeId, body.base64);
    job.assets.push({ type: 'screenshot', nodeId: body.nodeId || rootNodeId, filePath });
  } else {
    const filePath = writeAssetToCache(fileKey, rootNodeId, body);
    job.assets.push({
      type: 'export',
      nodeId: body.nodeId || rootNodeId,
      format: body.format,
      fileName: body.fileName,
      filePath,
    });
  }

  sendJson(response, 200, { ok: true });
}

// ── Request routing ──

const server = http.createServer(async (request, response) => {
  if (request.method === 'OPTIONS') {
    sendCors(response);
    return;
  }

  const url = new URL(request.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  try {
    if (request.method === 'GET' && pathname === '/health') {
      handleHealth(request, response);
    } else if (request.method === 'GET' && pathname === '/events') {
      handleEvents(request, response);
    } else if (request.method === 'POST' && pathname === '/extract') {
      await handleExtract(request, response);
    } else if (request.method === 'POST' && pathname === '/extract-selection') {
      await handleExtractSelection(request, response);
    } else {
      const jobResultMatch = pathname.match(/^\/jobs\/([^/]+)\/result$/);
      if (request.method === 'POST' && jobResultMatch) {
        await handleJobResult(request, response, jobResultMatch[1]);
        return;
      }

      const jobAssetMatch = pathname.match(/^\/jobs\/([^/]+)\/asset$/);
      if (request.method === 'POST' && jobAssetMatch) {
        await handleJobAsset(request, response, jobAssetMatch[1]);
        return;
      }

      sendJson(response, 404, { ok: false, error: 'not found' });
    }
  } catch (error) {
    safeSendJson(response, 500, { ok: false, error: error.message });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Is another bridge instance running?`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Figma Bridge running at http://localhost:${PORT}`);
});
