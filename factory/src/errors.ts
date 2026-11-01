export class FactoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FactoryError';
  }
}

export class ConfigValidationError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigValidationError';
  }
}

export class WorkspaceError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

export class WriteBoundaryError extends WorkspaceError {
  constructor(message: string) {
    super(message);
    this.name = 'WriteBoundaryError';
  }
}

export class MediaError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'MediaError';
  }
}

export class TimelineError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'TimelineError';
  }
}

export class SceneRenderError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'SceneRenderError';
  }
}

export class SceneModuleError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'SceneModuleError';
  }
}

export class PreproductionError extends FactoryError {
  constructor(message: string) {
    super(message);
    this.name = 'PreproductionError';
  }
}

export type RetrievalErrorCode =
  | 'malformed-url'
  | 'unsupported-protocol'
  | 'credentials-in-url'
  | 'unexpected-port'
  | 'ip-literal-not-allowed'
  | 'host-not-allowed'
  | 'blocked-address'
  | 'dns-failure'
  | 'too-many-redirects'
  | 'redirect-without-location'
  | 'url-expired'
  | 'http-error'
  | 'timeout'
  | 'declared-too-large'
  | 'too-large'
  | 'content-type-not-allowed'
  | 'truncated'
  | 'empty-body'
  | 'magic-byte-mismatch'
  | 'destination-not-allowed';

/**
 * `recoverable` marks failures that a fresh provider task query can fix — most
 * importantly an expired signed URL. It never means "submit the job again".
 */
export class RetrievalError extends FactoryError {
  readonly code: RetrievalErrorCode;
  readonly recoverable: boolean;

  constructor(code: RetrievalErrorCode, message: string, recoverable = false) {
    super(message);
    this.name = 'RetrievalError';
    this.code = code;
    this.recoverable = recoverable;
  }
}
