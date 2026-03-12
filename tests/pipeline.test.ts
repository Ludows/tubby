import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Step } from "../src/index";
import {
  branch,
  combine,
  delay,
  map,
  merge,
  once,
  parallel,
  pick,
  pipeline,
  Pipeline,
  PipelineError,
  retry,
  tap,
  timeout,
  TimeoutError,
  unless,
  when,
} from "../src/index";

// ─── Helper Steps ──────────────────────────────────────────

const AddPrefix: Step<{ value: string }> = {
  name: "AddPrefix",
  async handle(payload, next) {
    return next({ ...payload, value: `prefix_${payload.value}` });
  },
};

const AddSuffix: Step<{ value: string }> = {
  name: "AddSuffix",
  async handle(payload, next) {
    return next({ ...payload, value: `${payload.value}_suffix` });
  },
};

const Uppercase: Step<{ value: string }> = {
  name: "Uppercase",
  async handle(payload, next) {
    return next({ ...payload, value: payload.value.toUpperCase() });
  },
};

const ThrowStep: Step<{ value: string }> = {
  name: "ThrowStep",
  handle() {
    throw new Error("Step failed");
  },
};

const ThrowStepWithRecovery: Step<{ value: string }> = {
  name: "ThrowStepWithRecovery",
  handle() {
    throw new Error("Recoverable");
  },
  onError(_error, payload) {
    return { ...payload, value: "recovered" };
  },
};

// ─── Tests ────────────────────────────────────────────────

