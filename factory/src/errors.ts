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
