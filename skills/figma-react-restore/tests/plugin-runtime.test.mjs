import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const protocolPath = path.resolve('plugin/protocol.js');
const sharedPath = path.resolve('plugin/shared.js');

await import(`file://${protocolPath}`);
await import(`file://${sharedPath}`);

const protocol = globalThis.FrrProtocol;
const shared = globalThis.FrrPluginShared;

test('plugin shared job tracker prevents duplicate non-terminal handling', () => {
  const tracker = shared.createJobTracker();
  tracker.upsert({ jobId: 'job_1', capability: 'extract.selection', jobSecret: 'sec' }, 'received');
  assert.equal(tracker.canStart('job_1'), true);

  tracker.mark('job_1', protocol.JOB_STATUS.extracting);
  assert.equal(tracker.canStart('job_1'), false);

  tracker.mark('job_1', protocol.JOB_STATUS.completed);
  assert.equal(tracker.isTerminal('job_1'), true);
  assert.equal(tracker.canStart('job_1'), false);
});

test('plugin shared retry classifier marks transient and permanent upload errors', () => {
  const transient = new shared.ServiceRequestError('temporary', {
    code: 'NETWORK_ERROR',
    httpStatus: 503,
    recoverable: true,
    retryable: true,
  });
  assert.equal(shared.shouldRetryServiceError(transient), true);

  const permanent = new shared.ServiceRequestError('too large', {
    code: 'ARTIFACT_TOO_LARGE',
    httpStatus: 413,
    recoverable: false,
    retryable: false,
  });
  assert.equal(shared.shouldRetryServiceError(permanent), false);
});

test('plugin shared normalizeServiceError preserves code and retryability hints', () => {
  const error = shared.normalizeServiceError({
    ok: false,
    error: {
      code: 'UPLOAD_BASE64_TOO_LARGE',
      message: 'too big',
      recoverable: false,
      hint: 'reduce size',
    },
  }, 413);
  assert.equal(error.code, 'UPLOAD_BASE64_TOO_LARGE');
  assert.equal(error.recoverable, false);
  assert.equal(error.retryable, false);
  assert.equal(error.hint, 'reduce size');
});

test('plugin UI inlines protocol helpers for Figma __html__ runtime', () => {
  const html = fs.readFileSync(path.resolve('plugin/ui.html'), 'utf8');
  const protocolSource = fs.readFileSync(path.resolve('plugin/protocol.js'), 'utf8').trim();
  const sharedSource = fs.readFileSync(path.resolve('plugin/shared.js'), 'utf8').trim();
  assert.equal(/<script\s+src=/.test(html), false);
  assert.match(html, /globalScope\.FrrProtocol = protocol/);
  assert.match(html, /globalScope\.FrrPluginShared = /);
  assert.equal(html.includes(protocolSource), true);
  assert.equal(html.includes(sharedSource), true);
});

