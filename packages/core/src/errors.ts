/**
 * Every failure a source can raise on purpose. The server maps these onto MCP
 * tool errors, so the wording reaches the model — keep messages actionable.
 */
export type ErrorCode =
  | "upstream_error"
  | "upstream_timeout"
  | "upstream_unavailable"
  | "rate_limited"
  | "not_found"
  | "invalid_input"
  | "missing_credentials"
  | "internal";

export interface AgoraErrorOptions {
  code?: ErrorCode;
  /** HTTP-ish status, used for logging and for mapping back to a response. */
  status?: number;
  retryable?: boolean;
  cause?: unknown;
  details?: Record<string, unknown>;
}

export class AgoraError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: AgoraErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? "internal";
    this.status = options.status ?? 500;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }
}

/** Upstream answered, but with a status we can't use. */
export class UpstreamError extends AgoraError {
  constructor(message: string, options: AgoraErrorOptions = {}) {
    super(message, {
      code: "upstream_error",
      status: 502,
      // 5xx is worth another attempt; a 4xx from upstream is our fault.
      retryable: (options.status ?? 502) >= 500,
      ...options,
    });
  }
}

export class UpstreamTimeoutError extends AgoraError {
  constructor(message: string, options: AgoraErrorOptions = {}) {
    super(message, { code: "upstream_timeout", status: 504, retryable: true, ...options });
  }
}

export class UpstreamUnavailableError extends AgoraError {
  constructor(message: string, options: AgoraErrorOptions = {}) {
    super(message, { code: "upstream_unavailable", status: 503, retryable: true, ...options });
  }
}

export class RateLimitError extends AgoraError {
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, options: AgoraErrorOptions & { retryAfterSeconds?: number } = {}) {
    super(message, { code: "rate_limited", status: 429, retryable: true, ...options });
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export class NotFoundError extends AgoraError {
  constructor(message: string, options: AgoraErrorOptions = {}) {
    super(message, { code: "not_found", status: 404, ...options });
  }
}

export class InvalidInputError extends AgoraError {
  constructor(message: string, options: AgoraErrorOptions = {}) {
    super(message, { code: "invalid_input", status: 400, ...options });
  }
}

/** A source needs an API token that isn't configured on this deployment. */
export class MissingCredentialsError extends AgoraError {
  constructor(envVars: readonly string[], options: AgoraErrorOptions = {}) {
    super(
      `This source is not configured on this server: missing ${envVars.join(", ")}.`,
      { code: "missing_credentials", status: 503, details: { envVars }, ...options },
    );
  }
}

export function isAgoraError(error: unknown): error is AgoraError {
  return error instanceof AgoraError;
}

/** Message safe to hand back to a model: never leaks a stack or a token. */
export function toolErrorMessage(error: unknown): string {
  if (isAgoraError(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
