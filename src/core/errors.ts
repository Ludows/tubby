export class TubbyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TubbyError";
  }
}

export class PipelineError extends TubbyError {
  readonly step: string;
  readonly payload: unknown;
  readonly originalError: Error;

  constructor(step: string, payload: unknown, originalError: Error) {
    super(`Pipeline failed at step "${step}": ${originalError.message}`);
    this.name = "PipelineError";
    this.step = step;
    this.payload = payload;
    this.originalError = originalError;
  }
}

export class TimeoutError extends TubbyError {
  readonly step: string;
  readonly ms: number;

  constructor(step: string, ms: number) {
    super(`Step "${step}" timed out after ${ms}ms`);
    this.name = "TimeoutError";
    this.step = step;
    this.ms = ms;
  }
}
