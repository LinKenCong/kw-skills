#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3333;
const DEFAULT_CACHE_DIRNAME = '.figma-to-code';
const JOB_START_TIMEOUT_MS = 45_000;
const JOB_INACTIVITY_TIMEOUT_MS = 120_000;
const CAPABILITIES_FILE = path.join(__dirname, 'plugin', 'capabilities.json');
const DEFAULT_CACHE_ROOT = resolveCacheRoot(process.env.FIGMA_TO_CODE_CACHE_ROOT || null);

const sseClients = new Set();
const pendingJobs = new Map();
const startedAt = Date.now();

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

export function resolveCacheRoot(input) {
  if (typeof input === 'string' && input.trim()) {
    return path.resolve(input.trim());
  }
  return path.resolve(process.cwd(), DEFAULT_CACHE_DIRNAME);
}

export function resolveSafeRelativePath(baseDir, relativePath) {
  if (typeof relativePath !== 'string') {
    throw new Error('relativePath must be a string');
  }

  const trimmed = relativePath.trim();
  if (!trimmed) {
    throw new Error('relativePath must not be empty');
  }
  if (trimmed.includes('\0')) {
    throw new Error('relativePath must not contain null bytes');
  }
  if (path.isAbsolute(trimmed)) {
    throw new Error('relativePath must stay within cache directory');
  }

  const resolvedBaseDir = path.resolve(baseDir);
  const resolvedFilePath = path.resolve(resolvedBaseDir, trimmed);
  const relativeToBase = path.relative(resolvedBaseDir, resolvedFilePath);

  if (!relativeToBase || relativeToBase === '.') {
    throw new Error('relativePath must resolve to a file within cache directory');
  }
  if (relativeToBase === '..' || relativeToBase.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToBase)) {
    throw new Error('relativePath must stay within cache directory');
  }

  return resolvedFilePath;
}

function loadCapabilitiesRegistry() {
  if (!fs.existsSync(CAPABILITIES_FILE)) {
    return { ok: false, error: `Capability registry not found: ${CAPABILITIES_FILE}` };
  }
  try {
    return { ok: true, ...JSON.parse(fs.readFileSync(CAPABILITIES_FILE, 'utf-8')) };
  } catch (error) {
    return { ok: false, error: `Failed to parse capability registry: ${error.message}` };
  }
}

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

function formatJobTimeoutMessage(timeoutMs, reason) {
  return `${reason} after ${timeoutMs}ms`;
}

function armJobTimer(job, timeoutMs, reason) {
  clearTimeout(job.timer);
  job.timeoutMs = timeoutMs;
  job.timeoutReason = reason;
  job.timer = setTimeout(() => {
    if (!pendingJobs.has(job.jobId)) {
      return;
    }
    pendingJobs.delete(job.jobId);
    job.reject(new Error(formatJobTimeoutMessage(timeoutMs, reason)));
  }, timeoutMs);
}

function touchJob(job, activitySource) {
  const timeoutMs = activitySource === 'created' ? JOB_START_TIMEOUT_MS : JOB_INACTIVITY_TIMEOUT_MS;
  const reason = activitySource === 'created'
    ? 'plugin did not start processing the extraction job'
    : 'plugin stopped reporting progress';
  job.lastActivityAt = new Date().toISOString();
  job.lastActivitySource = activitySource;
  armJobTimer(job, timeoutMs, reason);
}

function createJob(type, target, options, context) {
  const jobId = randomUUID();
  const job = {
    jobId,
    type,
    target,
    options: options || {},
    context: context || {},
    cacheRoot: resolveCacheRoot(context && context.cacheRoot),
    createdAt: new Date().toISOString(),
    timeoutMs: 0,
    timeoutReason: null,
    resolve: null,
    reject: null,
    timer: null,
    assets: [],
    preparedBaseDirs: new Set(),
  };

  const promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });

  pendingJobs.set(jobId, job);
  touchJob(job, 'created');
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
    job.resolve({ ...result, assetFiles: job.assets });
  }
  return true;
}

