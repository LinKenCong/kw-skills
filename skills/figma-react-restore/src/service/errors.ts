import { z } from 'zod';
import type { ErrorPayload } from '../schema.js';

export type ServiceErrorOptions = {
  httpStatus?: number;
  recoverable?: boolean;
  hint?: string;
  details?: unknown;
  cause?: unknown;
};

export class ServiceError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly recoverable: boolean;
  readonly hint?: string;
  readonly details?: unknown;

  constructor(code: string, message: string, options: ServiceErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ServiceError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? 500;
    this.recoverable = options.recoverable ?? this.httpStatus < 500;
    if (options.hint !== undefined) this.hint = options.hint;
    if (options.details !== undefined) this.details = options.details;
  }
}

export class ServiceHttpError extends ServiceError {
  constructor(code: string, message: string, options: ServiceErrorOptions = {}) {
    super(code, message, options);
    this.name = 'ServiceHttpError';
  }
}

export function normalizeServiceError(error: unknown): ServiceError {
  if (error instanceof ServiceError) return error;
  if (error instanceof z.ZodError) {
    return new ServiceHttpError('SCHEMA_VALIDATION_FAILED', 'Invalid request payload', {
      httpStatus: 422,
      recoverable: true,
      hint: 'Check the request JSON shape and field constraints.',
      details: error.issues,
      cause: error,
    });
  }
  if (error instanceof SyntaxError) {
    return new ServiceHttpError('INVALID_JSON', 'Request body must be valid JSON', {
      httpStatus: 400,
      recoverable: true,
      hint: 'Send a valid application/json request body.',
      cause: error,
    });
  }
  if (error instanceof Error) {
    return new ServiceError('INTERNAL_ERROR', error.message, {
      httpStatus: 500,
      recoverable: false,
      hint: 'Inspect the runtime service logs for the original stack trace.',
      cause: error,
    });
  }
  return new ServiceError('INTERNAL_ERROR', String(error), {
    httpStatus: 500,
    recoverable: false,
  });
}

export function serializeServiceError(error: unknown): ErrorPayload & { details?: unknown } {
  const normalized = normalizeServiceError(error);
  return {
    code: normalized.code,
    message: normalized.message,
    httpStatus: normalized.httpStatus,
    recoverable: normalized.recoverable,
    ...(normalized.hint ? { hint: normalized.hint } : {}),
    ...(normalized.details !== undefined ? { details: normalized.details } : {}),
  };
}

export function httpStatusForError(error: unknown): number {
  return normalizeServiceError(error).httpStatus;
}