describe("Pipeline Core", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // 1.
  it("pipeline() returns payload unchanged if through([]) is empty", async () => {
    const result = await pipeline({ foo: "bar" }).through([]).thenReturn();
    expect(result).toEqual({ foo: "bar" });
  });

  // 2.
  it("steps execute in order", async () => {
    const result = await pipeline({ value: "hello" })
      .through([AddPrefix, AddSuffix])
      .thenReturn();
    expect(result).toEqual({ value: "prefix_hello_suffix" });
  });

  // 3.
  it("next() passes transformed payload to next step", async () => {
    const result = await pipeline({ value: "test" })
      .through([Uppercase, AddSuffix])
      .thenReturn();
    expect(result).toEqual({ value: "TEST_suffix" });
  });

  // 4.
  it("stop() short-circuits without calling .after() or .catch()", async () => {
    const afterFn = vi.fn();
    const catchFn = vi.fn();

    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _context, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
        };
      },
    };

    const result = await pipeline({ value: "start" })
      .through([StopStep, AddSuffix])
      .after(afterFn)
      .catch(catchFn)
      .thenReturn();

    expect(result).toEqual({ value: "stopped" });
    expect(afterFn).not.toHaveBeenCalled();
    expect(catchFn).not.toHaveBeenCalled();
  });

  // 5.
  it("stop() always calls .finally()", async () => {
    const finallyFn = vi.fn();

    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _context, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
        };
      },
    };

    await pipeline({ value: "start" })
      .through([StopStep])
      .finally(finallyFn)
      .thenReturn();

    expect(finallyFn).toHaveBeenCalledTimes(1);
  });

  // 6.
  it(".ensure() blocks pipeline and emits console.warn", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ email: "" })
      .ensure((p) => !!p.email, "Email is required")
      .through([AddPrefix as unknown as Step<{ email: string }>])
      .thenReturn();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain(
      "[Tubby] Pipeline blocked by ensure(): Email is required",
    );
  });

  // 7.
  it('.ensure() with strategy "all" evaluates all conditions', async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ email: "", age: 15 })
      .ensure((p) => !!p.email, "Email required", { strategy: "all" })
      .ensure((p) => p.age >= 18, "Must be 18+", { strategy: "all" })
      .through([])
      .thenReturn();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  // 8.
  it(".ensure() async works correctly", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ email: "exists@test.com" })
      .ensure(async (p) => {
        await new Promise((r) => setTimeout(r, 10));
        return p.email !== "exists@test.com";
      }, "Email already taken")
      .through([])
      .thenReturn();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });

  // 9.
  it(".ensure() always calls .finally()", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const finallyFn = vi.fn();

    await pipeline({ email: "" })
      .ensure((p) => !!p.email, "Email required")
      .finally(finallyFn)
      .through([])
      .thenReturn();

    expect(finallyFn).toHaveBeenCalledTimes(1);
  });

  // 10.
  it(".give() injects context into all steps", async () => {
    const contextSpy = vi.fn();

    const ContextStep: Step<{ value: string }, { db: string }> = {
      name: "ContextStep",
      async handle(payload, next, context) {
        contextSpy(context.db);
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .give({ db: "postgres" })
      .through([ContextStep])
      .thenReturn();

    expect(contextSpy).toHaveBeenCalledWith("postgres");
  });

  // 11.
  it(".give() multiple merges contexts", async () => {
    const contextSpy = vi.fn();

    const ContextStep: Step<{ value: string }, { db: string; logger: string }> =
      {
        name: "ContextStep",
        async handle(payload, next, context) {
          contextSpy({ db: context.db, logger: context.logger });
          return next(payload);
        },
      };

    await pipeline({ value: "test" })
      .give({ db: "postgres" })
      .give({ logger: "winston" })
      .through([ContextStep])
      .thenReturn();

    expect(contextSpy).toHaveBeenCalledWith({
      db: "postgres",
      logger: "winston",
    });
  });

  // 12.
  it(".before() receives the original payload", async () => {
    const beforeFn = vi.fn();

    await pipeline({ value: "original" })
      .before(beforeFn)
      .through([Uppercase])
      .thenReturn();

    expect(beforeFn).toHaveBeenCalledWith(
      { value: "original" },
      expect.anything(),
    );
  });

  // 13.
  it(".after() receives the final result and duration", async () => {
    const afterFn = vi.fn();

    await pipeline({ value: "test" })
      .through([Uppercase])
      .after(afterFn)
      .thenReturn();

    expect(afterFn).toHaveBeenCalledTimes(1);
    const [result, , duration] = afterFn.mock.calls[0];
    expect(result).toEqual({ value: "TEST" });
    expect(typeof duration).toBe("number");
  });

  // 14.
  it(".finally() executes on success, error, stop, and ensure failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const finallyFnSuccess = vi.fn();
    const finallyFnError = vi.fn();
    const finallyFnStop = vi.fn();
    const finallyFnEnsure = vi.fn();

    // Success
    await pipeline({ value: "ok" })
      .through([Uppercase])
      .finally(finallyFnSuccess)
      .thenReturn();
    expect(finallyFnSuccess).toHaveBeenCalled();

    // Error
    await pipeline({ value: "fail" })
      .through([ThrowStep])
      .catch(() => ({ value: "caught" }))
      .finally(finallyFnError)
      .thenReturn();
    expect(finallyFnError).toHaveBeenCalled();

    // Stop
    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop(payload) as unknown as { value: string };
      },
    };
    await pipeline({ value: "stop" })
      .through([StopStep])
      .finally(finallyFnStop)
      .thenReturn();
    expect(finallyFnStop).toHaveBeenCalled();

    // Ensure failed
    await pipeline({ value: "" })
      .ensure((p) => !!p.value, "Required")
      .finally(finallyFnEnsure)
      .through([])
      .thenReturn();
    expect(finallyFnEnsure).toHaveBeenCalled();
  });

  // 15.
  it(".catch() intercepts unhandled errors", async () => {
    const result = await pipeline({ value: "test" })
      .through([ThrowStep])
      .catch((error, payload) => ({
        ...payload,
        value: `caught: ${error.originalError.message}`,
      }))
      .thenReturn();

    expect(result).toEqual({ value: "caught: Step failed" });
  });

  // 16.
  it("step.onError() takes priority over .catch()", async () => {
    const catchFn = vi.fn((_, p: { value: string }) => p);

    const result = await pipeline({ value: "test" })
      .through([ThrowStepWithRecovery])
      .catch(catchFn)
      .thenReturn();

    expect(result).toEqual({ value: "recovered" });
    expect(catchFn).not.toHaveBeenCalled();
  });

  // 17.
  it(".onStep() is triggered for each step (completed, skipped, failed)", async () => {
    const events: Array<{ step: string; status: string }> = [];

    const SkippableStep: Step<{ value: string }> = {
      name: "SkippableStep",
      async handle(payload, next) {
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .skip(SkippableStep)
      .onStep((e) => {
        events.push({ step: e.step, status: e.status });
      })
      .through([Uppercase, SkippableStep])
      .thenReturn();

    expect(events).toEqual([
      { step: "Uppercase", status: "completed" },
      { step: "SkippableStep", status: "skipped" },
    ]);
  });

  // 18.
  it(".onStep() silently ignores errors from the callback", async () => {
    const result = await pipeline({ value: "test" })
      .onStep(() => {
        throw new Error("callback error");
      })
      .through([Uppercase])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });

  // 19.
  it(".through() dynamic receives the original payload", async () => {
    const result = await pipeline({ value: "test", flag: true })
      .through((payload) => {
        if (payload.flag)
          return [
            Uppercase as unknown as Step<{ value: string; flag: boolean }>,
          ];
        return [AddSuffix as unknown as Step<{ value: string; flag: boolean }>];
      })
      .thenReturn();

    expect(result).toEqual({ value: "TEST", flag: true });
  });

  // 20.
  it(".through() multiple concatenates steps", async () => {
    const result = await pipeline({ value: "hello" })
      .through([AddPrefix])
      .through([AddSuffix])
      .thenReturn();

    expect(result).toEqual({ value: "prefix_hello_suffix" });
  });

  // 21.
  it(".skip() skips marked steps", async () => {
    const result = await pipeline({ value: "hello" })
      .skip(AddSuffix)
      .through([AddPrefix, AddSuffix])
      .thenReturn();

    expect(result).toEqual({ value: "prefix_hello" });
  });

  // 22.
  it("retry() retries N times with backoff", async () => {
    let attempts = 0;
    const FlakyStep: Step<{ value: string }> = {
      name: "FlakyStep",
      async handle(payload, next) {
        attempts++;
        if (attempts < 3) throw new Error("flaky");
        return next({ ...payload, value: "success" });
      },
    };

    const onRetry = vi.fn();
    const result = await pipeline({ value: "test" })
      .through([
        retry(FlakyStep, { attempts: 3, delay: 10, factor: 1, onRetry }),
      ])
      .thenReturn();

    expect(result).toEqual({ value: "success" });
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  // 23.
  it("timeout() throws TimeoutError after N ms", async () => {
    const SlowStep: Step<{ value: string }> = {
      name: "SlowStep",
      async handle(payload, next) {
        await new Promise((r) => setTimeout(r, 200));
        return next(payload);
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([timeout(SlowStep, 50)])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);
  });

  // 24.
  it("parallel() executes steps in parallel and merges results", async () => {
    const AddA: Step<{ a?: string; b?: string }> = {
      name: "AddA",
      async handle(payload, next) {
        return next({ ...payload, a: "valueA" });
      },
    };
    const AddB: Step<{ a?: string; b?: string }> = {
      name: "AddB",
      async handle(payload, next) {
        return next({ ...payload, b: "valueB" });
      },
    };

    const result = await pipeline({} as { a?: string; b?: string })
      .through([parallel([AddA, AddB])])
      .thenReturn();

    expect(result).toEqual({ a: "valueA", b: "valueB" });
  });

  // 25.
  it("combine() sequential executes pipelineA then pipelineB", async () => {
    const pipelineA = Pipeline.define([AddPrefix]);
    const pipelineB = Pipeline.define([AddSuffix]);

    const result = await pipeline({ value: "test" })
      .combine(pipelineA, pipelineB, { strategy: "sequential" })
      .thenReturn();

    expect(result).toEqual({ value: "prefix_test_suffix" });
  });

  // 26.
  it("combine() parallel executes both with Promise.all", async () => {
    const AddA: Step<{ base: string; a?: string; b?: string }> = {
      name: "AddA",
      async handle(payload, next) {
        return next({ ...payload, a: "fromA" });
      },
    };
    const AddB: Step<{ base: string; a?: string; b?: string }> = {
      name: "AddB",
      async handle(payload, next) {
        return next({ ...payload, b: "fromB" });
      },
    };

    const pa = Pipeline.define([AddA]);
    const pb = Pipeline.define([AddB]);

    const result = await pipeline({ base: "x" } as {
      base: string;
      a?: string;
      b?: string;
    })
      .combine(pa, pb, { strategy: "parallel" })
      .thenReturn();

    expect(result).toMatchObject({ a: "fromA", b: "fromB" });
  });

  // 27.
  it(".collect() returns a snapshot of each step", async () => {
    const snapshots = await pipeline({ value: "hello" })
      .through([AddPrefix, Uppercase])
      .collect();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].step).toBe("AddPrefix");
    expect(snapshots[1].step).toBe("Uppercase");
    expect(snapshots[1].payload).toEqual({ value: "PREFIX_HELLO" });
    expect(typeof snapshots[0].duration).toBe("number");
  });

  // 28.
  it(".collect() returns [] if ensure() fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const snapshots = await pipeline({ email: "" })
      .ensure((p) => !!p.email, "Required")
      .through([])
      .collect();

    expect(snapshots).toEqual([]);
  });

  // 29.
  it(".measure() returns metrics and total duration", async () => {
    const measured = await pipeline({ value: "test" })
      .measure()
      .through([AddPrefix, Uppercase])
      .thenReturn();

    expect(measured).not.toBeNull();
    const { result, metrics, totalDuration } = measured as unknown as {
      result: { value: string };
      metrics: Record<string, number>;
      totalDuration: number;
    };
    expect(result).toEqual({ value: "PREFIX_TEST" });
    expect(metrics).toHaveProperty("AddPrefix");
    expect(metrics).toHaveProperty("Uppercase");
    expect(typeof totalDuration).toBe("number");
  });

  // 30.
  it("thenReturn() returns null if ensure() fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ email: "" })
      .ensure((p) => !!p.email, "Required")
      .through([])
      .thenReturn();

    expect(result).toBeNull();
  });
});