function getJobCacheRoot(job) {
  return resolveCacheRoot(job && job.cacheRoot);
}

function resolveLegacyCacheDir(cacheRoot, fileKey, nodeId) {
  return path.join(
    cacheRoot,
    sanitizePathSegment(fileKey),
    sanitizePathSegment(nodeId)
  );
}

function resolveBundleCacheDir(cacheRoot, bundleId) {
  return path.join(cacheRoot, 'bundles', sanitizePathSegment(bundleId));
}

function writeJsonFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function normalizeDirPath(dirPath) {
  return path.resolve(dirPath);
}

function resetDirectory(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  fs.mkdirSync(dirPath, { recursive: true });
}

export function prepareJobOutputDir(job, dirPath) {
  const normalizedDir = normalizeDirPath(dirPath);
  if (!job || !job.preparedBaseDirs) {
    resetDirectory(normalizedDir);
    return normalizedDir;
  }
  if (!job.preparedBaseDirs.has(normalizedDir)) {
    resetDirectory(normalizedDir);
    job.preparedBaseDirs.add(normalizedDir);
  }
  return normalizedDir;
}

function writeExtractionToCache(result, job) {
  const fileKey = result.meta?.fileKey || 'unknown-file';
  const nodeId = result.meta?.nodeId;
  if (!nodeId) {
    return null;
  }

  const cacheDir = resolveLegacyCacheDir(getJobCacheRoot(job), fileKey, nodeId);
  prepareJobOutputDir(job, cacheDir);
  writeJsonFile(path.join(cacheDir, 'extraction.json'), result);

  if (result.pageInfo) {
    writeJsonFile(path.join(cacheDir, 'page.json'), result.pageInfo);
  }
  if (result.regions?.level1) {
    writeJsonFile(path.join(cacheDir, 'regions.level1.json'), { regions: result.regions.level1 });
  }
  if (result.regions?.level2) {
    writeJsonFile(path.join(cacheDir, 'regions.level2.json'), { regions: result.regions.level2 });
  }
  if (Array.isArray(result.screenshots)) {
    writeJsonFile(path.join(cacheDir, 'screenshots', 'manifest.json'), { screenshots: result.screenshots });
  }

  return cacheDir;
}

function summarizePageEntry(bundleCacheDir, pageEntry) {
  const pageId = pageEntry.pageId || pageEntry.pageInfo?.pageId;
  const pageName = pageEntry.pageName || pageEntry.pageInfo?.pageName;
  const pageDir = path.join(bundleCacheDir, 'pages', sanitizePathSegment(pageId));
  fs.mkdirSync(pageDir, { recursive: true });

  const pageInfo = {
    pageId,
    pageName,
    nodeCount: pageEntry.pageInfo?.nodeCount ?? 0,
    selectionCount: pageEntry.pageInfo?.selectionCount ?? 0,
    sourceMode: pageEntry.pageInfo?.sourceMode || null,
    rootNodeId: pageEntry.pageInfo?.rootNodeId || pageEntry.extraction?.meta?.nodeId || null,
    screenshotCount: Array.isArray(pageEntry.screenshots) ? pageEntry.screenshots.length : 0,
    path: `pages/${sanitizePathSegment(pageId)}/page.json`,
  };

  writeJsonFile(path.join(pageDir, 'page.json'), pageInfo);
  if (pageEntry.extraction) {
    writeJsonFile(path.join(pageDir, 'extraction.json'), pageEntry.extraction);
  }
  if (pageEntry.regions?.level1) {
    writeJsonFile(path.join(pageDir, 'regions.level1.json'), { regions: pageEntry.regions.level1 });
  }
  if (pageEntry.regions?.level2) {
    writeJsonFile(path.join(pageDir, 'regions.level2.json'), { regions: pageEntry.regions.level2 });
  }
  if (Array.isArray(pageEntry.screenshots)) {
    writeJsonFile(path.join(pageDir, 'screenshots', 'manifest.json'), { screenshots: pageEntry.screenshots });
  }

  return pageInfo;
}

