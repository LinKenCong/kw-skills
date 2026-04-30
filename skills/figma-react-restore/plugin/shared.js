(function initPluginShared(globalScope) {
  const protocol = globalScope.FrrProtocol || {};

  class ServiceRequestError extends Error {
    constructor(message, options) {
      super(message);
      this.name = 'ServiceRequestError';
      this.code = options && options.code ? options.code : 'SERVICE_REQUEST_FAILED';
      this.httpStatus = options && typeof options.httpStatus === 'number' ? options.httpStatus : 500;
      this.recoverable = options && typeof options.recoverable === 'boolean' ? options.recoverable : false;
      this.hint = options && options.hint ? options.hint : undefined;
      this.retryable = options && typeof options.retryable === 'boolean' ? options.retryable : false;
      this.details = options && options.details ? options.details : undefined;
    }
  }

  function computeBackoffDelay(attempt, baseDelay, maxDelay) {
    const base = typeof baseDelay === 'number' && baseDelay > 0 ? baseDelay : 250;
    const max = typeof maxDelay === 'number' && maxDelay > 0 ? maxDelay : 2000;
    const jitter = 0.85 + Math.random() * 0.3;
    const delay = Math.min(max, base * (2 ** Math.max(0, attempt - 1)));
    return Math.round(delay * jitter);
  }

  function shouldRetryServiceError(error) {
    if (!error) return false;
    if (error.retryable === true) return true;
    if (Array.isArray(protocol.NON_RETRYABLE_UPLOAD_CODES) && protocol.NON_RETRYABLE_UPLOAD_CODES.includes(error.code)) return false;
    if (Array.isArray(protocol.RETRYABLE_ERROR_CODES) && protocol.RETRYABLE_ERROR_CODES.includes(error.code)) return true;
    if (Array.isArray(protocol.RETRYABLE_HTTP_STATUSES) && protocol.RETRYABLE_HTTP_STATUSES.includes(error.httpStatus)) return true;
    return false;
  }

  function normalizeServiceError(payload, fallbackStatus) {
    const bodyError = payload && payload.error ? payload.error : null;
    const message = bodyError && bodyError.message ? bodyError.message : `HTTP ${fallbackStatus}`;
    const error = new ServiceRequestError(message, {
      code: bodyError && bodyError.code ? bodyError.code : 'SERVICE_REQUEST_FAILED',
      httpStatus: fallbackStatus,
      recoverable: bodyError && typeof bodyError.recoverable === 'boolean' ? bodyError.recoverable : fallbackStatus >= 500,
      hint: bodyError && bodyError.hint ? bodyError.hint : undefined,
      details: bodyError && bodyError.details ? bodyError.details : undefined,
    });
    error.retryable = shouldRetryServiceError(error);
    return error;
  }

  function createJobTracker() {
    const jobs = {};
    const terminal = new Set([
      protocol.JOB_STATUS && protocol.JOB_STATUS.completed,
      protocol.JOB_STATUS && protocol.JOB_STATUS.failed,
      protocol.JOB_STATUS && protocol.JOB_STATUS.canceled,
    ].filter(Boolean));

    function ensure(jobId) {
      if (!jobs[jobId]) {
        jobs[jobId] = {
          jobId,
          status: protocol.JOB_STATUS ? protocol.JOB_STATUS.queued : 'queued',
          attempts: {},
          updatedAt: Date.now(),
          source: 'unknown',
        };
      }
      return jobs[jobId];
    }

    return {
      upsert(job, source) {
        const entry = ensure(job.jobId);
        if (terminal.has(entry.status)) return entry;
        entry.source = source || entry.source;
        entry.jobSecret = job.jobSecret || entry.jobSecret;
        entry.capability = job.capability || entry.capability;
        entry.status = entry.status || (protocol.JOB_STATUS ? protocol.JOB_STATUS.queued : 'queued');
        entry.updatedAt = Date.now();
        return entry;
      },
      mark(jobId, status, patch) {
        const entry = ensure(jobId);
        if (terminal.has(entry.status) && !terminal.has(status)) return entry;
        entry.status = status;
        entry.updatedAt = Date.now();
        if (patch && typeof patch === 'object') Object.assign(entry, patch);
        return entry;
      },
      markAttempt(jobId, key, attempt) {
        const entry = ensure(jobId);
        entry.attempts[key] = attempt;
        entry.updatedAt = Date.now();
        return entry;
      },
      get(jobId) {
        return jobs[jobId];
      },
      values() {
        return Object.values(jobs);
      },
      canStart(jobId) {
        const entry = jobs[jobId];
        if (!entry) return true;
        return !terminal.has(entry.status) && entry.status !== (protocol.JOB_STATUS ? protocol.JOB_STATUS.extracting : 'extracting') && entry.status !== (protocol.JOB_STATUS ? protocol.JOB_STATUS.uploading : 'uploading') && entry.status !== (protocol.JOB_STATUS ? protocol.JOB_STATUS.reporting : 'reporting');
      },
      isTerminal(jobId) {
        const entry = jobs[jobId];
        return Boolean(entry && terminal.has(entry.status));
      },
    };
  }

  globalScope.FrrPluginShared = {
    ServiceRequestError,
    computeBackoffDelay,
    normalizeServiceError,
    shouldRetryServiceError,
    createJobTracker,
  };
})(typeof window === 'undefined' ? globalThis : window);
