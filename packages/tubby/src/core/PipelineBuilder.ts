import { PipelineError } from "./errors";
import type {
  CombineOptions,
  Context,
  EnsureCondition,
  EnsureEntry,
  EnsureMessage,
  EnsureOptions,
  InspectOptions,
  MeasuredResult,
  Next,
  Step,
  StepEvent,
  StepProvider,
  StepSnapshot,
  Stop,
} from "./types";
import { StopSignal } from "./types";

function getStepName<TPayload, TContext extends Context>(
  step: Step<TPayload, TContext>,
): string {
  return (
    step.name ??
    (step.constructor && step.constructor.name !== "Object"
      ? step.constructor.name
      : "anonymous")
  );
}

export class PipelineBuilder<
  TPayload,
  TContext extends Context = Record<string, never>,
> {
  private _context: TContext;
  private _payload: TPayload;
  private _stepProviders: StepProvider<TPayload, TContext>[] = [];
  private _ensures: EnsureEntry<TPayload, TContext>[] = [];
  private _beforeHooks: ((
    payload: TPayload,
    context: Readonly<TContext>,
  ) => void | Promise<void>)[] = [];
  private _afterHooks: ((
    result: TPayload,
    context: Readonly<TContext>,
    duration: number,
  ) => void | Promise<void>)[] = [];
  private _finallyHooks: ((
    context: Readonly<TContext>,
    duration: number,
  ) => void | Promise<void>)[] = [];
  private _catchHandler:
    | ((
        error: PipelineError,
        payload: TPayload,
        context: Readonly<TContext>,
      ) => TPayload | Promise<TPayload>)
    | null = null;
  private _onStepCallbacks: ((
    event: StepEvent<TPayload, TContext>,
  ) => void | Promise<void>)[] = [];
  private _inspectOptions: InspectOptions | null = null;
  private _measureEnabled = false;
  private _skippedSteps: Set<Step<TPayload, TContext>> = new Set();

  constructor(payload: TPayload) {
    this._payload = payload;
    this._context = {} as TContext;
  }

  give<TNewContext extends Context>(
    context: TNewContext,
  ): PipelineBuilder<TPayload, TContext & TNewContext> {
    const builder = this as unknown as PipelineBuilder<
      TPayload,
      TContext & TNewContext
    >;
    builder._context = { ...builder._context, ...context } as TContext &
      TNewContext;
    return builder;
  }

  ensure(
    condition: EnsureCondition<TPayload, TContext>,
    message?: EnsureMessage<TPayload, TContext>,
    options?: EnsureOptions,
  ): PipelineBuilder<TPayload, TContext> {
    this._ensures.push({ condition, message, options });
    return this;
  }

  through(
    steps:
      | Step<TPayload, TContext>[]
      | ((
          payload: TPayload,
          context: Readonly<TContext>,
        ) => Step<TPayload, TContext>[] | Promise<Step<TPayload, TContext>[]>),
  ): PipelineBuilder<TPayload, TContext> {
    this._stepProviders.push(steps);
    return this;
  }

  combine(
    pipelineA: Step<TPayload, TContext>,
    pipelineB: Step<TPayload, TContext>,
    options?: CombineOptions<TPayload>,
  ): PipelineBuilder<TPayload, TContext> {
    const strategy = options?.strategy ?? "sequential";
    const mergeFn =
      options?.merge ??
      ((a: TPayload, b: TPayload) =>
        Object.assign({}, a as object, b as object) as TPayload);

    const combinedStep: Step<TPayload, TContext> = {
      name: "combine",
      async handle(payload, next, context) {
        if (strategy === "sequential") {
          const nextA: Next<TPayload> = async (p) => p;
          const stopA: Stop<TPayload> = (v) => new StopSignal(v);
          let resultA = await pipelineA.handle(payload, nextA, context, stopA);
          if (resultA instanceof StopSignal) resultA = resultA.value;
          const nextB: Next<TPayload> = async (p) => p;
          const stopB: Stop<TPayload> = (v) => new StopSignal(v);
          let resultB = await pipelineB.handle(resultA, nextB, context, stopB);
          if (resultB instanceof StopSignal) resultB = resultB.value;
          return next(resultB);
        } else {
          const nextNoop: Next<TPayload> = async (p) => p;
          const stopNoop: Stop<TPayload> = (v) => new StopSignal(v);
          const [resultA, resultB] = await Promise.all([
            pipelineA.handle(payload, nextNoop, context, stopNoop),
            pipelineB.handle(payload, nextNoop, context, stopNoop),
          ]);
          const a = resultA instanceof StopSignal ? resultA.value : resultA;
          const b = resultB instanceof StopSignal ? resultB.value : resultB;
          return next(mergeFn(a, b));
        }
      },
    };

    this._stepProviders.push([combinedStep]);
    return this;
  }

  before(
    fn: (
      payload: TPayload,
      context: Readonly<TContext>,
    ) => void | Promise<void>,
  ): PipelineBuilder<TPayload, TContext> {
    this._beforeHooks.push(fn);
    return this;
  }

  after(
    fn: (
      result: TPayload,
      context: Readonly<TContext>,
      duration: number,
    ) => void | Promise<void>,
  ): PipelineBuilder<TPayload, TContext> {
    this._afterHooks.push(fn);
    return this;
  }

  finally(
    fn: (context: Readonly<TContext>, duration: number) => void | Promise<void>,
  ): PipelineBuilder<TPayload, TContext> {
    this._finallyHooks.push(fn);
    return this;
  }

  catch(
    handler: (
      error: PipelineError,
      payload: TPayload,
      context: Readonly<TContext>,
    ) => TPayload | Promise<TPayload>,
  ): PipelineBuilder<TPayload, TContext> {
    this._catchHandler = handler;
    return this;
  }

  onStep(
    callback: (event: StepEvent<TPayload, TContext>) => void | Promise<void>,
  ): PipelineBuilder<TPayload, TContext> {
    this._onStepCallbacks.push(callback);
    return this;
  }

  inspect(options?: InspectOptions): PipelineBuilder<TPayload, TContext> {
    this._inspectOptions = options ?? {};
    return this;
  }

  measure(): PipelineBuilder<TPayload, TContext> {
    this._measureEnabled = true;
    return this;
  }

  skip(
    ...steps: Step<TPayload, TContext>[]
  ): PipelineBuilder<TPayload, TContext> {
    for (const s of steps) this._skippedSteps.add(s);
    return this;
  }

  private async _resolveSteps(): Promise<Step<TPayload, TContext>[]> {
    const allSteps: Step<TPayload, TContext>[] = [];
    for (const provider of this._stepProviders) {
      if (Array.isArray(provider)) {
        allSteps.push(...provider);
      } else {
        const resolved = await provider(
          this._payload,
          this._context as Readonly<TContext>,
        );
        allSteps.push(...resolved);
      }
    }
    return allSteps;
  }

  private async _checkEnsures(): Promise<boolean> {
    if (this._ensures.length === 0) return true;

    const allWarnings: string[] = [];
    let blocked = false;

    for (const entry of this._ensures) {
      const passed = await entry.condition(
        this._payload,
        this._context as Readonly<TContext>,
      );
      if (!passed) {
        blocked = true;
        let msg = "Condition failed";
        if (entry.message) {
          msg =
            typeof entry.message === "function"
              ? entry.message(
                  this._payload,
                  this._context as Readonly<TContext>,
                )
              : entry.message;
        }
        const strategy = entry.options?.strategy ?? "first";
        if (strategy === "first") {
          console.warn(
            `[Tubby] Pipeline blocked by ensure(): ${msg}\n  payload:`,
            this._payload,
          );
          return false;
        } else {
          allWarnings.push(msg);
        }
      }
    }

    if (blocked && allWarnings.length > 0) {
      for (const msg of allWarnings) {
        console.warn(
          `[Tubby] Pipeline blocked by ensure(): ${msg}\n  payload:`,
          this._payload,
        );
      }
      return false;
    }

    return true;
  }

  private async _emitOnStep(
    event: StepEvent<TPayload, TContext>,
  ): Promise<void> {
    for (const cb of this._onStepCallbacks) {
      try {
        await cb(event);
      } catch {
        // silently ignored
      }
    }
  }

  private _emitInspect(
    stepName: string,
    status: "completed" | "skipped" | "failed",
    duration: number,
    payload: TPayload,
    error?: Error,
  ): void {
    if (!this._inspectOptions) return;
    const logger = this._inspectOptions.logger ?? console.log;
    const showPayload = this._inspectOptions.showPayload ?? true;
    const showTimings = this._inspectOptions.showTimings ?? true;

    const icon =
      status === "completed" ? "✅" : status === "skipped" ? "⏭️" : "❌";
    let line = `  ${icon} ${stepName.padEnd(20)}`;
    if (showTimings) line += `${duration}ms`;
    if (status === "skipped") {
      line += `  [skipped]`;
    } else if (status === "failed" && error) {
      line += `  ${error.constructor.name}: ${error.message}`;
    } else if (showPayload) {
      line += `  ${JSON.stringify(payload)}`;
    }
    logger(line);
  }

  private async _executeSteps(
    steps: Step<TPayload, TContext>[],
    snapshots?: StepSnapshot<TPayload>[],
    metrics?: Record<string, number>,
  ): Promise<TPayload> {
    const context = Object.freeze({ ...this._context }) as Readonly<TContext>;

    const buildChain = (index: number): Next<TPayload> => {
      return async (currentPayload: TPayload): Promise<TPayload> => {
        if (index >= steps.length) return currentPayload;

        const step = steps[index];
        const stepName = getStepName(step);
        const isSkipped = this._skippedSteps.has(step);

        if (isSkipped) {
          const event: StepEvent<TPayload, TContext> = {
            step: stepName,
            status: "skipped",
            payloadBefore: currentPayload,
            payloadAfter: currentPayload,
            context,
            duration: 0,
          };
          await this._emitOnStep(event);
          this._emitInspect(stepName, "skipped", 0, currentPayload);

          if (snapshots) {
            snapshots.push({
              step: stepName,
              payload: currentPayload,
              duration: 0,
              skipped: true,
            });
          }

          return buildChain(index + 1)(currentPayload);
        }

        const start = performance.now();
        const payloadBefore = currentPayload;
        let nextCalled = false;

        const next: Next<TPayload> = async (p: TPayload) => {
          if (nextCalled) return p;
          nextCalled = true;

          // Record snapshot/event BEFORE chaining to next step
          const duration = Math.round(performance.now() - start);
          const event: StepEvent<TPayload, TContext> = {
            step: stepName,
            status: "completed",
            payloadBefore,
            payloadAfter: p,
            context,
            duration,
          };
          await this._emitOnStep(event);
          this._emitInspect(stepName, "completed", duration, p);
          if (snapshots) {
            snapshots.push({ step: stepName, payload: p, duration });
          }
          if (metrics) metrics[stepName] = duration;

          return buildChain(index + 1)(p);
        };

        const stop: Stop<TPayload> = (value: TPayload) => new StopSignal(value);

        try {
          const result = await step.handle(currentPayload, next, context, stop);

          if (result instanceof StopSignal) {
            const duration = Math.round(performance.now() - start);
            const event: StepEvent<TPayload, TContext> = {
              step: stepName,
              status: "completed",
              payloadBefore,
              payloadAfter: result.value,
              context,
              duration,
            };
            await this._emitOnStep(event);
            this._emitInspect(stepName, "completed", duration, result.value);
            if (snapshots) {
              snapshots.push({
                step: stepName,
                payload: result.value,
                duration,
              });
            }
            if (metrics) metrics[stepName] = duration;
            throw new _StopExecution(result.value);
          }

          // If next() was not called by the step, we still need to record it
          if (!nextCalled) {
            const duration = Math.round(performance.now() - start);
            const event: StepEvent<TPayload, TContext> = {
              step: stepName,
              status: "completed",
              payloadBefore,
              payloadAfter: result,
              context,
              duration,
            };
            await this._emitOnStep(event);
            this._emitInspect(stepName, "completed", duration, result);
            if (snapshots) {
              snapshots.push({ step: stepName, payload: result, duration });
            }
            if (metrics) metrics[stepName] = duration;
          }

          return result;
        } catch (err) {
          if (err instanceof _StopExecution) throw err;

          const error = err instanceof Error ? err : new Error(String(err));
          const duration = Math.round(performance.now() - start);

          const failEvent: StepEvent<TPayload, TContext> = {
            step: stepName,
            status: "failed",
            payloadBefore,
            payloadAfter: currentPayload,
            context,
            duration,
            error,
          };
          await this._emitOnStep(failEvent);
          this._emitInspect(
            stepName,
            "failed",
            duration,
            currentPayload,
            error,
          );

          if (snapshots) {
            snapshots.push({
              step: stepName,
              payload: currentPayload,
              duration,
            });
          }
          if (metrics) metrics[stepName] = duration;

          // Try step-level onError first
          if (step.onError) {
            const recovered = await step.onError(
              error,
              currentPayload,
              context,
            );
            return buildChain(index + 1)(recovered);
          }

          // Wrap in PipelineError
          throw new PipelineError(stepName, currentPayload, error);
        }
      };
    };

    return buildChain(0)(this._payload);
  }

  private async _execute(
    snapshots?: StepSnapshot<TPayload>[],
    metrics?: Record<string, number>,
  ): Promise<{
    result: TPayload | null;
    ensureFailed: boolean;
    stopped: boolean;
  }> {
    const startTime = performance.now();
    let ensureFailed = false;
    let stopped = false;

    try {
      // 1. Check ensures
      try {
        const ensurePassed = await this._checkEnsures();
        if (!ensurePassed) {
          ensureFailed = true;
          return { result: null, ensureFailed, stopped };
        }
      } catch (err) {
        // If ensure throws, propagate to catch handler
        const error = err instanceof Error ? err : new Error(String(err));
        if (this._catchHandler) {
          const pipelineError =
            err instanceof PipelineError
              ? err
              : new PipelineError("ensure", this._payload, error);
          const recovered = await this._catchHandler(
            pipelineError,
            this._payload,
            this._context as Readonly<TContext>,
          );
          return { result: recovered, ensureFailed: false, stopped: false };
        }
        throw err;
      }

      const context = this._context as Readonly<TContext>;

      // 2. Before hooks
      for (const hook of this._beforeHooks) {
        try {
          await hook(this._payload, context);
        } catch (err) {
          const error = err instanceof Error ? err : new Error(String(err));
          throw new PipelineError("before", this._payload, error);
        }
      }

      // 3. Resolve and execute steps
      const steps = await this._resolveSteps();

      // Inspect header
      if (this._inspectOptions) {
        const logger = this._inspectOptions.logger ?? console.log;
        logger("Tubby Pipeline ────────────────────────────");
      }

      let result: TPayload;
      try {
        result = await this._executeSteps(steps, snapshots, metrics);
      } catch (err) {
        if (err instanceof _StopExecution) {
          stopped = true;
          result = err.value as TPayload;

          // Inspect footer
          if (this._inspectOptions) {
            const logger = this._inspectOptions.logger ?? console.log;
            const totalDuration = Math.round(performance.now() - startTime);
            logger("────────────────────────────────────────────");
            logger(`Total: ${totalDuration}ms`);
          }

          return { result, ensureFailed: false, stopped: true };
        }
        throw err;
      }

      // Inspect footer
      if (this._inspectOptions) {
        const logger = this._inspectOptions.logger ?? console.log;
        const totalDuration = Math.round(performance.now() - startTime);
        logger("────────────────────────────────────────────");
        logger(`Total: ${totalDuration}ms`);
      }

      // 4. After hooks
      const totalDuration = Math.round(performance.now() - startTime);
      for (const hook of this._afterHooks) {
        await hook(result, context, totalDuration);
      }

      return { result, ensureFailed: false, stopped: false };
    } catch (err) {
      if (err instanceof PipelineError && this._catchHandler) {
        const recovered = await this._catchHandler(
          err,
          this._payload,
          this._context as Readonly<TContext>,
        );
        return { result: recovered, ensureFailed: false, stopped: false };
      }
      throw err;
    } finally {
      const totalDuration = Math.round(performance.now() - startTime);
      for (const hook of this._finallyHooks) {
        try {
          await hook(this._context as Readonly<TContext>, totalDuration);
        } catch (finallyErr) {
          // If finally throws and there's no existing error, propagate
          // If there is an existing error, don't overwrite
          if (!ensureFailed && !stopped) {
            throw finallyErr;
          }
        }
      }
    }
  }

  async thenReturn(): Promise<TPayload | null>;
  async thenReturn(): Promise<MeasuredResult<TPayload> | null>;
  async thenReturn(): Promise<TPayload | MeasuredResult<TPayload> | null> {
    const metrics: Record<string, number> = {};
    const startTime = performance.now();
    const { result, ensureFailed } = await this._execute(
      undefined,
      this._measureEnabled ? metrics : undefined,
    );

    if (ensureFailed) return null;

    if (this._measureEnabled) {
      return {
        result: result as TPayload,
        metrics,
        totalDuration: Math.round(performance.now() - startTime),
      };
    }

    return result;
  }

  async thenCall(
    fn: (result: TPayload) => void | Promise<void>,
  ): Promise<void> {
    const { result, ensureFailed } = await this._execute();
    if (!ensureFailed && result !== null) {
      await fn(result);
    }
  }

  async thenThrow(): Promise<TPayload> {
    const { result } = await this._execute();
    return result as TPayload;
  }

  async collect(): Promise<StepSnapshot<TPayload>[]> {
    const snapshots: StepSnapshot<TPayload>[] = [];
    const { ensureFailed } = await this._execute(snapshots);
    if (ensureFailed) return [];
    return snapshots;
  }
}

// Internal marker for stop() flow
class _StopExecution {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }
}