test('plugin UI waits for service ACK before terminal failure state', () => {
  const html = fs.readFileSync(path.resolve('plugin/ui.html'), 'utf8');
  assert.match(html, /await reportExtractionFailure\(message\.jobId, message\.error\)/);
  assert.match(html, /state\.jobTracker\.mark\(jobId, protocol\.JOB_STATUS\.reporting/);
  assert.match(html, /await postJobJson\(jobId, `\/jobs\/\$\{jobId\}\/result`/);
  assert.match(html, /state\.jobTracker\.mark\(jobId, protocol\.JOB_STATUS\.failed/);
  assert.match(html, /state\.jobTracker\.mark\(jobId, protocol\.JOB_STATUS\.orphaned/);
  assert.match(html, /code: typeof error\.code === 'string' \? error\.code : 'PLUGIN_EXCEPTION'/);
});

test('plugin UI uses stack-safe asset base64 conversion and keeps asset upload failures non-terminal', () => {
  const html = fs.readFileSync(path.resolve('plugin/ui.html'), 'utf8');
  assert.equal(html.includes('String.fromCharCode.apply'), false);
  assert.match(html, /for \(let j = i; j < end; j \+= 1\) chunk \+= String\.fromCharCode/);
  assert.match(html, /if \(artifact\.kind !== 'asset'\) throw error/);
  assert.match(html, /ASSET_ARTIFACT_UPLOAD_FAILED/);
});

test('plugin code scans text descendants without recursion', () => {
  const source = fs.readFileSync(path.resolve('plugin/code.js'), 'utf8');
  assert.doesNotMatch(source, /hasTextDescendant\(child\)/);
  assert.doesNotMatch(source, /\{[^\n}]*\.\.\./);
  assert.match(source, /function scanTextDescendant\(node\)/);
  assert.match(source, /new WeakSet\(\)/);
});

test('plugin code handles deep and cyclic text descendant scans', () => {
  const context = loadPluginCode();
  assert.equal(typeof context.hasTextDescendant, 'function');

  const root = { id: 'root', name: 'Root', type: 'FRAME', children: [] };
  let current = root;
  for (let i = 0; i < 12000; i += 1) {
    const child = { id: `n${i}`, name: `Node ${i}`, type: 'FRAME', children: [] };
    current.children = [child];
    current = child;
  }
  current.children = [{ id: 'text', name: 'Text', type: 'TEXT', characters: 'Hello', children: [] }];
  assert.doesNotThrow(() => context.hasTextDescendant(root));
  assert.equal(context.hasTextDescendant(root), true);

  const cycleRoot = { id: 'cycle-root', name: 'Cycle Root', type: 'FRAME', children: [] };
  const cycleChild = { id: 'cycle-child', name: 'Cycle Child', type: 'FRAME', children: [cycleRoot] };
  cycleRoot.children = [cycleChild];
  assert.doesNotThrow(() => context.hasTextDescendant(cycleRoot));
  assert.equal(context.hasTextDescendant(cycleRoot), false);
});

test('plugin extraction keeps raw evidence when assets are disabled or fail', async () => {
  const context = loadPluginCode();
  const selection = [{
    id: '1:1',
    name: 'Frame',
    type: 'FRAME',
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 320, height: 180 },
    fills: [],
    children: [{
      id: '1:2',
      name: 'Title',
      type: 'TEXT',
      visible: true,
      characters: 'Hello',
      absoluteBoundingBox: { x: 10, y: 10, width: 100, height: 24 },
      fills: [],
    }],
  }];
  context.figma.currentPage.selection = selection;

  context.messages.length = 0;
  context.exportAssets = async () => {
    throw new RangeError('Maximum call stack size exceeded');
  };
  await context.extractSelection({ jobId: 'job_fail', options: { assets: true } });
  const failedReady = context.messages.find((message) => message.type === 'extraction-ready' && message.jobId === 'job_fail');
  assert.ok(failedReady, 'expected extraction-ready when asset export fails');
  assert.equal(failedReady.extraction.texts[0].text, 'Hello');
  assert.ok(failedReady.extraction.warnings.some((warning) => warning.code === 'ASSET_EXPORT_FAILED'));

  context.messages.length = 0;
  context.exportAssets = async () => {
    throw new Error('should not be called');
  };
  await context.extractSelection({ jobId: 'job_no_assets', options: { assets: false } });
  const disabledReady = context.messages.find((message) => message.type === 'extraction-ready' && message.jobId === 'job_no_assets');
  assert.ok(disabledReady, 'expected extraction-ready when assets are disabled');
  assert.ok(disabledReady.extraction.warnings.some((warning) => warning.code === 'ASSET_EXPORT_DISABLED'));
});

test('CLI exposes no-assets extraction option', () => {
  const source = fs.readFileSync(path.resolve('src/cli/index.ts'), 'utf8');
  assert.match(source, /\.option\('--no-assets'/);
  assert.match(source, /assets: options\.assets !== false/);
});

function loadPluginCode() {
  const messages = [];
  const context = {
    __html__: '<html></html>',
    console,
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    WeakSet,
    RangeError,
    Error,
    figma: {
      showUI() {},
      ui: {
        onmessage: null,
        postMessage(message) {
          messages.push(message);
        },
      },
      on() {},
      root: { name: 'Mock File' },
      currentPage: {
        id: 'page',
        name: 'Page',
        selection: [],
      },
      getImageByHash() {
        return null;
      },
    },
    messages,
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.resolve('plugin/code.js'), 'utf8'), context, { filename: 'plugin/code.js' });
  return context;
}