function mergeFlatVariableMaps(target, source) {
  if (!source || typeof source !== 'object') return;
  for (const key of Object.keys(source)) {
    if (!target[key]) target[key] = {};
    Object.assign(target[key], source[key]);
  }
}

function collectComponentEntries(node, output, pageMeta) {
  if (!node || node.visible === false) return;
  if (node.component) {
    output.push({
      pageId: pageMeta?.pageId || null,
      pageName: pageMeta?.pageName || null,
      nodeId: node.id,
      nodeName: node.name,
      type: node.type,
      ...node.component,
    });
  }
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      collectComponentEntries(child, output, pageMeta);
    }
  }
}

function buildBundleVariablesIndex(pageEntries) {
  const merged = { flat: { colors: {}, numbers: {}, strings: {}, booleans: {} } };
  for (const pageEntry of pageEntries) {
    mergeFlatVariableMaps(merged.flat, pageEntry.extraction?.variables?.flat);
  }
  return merged;
}

function buildBundleComponentsIndex(pageEntries) {
  const components = [];
  for (const pageEntry of pageEntries) {
    collectComponentEntries(pageEntry.extraction?.root, components, {
      pageId: pageEntry.pageId,
      pageName: pageEntry.pageName,
    });
  }
  return components;
}

function buildBundleCssIndex(pageEntries) {
  const pages = pageEntries.map((pageEntry) => {
    const cssData = pageEntry.extraction?.css || null;
    return {
      pageId: pageEntry.pageId,
      pageName: pageEntry.pageName,
      available: cssData?.available !== false && !!cssData,
      reason: cssData?.reason || (cssData ? null : 'No css hints recorded for this page'),
      css: cssData?.available === false ? null : cssData,
    };
  });

  const available = pages.some((entry) => entry.available);
  return {
    available,
    reason: available ? null : 'No css hints recorded in this bundle cache',
    pages,
  };
}

function writeBundleToCache(bundleResult, job) {
  const bundleId = bundleResult.bundleId;
  if (!bundleId) return null;

  const cacheDir = resolveBundleCacheDir(getJobCacheRoot(job), bundleId);
  prepareJobOutputDir(job, cacheDir);

  const pageEntries = Array.isArray(bundleResult.pages) ? bundleResult.pages : [];
  const pageSummaries = [];
  const screenshotEntries = [];
  const regionEntries = [];

  for (const pageEntry of pageEntries) {
    const pageSummary = summarizePageEntry(cacheDir, pageEntry);
    pageSummaries.push(pageSummary);

    if (Array.isArray(pageEntry.screenshots)) {
      screenshotEntries.push(...pageEntry.screenshots);
    }
    if (pageEntry.regions?.level1) {
      regionEntries.push(...pageEntry.regions.level1);
    }
    if (pageEntry.regions?.level2) {
      regionEntries.push(...pageEntry.regions.level2);
    }
  }

  writeJsonFile(path.join(cacheDir, 'bundle.json'), {
    schemaVersion: bundleResult.schemaVersion || 1,
    kind: bundleResult.kind || 'figma-bundle',
    bundleId,
    bundleName: bundleResult.bundleName || bundleId,
    createdAt: bundleResult.createdAt || new Date().toISOString(),
    source: bundleResult.source || null,
    fileName: bundleResult.fileName || null,
    pages: pageSummaries.map((page) => page.pageId),
  });

  writeJsonFile(path.join(cacheDir, 'indexes', 'pages.json'), { pages: pageSummaries });
  writeJsonFile(path.join(cacheDir, 'indexes', 'screenshots.json'), { screenshots: screenshotEntries });
  writeJsonFile(path.join(cacheDir, 'indexes', 'regions.json'), { regions: regionEntries });
  writeJsonFile(path.join(cacheDir, 'indexes', 'variables.json'), {
    variables: buildBundleVariablesIndex(pageEntries),
  });
  writeJsonFile(path.join(cacheDir, 'indexes', 'components.json'), {
    components: buildBundleComponentsIndex(pageEntries),
  });
  writeJsonFile(path.join(cacheDir, 'indexes', 'css.json'), buildBundleCssIndex(pageEntries));

  return cacheDir;
}