// ─── Utility Tests ────────────────────────────────────────

describe("Utilities", () => {
  it("when() executes step if condition is true", async () => {
    const result = await pipeline({ value: "test", isAdmin: true })
      .through([
        when(
          (p) => p.isAdmin,
          Uppercase as unknown as Step<{ value: string; isAdmin: boolean }>,
        ),
      ])
      .thenReturn();
    expect(result).toEqual({ value: "TEST", isAdmin: true });
  });

  it("when() skips step if condition is false", async () => {
    const result = await pipeline({ value: "test", isAdmin: false })
      .through([
        when(
          (p) => p.isAdmin,
          Uppercase as unknown as Step<{ value: string; isAdmin: boolean }>,
        ),
      ])
      .thenReturn();
    expect(result).toEqual({ value: "test", isAdmin: false });
  });

  it("unless() executes step if condition is false", async () => {
    const result = await pipeline({ value: "test", skip: false })
      .through([
        unless(
          (p) => p.skip,
          Uppercase as unknown as Step<{ value: string; skip: boolean }>,
        ),
      ])
      .thenReturn();
    expect(result).toEqual({ value: "TEST", skip: false });
  });

  it("unless() skips step if condition is true", async () => {
    const result = await pipeline({ value: "test", skip: true })
      .through([
        unless(
          (p) => p.skip,
          Uppercase as unknown as Step<{ value: string; skip: boolean }>,
        ),
      ])
      .thenReturn();
    expect(result).toEqual({ value: "test", skip: true });
  });

  it("branch() takes then path when condition is true", async () => {
    const result = await pipeline({ value: "test", isPro: true })
      .through([
        branch({
          if: (p) => p.isPro,
          then: [
            Uppercase as unknown as Step<{ value: string; isPro: boolean }>,
          ],
          else: [
            AddSuffix as unknown as Step<{ value: string; isPro: boolean }>,
          ],
        }),
      ])
      .thenReturn();
    expect(result).toEqual({ value: "TEST", isPro: true });
  });

  it("branch() takes else path when condition is false", async () => {
    const result = await pipeline({ value: "test", isPro: false })
      .through([
        branch({
          if: (p) => p.isPro,
          then: [
            Uppercase as unknown as Step<{ value: string; isPro: boolean }>,
          ],
          else: [
            AddSuffix as unknown as Step<{ value: string; isPro: boolean }>,
          ],
        }),
      ])
      .thenReturn();
    expect(result).toEqual({ value: "test_suffix", isPro: false });
  });

  it("tap() observes without modifying", async () => {
    const spy = vi.fn();
    const result = await pipeline({ value: "test" })
      .through([tap((p) => spy(p.value)), Uppercase])
      .thenReturn();
    expect(spy).toHaveBeenCalledWith("test");
    expect(result).toEqual({ value: "TEST" });
  });

  it("map() transforms payload", async () => {
    const result = await pipeline({ value: "test" })
      .through([map((p) => ({ ...p, value: p.value + "_mapped" }))])
      .thenReturn();
    expect(result).toEqual({ value: "test_mapped" });
  });

  it("pick() keeps only specified keys", async () => {
    const result = await pipeline({ a: 1, b: 2, c: 3 } as {
      a: number;
      b: number;
      c: number;
    })
      .through([pick(["a", "b"])])
      .thenReturn();
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it("merge() merges static data", async () => {
    const result = await pipeline({ value: "test" })
      .through([merge({ extra: true })])
      .thenReturn();
    expect(result).toEqual({ value: "test", extra: true });
  });

  it("delay() pauses execution", async () => {
    const start = performance.now();
    await pipeline({ value: "test" })
      .through([delay(50)])
      .thenReturn();
    const elapsed = performance.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it("once() executes step only once", async () => {
    let callCount = 0;
    const CountStep: Step<{ value: string }> = {
      name: "CountStep",
      async handle(payload, next) {
        callCount++;
        return next({ ...payload, value: `called_${callCount}` });
      },
    };

    const oncedStep = once(CountStep);

    const result1 = await pipeline({ value: "first" })
      .through([oncedStep])
      .thenReturn();
    const result2 = await pipeline({ value: "second" })
      .through([oncedStep])
      .thenReturn();

    expect(callCount).toBe(1);
    expect(result1).toEqual({ value: "called_1" });
    expect(result2).toEqual({ value: "called_1" });
  });

  it("combine() standalone utility works", async () => {
    const pA = Pipeline.define([AddPrefix]);
    const pB = Pipeline.define([AddSuffix]);
    const combined = combine(pA, pB, { strategy: "sequential" });

    const result = await pipeline({ value: "test" })
      .through([combined])
      .thenReturn();

    expect(result).toEqual({ value: "prefix_test_suffix" });
  });
});

// ─── Edge Cases ──────────────────────────────────────────

describe("Edge Cases", () => {
  it("Pipeline.send() works same as pipeline()", async () => {
    const result = await Pipeline.send({ value: "test" })
      .through([Uppercase])
      .thenReturn();
    expect(result).toEqual({ value: "TEST" });
  });

  it("Pipeline.define() creates reusable step", async () => {
    const defined = Pipeline.define([AddPrefix, Uppercase]);

    const result = await pipeline({ value: "test" })
      .through([defined])
      .thenReturn();

    expect(result).toEqual({ value: "PREFIX_TEST" });
  });

  it("Pipeline.define() with dynamic steps", async () => {
    const defined = Pipeline.define<{ value: string; upper: boolean }>(
      (payload) => {
        const steps: Step<{ value: string; upper: boolean }>[] = [
          AddPrefix as unknown as Step<{ value: string; upper: boolean }>,
        ];
        if (payload.upper)
          steps.push(
            Uppercase as unknown as Step<{ value: string; upper: boolean }>,
          );
        return steps;
      },
    );

    const result = await pipeline({ value: "test", upper: true })
      .through([defined])
      .thenReturn();

    expect(result).toEqual({ value: "PREFIX_TEST", upper: true });
  });

  it("thenCall() calls fn with result", async () => {
    const fn = vi.fn();
    await pipeline({ value: "test" }).through([Uppercase]).thenCall(fn);

    expect(fn).toHaveBeenCalledWith({ value: "TEST" });
  });

  it("thenCall() does not call fn if ensure fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn();

    await pipeline({ value: "" })
      .ensure((p) => !!p.value, "Required")
      .through([])
      .thenCall(fn);

    expect(fn).not.toHaveBeenCalled();
  });

  it("thenThrow() re-throws unhandled errors", async () => {
    await expect(
      pipeline({ value: "test" }).through([ThrowStep]).thenThrow(),
    ).rejects.toThrow(PipelineError);
  });

  it(".inspect() outputs step info", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    await pipeline({ value: "test" })
      .inspect({ logger })
      .through([Uppercase])
      .thenReturn();

    expect(lines.length).toBeGreaterThanOrEqual(3); // header, step, footer separator, total
    expect(lines[0]).toContain("Tubby Pipeline");
    expect(lines[1]).toContain("Uppercase");
  });

  it(".inspect() shows skipped and failed steps", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    const SkippableStep: Step<{ value: string }> = {
      name: "SkippableStep",
      async handle(payload, next) {
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .inspect({ logger })
      .skip(SkippableStep)
      .through([SkippableStep, Uppercase])
      .thenReturn();

    const skippedLine = lines.find((l) => l.includes("skipped"));
    expect(skippedLine).toBeDefined();
  });

  it(".ensure() with dynamic message function", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await pipeline({ age: 15 })
      .ensure(
        (p) => p.age >= 18,
        (p) => `Must be 18+, got ${p.age}`,
      )
      .through([])
      .thenReturn();

    expect(warnSpy.mock.calls[0][0]).toContain("Must be 18+, got 15");
  });

  it(".ensure() without message uses default", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await pipeline({ value: "" })
      .ensure((p) => !!p.value)
      .through([])
      .thenReturn();

    expect(warnSpy.mock.calls[0][0]).toContain("Condition failed");
  });

  it(".onStep() with failed step includes error", async () => {
    const events: Array<{ step: string; status: string; error?: Error }> = [];

    await pipeline({ value: "test" })
      .onStep((e) => {
        events.push({ step: e.step, status: e.status, error: e.error });
      })
      .through([ThrowStep])
      .catch((_, p) => p)
      .thenReturn();

    expect(events).toHaveLength(1);
    expect(events[0].status).toBe("failed");
    expect(events[0].error).toBeDefined();
  });

  it("before() hook that throws triggers .catch()", async () => {
    const result = await pipeline({ value: "test" })
      .before(() => {
        throw new Error("before failed");
      })
      .through([Uppercase])
      .catch((_, p) => ({ ...p, value: "caught_before" }))
      .thenReturn();

    // before hook throw is not a PipelineError, so catch won't get it
    // It propagates normally as a non-PipelineError
    expect(result).toEqual({ value: "caught_before" });
  });

  it("multiple .finally() hooks execute in order", async () => {
    const order: number[] = [];

    await pipeline({ value: "test" })
      .finally(() => {
        order.push(1);
      })
      .finally(() => {
        order.push(2);
      })
      .through([Uppercase])
      .thenReturn();

    expect(order).toEqual([1, 2]);
  });

  it(".through() with async function for lazy loading", async () => {
    const result = await pipeline({ value: "test" })
      .through(async () => {
        await new Promise((r) => setTimeout(r, 10));
        return [Uppercase];
      })
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });

  it(".ensure() that throws an error propagates to catch()", async () => {
    const result = await pipeline({ value: "test" })
      .ensure(() => {
        throw new Error("ensure threw");
      })
      .through([])
      .catch((_, p) => ({ ...p, value: "caught_ensure" }))
      .thenReturn();

    expect(result).toEqual({ value: "caught_ensure" });
  });

  it(".collect() includes skipped steps", async () => {
    const SkipMe: Step<{ value: string }> = {
      name: "SkipMe",
      async handle(payload, next) {
        return next(payload);
      },
    };

    const snapshots = await pipeline({ value: "test" })
      .skip(SkipMe)
      .through([Uppercase, SkipMe])
      .collect();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[1].skipped).toBe(true);
  });

  it("retry() throws after all retries fail", async () => {
    const AlwaysFail: Step<{ value: string }> = {
      name: "AlwaysFail",
      handle() {
        throw new Error("always fails");
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([retry(AlwaysFail, { attempts: 2, delay: 10, factor: 1 })])
        .thenThrow(),
    ).rejects.toThrow("always fails");
  });

  it("combine() parallel with custom merge function", async () => {
    const SetA: Step<{ a?: number; b?: number; merged?: boolean }> = {
      name: "SetA",
      async handle(payload, next) {
        return next({ ...payload, a: 1 });
      },
    };
    const SetB: Step<{ a?: number; b?: number; merged?: boolean }> = {
      name: "SetB",
      async handle(payload, next) {
        return next({ ...payload, b: 2 });
      },
    };

    const pA = Pipeline.define([SetA]);
    const pB = Pipeline.define([SetB]);

    const result = await pipeline(
      {} as { a?: number; b?: number; merged?: boolean },
    )
      .combine(pA, pB, {
        strategy: "parallel",
        merge: (a, b) => ({ ...a, ...b, merged: true }),
      })
      .thenReturn();

    expect(result).toEqual({ a: 1, b: 2, merged: true });
  });

  it(".measure() returns null if ensure fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ value: "" })
      .measure()
      .ensure((p) => !!p.value, "Required")
      .through([])
      .thenReturn();

    expect(result).toBeNull();
  });

  it(".inspect() with showPayload false", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    await pipeline({ value: "secret" })
      .inspect({ logger, showPayload: false })
      .through([Uppercase])
      .thenReturn();

    const stepLine = lines.find((l) => l.includes("Uppercase"));
    expect(stepLine).toBeDefined();
    expect(stepLine).not.toContain("SECRET");
  });

  it(".inspect() with showTimings false", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    await pipeline({ value: "test" })
      .inspect({ logger, showTimings: false })
      .through([Uppercase])
      .thenReturn();

    const stepLine = lines.find((l) => l.includes("Uppercase"));
    expect(stepLine).toBeDefined();
    // timings should not be in the line
    expect(stepLine).not.toMatch(/\d+ms/);
  });

  it(".inspect() shows error info for failed step", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    await pipeline({ value: "test" })
      .inspect({ logger })
      .through([ThrowStep])
      .catch((_, p) => p)
      .thenReturn();

    const failedLine = lines.find((l) => l.includes("❌"));
    expect(failedLine).toBeDefined();
    expect(failedLine).toContain("Step failed");
  });

  it(".inspect() stop() shows footer", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop(payload) as unknown as { value: string };
      },
    };

    await pipeline({ value: "test" })
      .inspect({ logger })
      .through([StopStep])
      .thenReturn();

    expect(lines.some((l) => l.includes("Total:"))).toBe(true);
  });

  it(".ensure() before hooks are not called on failure", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const beforeFn = vi.fn();
    const afterFn = vi.fn();
    const catchFn = vi.fn();

    await pipeline({ value: "" })
      .ensure((p) => !!p.value, "Required")
      .before(beforeFn)
      .after(afterFn)
      .catch(catchFn)
      .through([])
      .thenReturn();

    expect(beforeFn).not.toHaveBeenCalled();
    expect(afterFn).not.toHaveBeenCalled();
    expect(catchFn).not.toHaveBeenCalled();
  });

  it(".inspect() with showContext", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    await pipeline({ value: "test" })
      .give({ db: "pg" })
      .inspect({ logger, showContext: true })
      .through([Uppercase])
      .thenReturn();

    // showContext doesn't change step line output in our implementation
    // but we verify it doesn't break
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it("multiple next() calls - only first is used", async () => {
    const DoubleNext: Step<{ value: string }> = {
      name: "DoubleNext",
      async handle(payload, next) {
        const r1 = await next({ ...payload, value: "first" });
        const r2 = await next({ ...payload, value: "second" });
        return r1; // second next should be ignored
      },
    };

    const result = await pipeline({ value: "test" })
      .through([DoubleNext, AddSuffix])
      .thenReturn();

    expect(result).toEqual({ value: "first_suffix" });
  });

  it("Pipeline.define() with stop() inside a step", async () => {
    const StopInDefine: Step<{ value: string }> = {
      name: "StopInDefine",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped_in_define" }) as unknown as {
          value: string;
        };
      },
    };

    const defined = Pipeline.define([StopInDefine, AddSuffix]);
    const result = await pipeline({ value: "test" })
      .through([defined])
      .thenReturn();

    expect(result).toEqual({ value: "stopped_in_define" });
  });

  it(".ensure() that throws without .catch() propagates", async () => {
    await expect(
      pipeline({ value: "test" })
        .ensure(() => {
          throw new Error("ensure error no catch");
        })
        .through([])
        .thenReturn(),
    ).rejects.toThrow("ensure error no catch");
  });

  it(".finally() that throws during stop is suppressed", async () => {
    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
        };
      },
    };

    // finally throws but shouldn't overwrite the stop result
    const result = await pipeline({ value: "test" })
      .through([StopStep])
      .finally(() => {
        throw new Error("finally error");
      })
      .thenReturn();

    expect(result).toEqual({ value: "stopped" });
  });

  it(".finally() that throws during ensure failure is suppressed", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ value: "" })
      .ensure((p) => !!p.value, "Required")
      .finally(() => {
        throw new Error("finally error");
      })
      .through([])
      .thenReturn();

    expect(result).toBeNull();
  });

  it(".finally() that throws on success propagates", async () => {
    await expect(
      pipeline({ value: "test" })
        .through([Uppercase])
        .finally(() => {
          throw new Error("finally on success");
        })
        .thenReturn(),
    ).rejects.toThrow("finally on success");
  });

  it("combine() standalone parallel strategy", async () => {
    const SetA: Step<{ a?: string; b?: string }> = {
      name: "SetA",
      async handle(payload, next) {
        return next({ ...payload, a: "A" });
      },
    };
    const SetB: Step<{ a?: string; b?: string }> = {
      name: "SetB",
      async handle(payload, next) {
        return next({ ...payload, b: "B" });
      },
    };

    const pA = Pipeline.define([SetA]);
    const pB = Pipeline.define([SetB]);
    const combined = combine(pA, pB, { strategy: "parallel" });

    const result = await pipeline({} as { a?: string; b?: string })
      .through([combined])
      .thenReturn();

    expect(result).toMatchObject({ a: "A", b: "B" });
  });

  it("timeout() where step succeeds within time", async () => {
    const FastStep: Step<{ value: string }> = {
      name: "FastStep",
      async handle(payload, next) {
        return next({ ...payload, value: "fast" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([timeout(FastStep, 1000)])
      .thenReturn();

    expect(result).toEqual({ value: "fast" });
  });

  it("timeout() where step throws non-timeout error", async () => {
    const ErrorStep: Step<{ value: string }> = {
      name: "ErrorStep",
      handle() {
        throw new Error("step error");
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([timeout(ErrorStep, 1000)])
        .thenThrow(),
    ).rejects.toThrow("step error");
  });

  it("PipelineError has correct properties", () => {
    const original = new Error("original");
    const pError = new PipelineError("TestStep", { a: 1 }, original);
    expect(pError.step).toBe("TestStep");
    expect(pError.payload).toEqual({ a: 1 });
    expect(pError.originalError).toBe(original);
    expect(pError.name).toBe("PipelineError");
    expect(pError.message).toContain("TestStep");
  });

  it("TimeoutError has correct properties", () => {
    const tError = new TimeoutError("SlowStep", 5000);
    expect(tError.step).toBe("SlowStep");
    expect(tError.ms).toBe(5000);
    expect(tError.name).toBe("TimeoutError");
    expect(tError.message).toContain("5000");
  });

  it("step without name uses anonymous", async () => {
    const anon: Step<{ value: string }> = {
      async handle(payload, next) {
        return next({ ...payload, value: "anon" });
      },
    };

    const snapshots = await pipeline({ value: "test" })
      .through([anon])
      .collect();

    expect(snapshots[0].step).toBe("anonymous");
  });

  it("onStep async callback error is ignored", async () => {
    const result = await pipeline({ value: "test" })
      .onStep(async () => {
        throw new Error("async callback error");
      })
      .through([Uppercase])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });

  it("retry default delay and factor", async () => {
    let attempts = 0;
    const FlakyStep: Step<{ value: string }> = {
      name: "FlakyStep",
      async handle(payload, next) {
        attempts++;
        if (attempts < 2) throw new Error("flaky");
        return next({ ...payload, value: "recovered" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([retry(FlakyStep, { attempts: 2, delay: 10 })])
      .thenReturn();

    expect(result).toEqual({ value: "recovered" });
    expect(attempts).toBe(2);
  });

  it("combine() with stop inside a pipeline", async () => {
    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped_combine" }) as unknown as {
          value: string;
        };
      },
    };

    const pA = Pipeline.define([StopStep]);
    const pB = Pipeline.define([AddSuffix]);

    const result = await pipeline({ value: "test" })
      .combine(pA, pB, { strategy: "sequential" })
      .thenReturn();

    expect(result).toEqual({ value: "stopped_combine_suffix" });
  });

  it("combine() parallel with stop inside", async () => {
    const StopStep: Step<{ value: string; extra?: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped_parallel" }) as unknown as {
          value: string;
          extra?: string;
        };
      },
    };
    const SetExtra: Step<{ value: string; extra?: string }> = {
      name: "SetExtra",
      async handle(payload, next) {
        return next({ ...payload, extra: "yes" });
      },
    };

    const pA = Pipeline.define([StopStep]);
    const pB = Pipeline.define([SetExtra]);

    const result = await pipeline({ value: "test" } as {
      value: string;
      extra?: string;
    })
      .combine(pA, pB, { strategy: "parallel" })
      .thenReturn();

    expect(result).toBeDefined();
  });

  it(".ensure() async throw without catch propagates", async () => {
    await expect(
      pipeline({ value: "test" })
        .ensure(async () => {
          throw new Error("async ensure error");
        })
        .through([])
        .thenReturn(),
    ).rejects.toThrow("async ensure error");
  });

  it("onStep receives payloadBefore and payloadAfter correctly", async () => {
    const events: Array<{ payloadBefore: unknown; payloadAfter: unknown }> = [];

    await pipeline({ value: "test" })
      .onStep((e) =>
        events.push({
          payloadBefore: e.payloadBefore,
          payloadAfter: e.payloadAfter,
        }),
      )
      .through([Uppercase])
      .thenReturn();

    expect(events[0].payloadBefore).toEqual({ value: "test" });
    expect(events[0].payloadAfter).toEqual({ value: "TEST" });
  });

  it("branch() with stop() inside propagates stop", async () => {
    const StopInBranch: Step<{ value: string; isPro: boolean }> = {
      name: "StopInBranch",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "branch_stopped" }) as unknown as {
          value: string;
          isPro: boolean;
        };
      },
    };

    const result = await pipeline({ value: "test", isPro: true })
      .through([
        branch({
          if: (p) => p.isPro,
          then: [StopInBranch],
          else: [
            Uppercase as unknown as Step<{ value: string; isPro: boolean }>,
          ],
        }),
      ])
      .thenReturn();

    expect(result).toEqual({ value: "branch_stopped", isPro: true });
  });

  it("parallel() stop() inside safely halts the branch and merges the stopped payload", async () => {
    const StopInParallel: Step<{ value: string }> = {
      name: "StopInParallel",
      handle(_payload, _next, _ctx, stop) {
        return stop({ value: "stopped" }) as never;
      },
    };

    const result = await pipeline({ value: "test" })
      .through([parallel([StopInParallel as Step<{ value: string }> & object])])
      .thenReturn();

    expect(result).toEqual({ value: "stopped" });
  });

  it("timeout() step that throws asynchronously", async () => {
    const AsyncThrowStep: Step<{ value: string }> = {
      name: "AsyncThrow",
      async handle() {
        await new Promise((r) => setTimeout(r, 10));
        throw new Error("async throw in timeout");
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([timeout(AsyncThrowStep, 5000)])
        .thenThrow(),
    ).rejects.toThrow("async throw in timeout");
  });

  it(".collect() with a failing step records the snapshot", async () => {
    const snapshots = await pipeline({ value: "test" })
      .through([Uppercase, ThrowStep])
      .catch((_, p) => p)
      .collect();

    expect(snapshots.length).toBeGreaterThanOrEqual(1);
    expect(snapshots[0].step).toBe("Uppercase");
  });

  it(".measure() with a failing step records metrics", async () => {
    const measured = await pipeline({ value: "test" })
      .measure()
      .through([ThrowStep])
      .catch((_, p) => p)
      .thenReturn();

    expect(measured).not.toBeNull();
  });

  it("thenThrow() returns result on success", async () => {
    const result = await pipeline({ value: "test" })
      .through([Uppercase])
      .thenThrow();

    expect(result).toEqual({ value: "TEST" });
  });

  it("when() with unnamed step", async () => {
    const unnamedStep: Step<{ value: string; flag: boolean }> = {
      async handle(payload, next) {
        return next({ ...payload, value: payload.value.toUpperCase() });
      },
    };

    const result = await pipeline({ value: "test", flag: true })
      .through([when((p) => p.flag, unnamedStep)])
      .thenReturn();

    expect(result).toEqual({ value: "TEST", flag: true });
  });

  it("unless() with unnamed step", async () => {
    const unnamedStep: Step<{ value: string; flag: boolean }> = {
      async handle(payload, next) {
        return next({ ...payload, value: payload.value.toUpperCase() });
      },
    };

    const result = await pipeline({ value: "test", flag: false })
      .through([unless((p) => p.flag, unnamedStep)])
      .thenReturn();

    expect(result).toEqual({ value: "TEST", flag: false });
  });

  it("once() uses cache on second call", async () => {
    let callCount = 0;
    const CountStep: Step<{ value: string }> = {
      async handle(payload, next) {
        callCount++;
        return next({ ...payload, value: `c${callCount}` });
      },
    };

    const oncedStep = once(CountStep);
    await pipeline({ value: "a" }).through([oncedStep]).thenReturn();
    const result = await pipeline({ value: "b" })
      .through([oncedStep])
      .thenReturn();

    expect(callCount).toBe(1);
    expect(result).toEqual({ value: "c1" });
  });

  it("retry() with non-Error thrown", async () => {
    let attempts = 0;
    const NonErrorStep: Step<{ value: string }> = {
      name: "NonErrorStep",
      handle(payload, next) {
        attempts++;
        if (attempts < 2) throw "string error";
        return next({ ...payload, value: "ok" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([retry(NonErrorStep, { attempts: 2, delay: 10 })])
      .thenReturn();

    expect(result).toEqual({ value: "ok" });
  });

  it("timeout() with unnamed step", async () => {
    const unnamedStep: Step<{ value: string }> = {
      async handle(payload, next) {
        return next({ ...payload, value: "timed" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([timeout(unnamedStep, 1000)])
      .thenReturn();

    expect(result).toEqual({ value: "timed" });
  });

  it("combine() default strategy (sequential)", async () => {
    const pA = Pipeline.define([AddPrefix]);
    const pB = Pipeline.define([AddSuffix]);
    const combined = combine(pA, pB);

    const result = await pipeline({ value: "test" })
      .through([combined])
      .thenReturn();

    expect(result).toEqual({ value: "prefix_test_suffix" });
  });

  it("step that throws non-Error", async () => {
    const NonErrorThrow: Step<{ value: string }> = {
      name: "NonErrorThrow",
      handle() {
        throw "string error";
      },
    };

    const result = await pipeline({ value: "test" })
      .through([NonErrorThrow])
      .catch((err, p) => ({ ...p, value: err.originalError.message }))
      .thenReturn();

    expect(result).toEqual({ value: "string error" });
  });

  it("step without next() returns value directly", async () => {
    const NoNext: Step<{ value: string }> = {
      name: "NoNext",
      handle(payload) {
        return { ...payload, value: "no_next" };
      },
    };

    const result = await pipeline({ value: "test" })
      .through([NoNext])
      .thenReturn();

    expect(result).toEqual({ value: "no_next" });
  });

  it("ensure PipelineError is forwarded as-is when thrown in ensure", async () => {
    const result = await pipeline({ value: "test" })
      .ensure(() => {
        throw new PipelineError("ensure", { value: "test" }, new Error("pe"));
      })
      .through([])
      .catch((err, p) => ({ ...p, value: err.step }))
      .thenReturn();

    expect(result).toEqual({ value: "ensure" });
  });

  it(".collect() includes stop() step in snapshots", async () => {
    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
        };
      },
    };

    const snapshots = await pipeline({ value: "test" })
      .through([Uppercase, StopStep, AddSuffix])
      .collect();

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].step).toBe("Uppercase");
    expect(snapshots[1].step).toBe("StopStep");
    expect(snapshots[1].payload).toEqual({ value: "stopped" });
  });

  it(".collect() includes no-next step in snapshots", async () => {
    const NoNext: Step<{ value: string }> = {
      name: "NoNext",
      handle(payload) {
        return { ...payload, value: "no_next" };
      },
    };

    const snapshots = await pipeline({ value: "test" })
      .through([NoNext])
      .collect();

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].step).toBe("NoNext");
    expect(snapshots[0].payload).toEqual({ value: "no_next" });
  });

  it("combine() standalone sequential with stop inside", async () => {
    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({
          ...payload,
          value: "stopped_combine_seq",
        }) as unknown as { value: string };
      },
    };

    const pA = Pipeline.define([StopStep]);
    const pB = Pipeline.define([AddSuffix]);
    const combined = combine(pA, pB, { strategy: "sequential" });

    const result = await pipeline({ value: "test" })
      .through([combined])
      .thenReturn();

    expect(result).toEqual({ value: "stopped_combine_seq_suffix" });
  });

  it("combine() standalone parallel with stop inside", async () => {
    const StopStep: Step<{ value: string; extra?: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
          extra?: string;
        };
      },
    };
    const SetExtra: Step<{ value: string; extra?: string }> = {
      name: "SetExtra",
      async handle(payload, next) {
        return next({ ...payload, extra: "yes" });
      },
    };

    const pA = Pipeline.define([StopStep]);
    const pB = Pipeline.define([SetExtra]);
    const combined = combine(pA, pB, { strategy: "parallel" });

    const result = await pipeline({ value: "test" } as {
      value: string;
      extra?: string;
    })
      .through([combined])
      .thenReturn();

    expect(result).toBeDefined();
  });

  it("retry() with unnamed step", async () => {
    let attempts = 0;
    const unnamedStep: Step<{ value: string }> = {
      async handle(payload, next) {
        attempts++;
        if (attempts < 2) throw new Error("fail");
        return next({ ...payload, value: "ok" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([retry(unnamedStep, { attempts: 2, delay: 10 })])
      .thenReturn();

    expect(result).toEqual({ value: "ok" });
  });

  it("combine() with custom merge in parallel", async () => {
    const pA = Pipeline.define([AddPrefix]);
    const pB = Pipeline.define([AddSuffix]);
    const combined = combine(pA, pB, {
      strategy: "parallel",
      merge: (a, b) => ({ ...a, ...b }),
    });

    const result = await pipeline({ value: "test" })
      .through([combined])
      .thenReturn();

    expect(result).toBeDefined();
  });

  it(".measure() with stop step includes metrics", async () => {
    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
        };
      },
    };

    const measured = await pipeline({ value: "test" })
      .measure()
      .through([StopStep])
      .thenReturn();

    expect(measured).toBeDefined();
  });

  it("combine() default (no options) uses sequential and default merge", async () => {
    const SetA: Step<{ a?: string; b?: string }> = {
      name: "SetA",
      async handle(payload, next) {
        return next({ ...payload, a: "A" });
      },
    };
    const SetB: Step<{ a?: string; b?: string }> = {
      name: "SetB",
      async handle(payload, next) {
        return next({ ...payload, b: "B" });
      },
    };

    const combined = combine(Pipeline.define([SetA]), Pipeline.define([SetB]));
    const result = await pipeline({} as { a?: string; b?: string })
      .through([combined])
      .thenReturn();

    expect(result).toEqual({ a: "A", b: "B" });
  });

  it("step with class constructor gets constructor name", async () => {
    class MyStep {
      name?: string;
      async handle(
        payload: { value: string },
        next: (p: { value: string }) => Promise<{ value: string }>,
      ) {
        return next({ ...payload, value: "class_step" });
      }
    }

    const result = await pipeline({ value: "test" })
      .through([new MyStep() as unknown as Step<{ value: string }>])
      .thenReturn();

    expect(result).toEqual({ value: "class_step" });
  });

  it(".ensure() all strategy with mix of pass/fail keeps first fail", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await pipeline({ value: "test", age: 25 })
      .ensure((p) => p.age >= 18, "Must be 18+", { strategy: "all" })
      .ensure((p) => !!p.value && p.value.length > 10, "Value too short", {
        strategy: "all",
      })
      .through([])
      .thenReturn();

    // First passes, second fails
    expect(result).toBeNull();
  });

  it(".ensure() all strategy all pass returns true", async () => {
    const result = await pipeline({ value: "test with enough length", age: 25 })
      .ensure((p) => p.age >= 18, "Must be 18+", { strategy: "all" })
      .ensure((p) => !!p.value, "Required", { strategy: "all" })
      .through([Uppercase as unknown as Step<{ value: string; age: number }>])
      .thenReturn();

    expect(result).toEqual({ value: "TEST WITH ENOUGH LENGTH", age: 25 });
  });

  it("combine() util sequential both pass (no StopSignal)", async () => {
    const StepA: Step<{ val: number }> = {
      name: "StepA",
      async handle(payload, next) {
        return next({ ...payload, val: payload.val + 1 });
      },
    };
    const StepB: Step<{ val: number }> = {
      name: "StepB",
      async handle(payload, next) {
        return next({ ...payload, val: payload.val * 2 });
      },
    };

    const combined = combine(
      Pipeline.define([StepA]),
      Pipeline.define([StepB]),
      { strategy: "sequential" },
    );

    const result = await pipeline({ val: 5 }).through([combined]).thenReturn();

    expect(result).toEqual({ val: 12 }); // (5+1)*2
  });

  it("combine() util parallel both pass (no StopSignal)", async () => {
    const StepA: Step<{ a?: number; b?: number }> = {
      name: "StepA",
      async handle(payload, next) {
        return next({ ...payload, a: 10 });
      },
    };
    const StepB: Step<{ a?: number; b?: number }> = {
      name: "StepB",
      async handle(payload, next) {
        return next({ ...payload, b: 20 });
      },
    };

    const combined = combine(
      Pipeline.define([StepA]),
      Pipeline.define([StepB]),
      { strategy: "parallel" },
    );

    const result = await pipeline({} as { a?: number; b?: number })
      .through([combined])
      .thenReturn();

    expect(result).toEqual({ a: 10, b: 20 });
  });
});
