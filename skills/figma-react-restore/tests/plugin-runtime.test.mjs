import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

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