function persistResult(result, job) {
  if (result && (result.kind === 'figma-bundle' || result.bundleId)) {
    return writeBundleToCache(result, job);
  }
  return writeExtractionToCache(result, job);
}

export function writeBase64ToRelativePath(baseDir, relativePath, base64Data) {
  const filePath = resolveSafeRelativePath(baseDir, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return filePath;
}

function writeAssetToLegacyCache(cacheRoot, fileKey, nodeId, asset) {
  const cacheDir = resolveLegacyCacheDir(cacheRoot, fileKey, nodeId);
  const assetsDir = path.join(cacheDir, 'assets');
  fs.mkdirSync(assetsDir, { recursive: true });

  const rawFileName = asset.fileName || `${sanitizePathSegment(asset.nodeId)}.${asset.format.toLowerCase()}`;
  const fileName = path.basename(sanitizePathSegment(rawFileName));
  const filePath = path.join(assetsDir, fileName);
  fs.writeFileSync(filePath, Buffer.from(asset.base64, 'base64'));
  return filePath;
}

function writeScreenshotToLegacyCache(cacheRoot, fileKey, nodeId, base64Data) {
  const cacheDir = resolveLegacyCacheDir(cacheRoot, fileKey, nodeId);
  fs.mkdirSync(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, 'screenshot.png');
  fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
  return filePath;
}

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

function handleHealth(_request, response) {
  sendJson(response, 200, {
    ok: true,
    pluginConnected: hasPluginConnection(),
    uptime: Math.round((Date.now() - startedAt) / 1000),
    activeJobs: pendingJobs.size,
    defaultCacheRoot: DEFAULT_CACHE_ROOT,
  });
}

function handleCapabilities(_request, response) {
  const registry = loadCapabilitiesRegistry();
  sendJson(response, registry.ok ? 200 : 500, registry);
}

function handleEvents(_request, response) {
  addSseClient(response);
}

async function dispatchJob(response, type, target, options, context) {
  if (!hasPluginConnection()) {
    sendJson(response, 503, {
      ok: false,
      errorCode: 'NO_PLUGIN_CONNECTION',
      message: 'No Figma plugin connected. Open Figma Desktop, run the plugin, and retry.',
    });
    return;
  }

  const { job, promise } = createJob(type, target, options || {}, context || {});
  broadcastSse(type, {
    jobId: job.jobId,
    target: job.target,
    options: job.options,
  });

  try {
    const result = await promise;
    const cacheDir = persistResult(result, job);
    safeSendJson(response, 200, { ok: true, cacheDir, result });
  } catch (error) {
    safeSendJson(response, 504, { ok: false, error: `extraction failed: ${error.message}` });
  }
}

async function handleExtract(request, response) {
  const body = await readBody(request);
  if (!body || !body.input) {
    sendJson(response, 400, { ok: false, error: 'missing input field' });
    return;
  }

  const parsed = parseFigmaInput(body.input);
  await dispatchJob(response, 'extract', {
    input: body.input,
    fileKey: parsed.fileKey,
    nodeId: parsed.nodeId,
  }, body.options || {}, body.context || {});
}

async function handleExtractSelection(request, response) {
  const body = (await readBody(request)) || {};
  await dispatchJob(response, 'extract-selection', {}, body.options || {}, body.context || {});
}

async function handleExtractPages(request, response) {
  const body = (await readBody(request)) || {};
  if (!Array.isArray(body.pages) || body.pages.length === 0) {
    sendJson(response, 400, { ok: false, error: 'missing pages array' });
    return;
  }
  await dispatchJob(response, 'extract-pages', { pages: body.pages }, body.options || {}, body.context || {});
}

async function handleExtractSelectedPagesBundle(request, response) {
  const body = (await readBody(request)) || {};
  await dispatchJob(response, 'extract-selected-pages-bundle', {}, body.options || {}, body.context || {});
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

async function handleJobProgress(request, response, jobId) {
  const body = (await readBody(request)) || {};
  const job = pendingJobs.get(jobId);
  if (!job) {
    sendJson(response, 404, { ok: false, error: 'job not found' });
    return;
  }

  job.progress = {
    text: body.text || null,
    state: body.state || null,
    reportedAt: new Date().toISOString(),
  };
  touchJob(job, 'progress');
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

  const cacheRoot = getJobCacheRoot(job);

  let baseDir = null;
  let filePath = null;
  let relativePath = body.relativePath || null;

  if (body.bundleId) {
    baseDir = resolveBundleCacheDir(cacheRoot, body.bundleId);
  }

  if (!baseDir && relativePath) {
    const fileKey = job.target?.fileKey || 'unknown-file';
    const rootNodeId = body.rootNodeId || job.target?.nodeId || body.nodeId || 'unknown-node';
    baseDir = resolveLegacyCacheDir(cacheRoot, fileKey, rootNodeId);
  }

  if (baseDir) {
    try {
      if (relativePath) {
        resolveSafeRelativePath(baseDir, relativePath);
      }
    } catch (error) {
      sendJson(response, 400, { ok: false, error: `invalid relativePath: ${error.message}` });
      return;
    }
  }

  if (baseDir && relativePath) {
    prepareJobOutputDir(job, baseDir);
    filePath = writeBase64ToRelativePath(baseDir, relativePath, body.base64);
  } else if (body.isScreenshot) {
    const fileKey = job.target?.fileKey || 'unknown-file';
    const rootNodeId = body.rootNodeId || job.target?.nodeId || body.nodeId || 'unknown-node';
    prepareJobOutputDir(job, resolveLegacyCacheDir(cacheRoot, fileKey, rootNodeId));
    filePath = writeScreenshotToLegacyCache(cacheRoot, fileKey, rootNodeId, body.base64);
    relativePath = 'screenshot.png';
  } else {
    const fileKey = job.target?.fileKey || 'unknown-file';
    const rootNodeId = body.rootNodeId || job.target?.nodeId || body.nodeId || 'unknown-node';
    prepareJobOutputDir(job, resolveLegacyCacheDir(cacheRoot, fileKey, rootNodeId));
    filePath = writeAssetToLegacyCache(cacheRoot, fileKey, rootNodeId, body);
  }

  touchJob(job, 'asset');

  job.assets.push({
    type: body.isScreenshot ? 'screenshot' : 'export',
    screenshotKind: body.screenshotKind || null,
    nodeId: body.nodeId || null,
    pageId: body.pageId || null,
    filePath,
    relativePath,
  });

  sendJson(response, 200, { ok: true });
}

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
      return;
    }
    if (request.method === 'GET' && pathname === '/capabilities') {
      handleCapabilities(request, response);
      return;
    }
    if (request.method === 'GET' && pathname === '/events') {
      handleEvents(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/extract') {
      await handleExtract(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/extract-selection') {
      await handleExtractSelection(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/extract-pages') {
      await handleExtractPages(request, response);
      return;
    }
    if (request.method === 'POST' && pathname === '/extract-selected-pages-bundle') {
      await handleExtractSelectedPagesBundle(request, response);
      return;
    }

    const jobResultMatch = pathname.match(/^\/jobs\/([^/]+)\/result$/);
    if (request.method === 'POST' && jobResultMatch) {
      await handleJobResult(request, response, jobResultMatch[1]);
      return;
    }

    const jobProgressMatch = pathname.match(/^\/jobs\/([^/]+)\/progress$/);
    if (request.method === 'POST' && jobProgressMatch) {
      await handleJobProgress(request, response, jobProgressMatch[1]);
      return;
    }

    const jobAssetMatch = pathname.match(/^\/jobs\/([^/]+)\/asset$/);
    if (request.method === 'POST' && jobAssetMatch) {
      await handleJobAsset(request, response, jobAssetMatch[1]);
      return;
    }

    sendJson(response, 404, { ok: false, error: 'not found' });
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

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Figma Bridge running at http://localhost:${PORT}`);
  });
}
