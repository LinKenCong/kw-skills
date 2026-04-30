(function initProtocol(globalScope) {
  const protocol = {
    SERVICE_URL: 'http://localhost:49327',
    HEARTBEAT_MS: 5000,
    POLL_MS: 1000,
    UPLOAD_MAX_ATTEMPTS: 3,
    UPLOAD_RETRY_BASE_DELAY_MS: 400,
    UPLOAD_RETRY_MAX_DELAY_MS: 2400,
    JOB_STATUS: {
      queued: 'queued',
      extracting: 'extracting',
      uploading: 'uploading',
      reporting: 'reporting',
      completed: 'completed',
      failed: 'failed',
      canceled: 'canceled',
      orphaned: 'orphaned',
    },
    RETRYABLE_HTTP_STATUSES: [408, 425, 429, 500, 502, 503, 504],
    RETRYABLE_ERROR_CODES: ['NETWORK_ERROR', 'SERVICE_UNAVAILABLE', 'INTERNAL_ERROR', 'INVALID_JSON'],
    NON_RETRYABLE_UPLOAD_CODES: ['ARTIFACT_TOO_LARGE', 'UPLOAD_BASE64_TOO_LARGE', 'UNSUPPORTED_MEDIA_TYPE', 'MEDIA_TYPE_MISMATCH'],
  };
  globalScope.FrrProtocol = protocol;
})(typeof window === 'undefined' ? globalThis : window);
