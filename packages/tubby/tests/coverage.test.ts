/**
 * Tests targeting uncovered branches identified by v8 coverage.
 *
 * Gaps covered here:
 * 1. _emitInspect — showTimings:false on a skipped step
 * 2. _emitInspect — showTimings:false on a failed step
 * 3. parallel()   — one step throws → Promise.all rejects
 * 4. retry()      — onRetry callback itself throws
 * 5. give()       — second give() overrides same key
 * 6. combine()    — raw step returns StopSignal (sequential & parallel)
 */

import { describe, expect, it, vi } from "vitest";
import type { Step } from "../src/index";
import { combine, parallel, pipeline, PipelineError, retry } from "../src/index";

// ─── Shared helpers ──────────────────────────────────────────────────────────

const ThrowStep: Step<{ value: string }> = {
  name: "ThrowStep",
  handle() {
    throw new Error("step failed");
  },
};

// ─── inspect() — console.log fallback (no custom logger) ─────────────────────
//
// All existing inspect tests pass a custom logger. These tests exercise the
// `?? console.log` fallback branch on lines 534, 548, and 561 of PipelineBuilder.

describe("inspect() — default console.log fallback", () => {
  it("uses console.log when no logger is provided (success path)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await pipeline({ value: "test" })
      .inspect() // no logger → falls back to console.log
      .through([
        {
          name: "Simple",
          async handle(payload, next) {
            return next(payload);
          },
        },
      ])
      .thenReturn();

    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((l) => l.includes("Tubby Pipeline"))).toBe(true);
    expect(calls.some((l) => l.includes("Total:"))).toBe(true);
  });

  it("uses console.log when no logger is provided (stop path)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const StopStep: Step<{ value: string }> = {
      name: "StopStep",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stopped" }) as unknown as {
          value: string;
        };
      },
    };

    await pipeline({ value: "test" })
      .inspect() // no logger → falls back to console.log
      .through([StopStep])
      .thenReturn();

    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map((c) => c[0] as string);
    expect(calls.some((l) => l.includes("Total:"))).toBe(true);
  });
});

// ─── inspect() combinatorial branches ────────────────────────────────────────

describe("inspect() — uncovered showTimings combinations", () => {
  it("showTimings:false on a skipped step does not include duration", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    const SkippableStep: Step<{ value: string }> = {
      name: "SkippableStep",
      async handle(payload, next) {
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .inspect({ logger, showTimings: false })
      .skip(SkippableStep)
      .through([SkippableStep])
      .thenReturn();

    const skippedLine = lines.find((l) => l.includes("SkippableStep"));
    expect(skippedLine).toBeDefined();
    expect(skippedLine).toContain("[skipped]");
    // No duration digits followed by 'ms'
    expect(skippedLine).not.toMatch(/\d+ms/);
  });

  it("showTimings:false on a failed step does not include duration", async () => {
    const lines: string[] = [];
    const logger = (msg: string) => lines.push(msg);

    await pipeline({ value: "test" })
      .inspect({ logger, showTimings: false })
      .through([ThrowStep])
      .catch((_, p) => p)
      .thenReturn();

    const failedLine = lines.find((l) => l.includes("❌"));
    expect(failedLine).toBeDefined();
    expect(failedLine).toContain("step failed");
    expect(failedLine).not.toMatch(/\d+ms/);
  });
});

// ─── parallel() error propagation ────────────────────────────────────────────

describe("parallel() — one step throws", () => {
  it("propagates as PipelineError when one parallel step fails", async () => {
    const GoodStep: Step<{ value: string }> = {
      name: "GoodStep",
      async handle(payload, next) {
        return next(payload);
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([parallel([GoodStep, ThrowStep])])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);
  });
});

// ─── retry() — onRetry callback throws ───────────────────────────────────────

describe("retry() — onRetry callback throws", () => {
  it("propagates immediately when onRetry callback itself throws", async () => {
    const AlwaysFail: Step<{ value: string }> = {
      name: "AlwaysFail",
      handle() {
        throw new Error("underlying error");
      },
    };

    const crashingOnRetry = vi.fn(() => {
      throw new Error("onRetry crashed");
    });

    await expect(
      pipeline({ value: "test" })
        .through([
          retry(AlwaysFail, {
            attempts: 3,
            delay: 0,
            onRetry: crashingOnRetry,
          }),
        ])
        .thenThrow(),
    ).rejects.toThrow("onRetry crashed");

    // onRetry should only have been called once before it crashed
    expect(crashingOnRetry).toHaveBeenCalledTimes(1);
  });
});

// ─── ensure() / before() — non-Error thrown ──────────────────────────────────
//
// The `err instanceof Error ? err : new Error(String(err))` ternaries on
// lines 501 and 524 have their false-branch uncovered (no test throws a
// non-Error from ensure() or from a before() hook).

describe("ensure() — non-Error thrown", () => {
  it("wraps a thrown string from ensure() in an Error", async () => {
    await expect(
      pipeline({ value: "test" })
        .ensure(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "non-error ensure";
        })
        .through([])
        .thenReturn(),
    ).rejects.toThrow("non-error ensure");
  });
});

describe("before() — non-Error thrown", () => {
  it("wraps a thrown string from before() in a PipelineError", async () => {
    await expect(
      pipeline({ value: "test" })
        .before(() => {
          // eslint-disable-next-line @typescript-eslint/no-throw-literal
          throw "non-error before";
        })
        .through([])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);
  });
});

// ─── getStepName — step with no prototype (constructor is undefined) ──────────

describe("getStepName — step.constructor falsy", () => {
  it("falls back to 'anonymous' when step has no constructor", async () => {
    // Create a step whose prototype chain has no constructor property
    const noProtoStep = Object.assign(Object.create(null) as object, {
      async handle(
        payload: { value: string },
        next: (p: { value: string }) => Promise<{ value: string }>,
      ) {
        return next(payload);
      },
    }) as Step<{ value: string }>;

    const snapshots = await pipeline({ value: "test" })
      .through([noProtoStep])
      .collect();

    expect(snapshots[0].step).toBe("anonymous");
  });
});

// ─── PipelineBuilder.combine() method — StopSignal in parallel ───────────────
//
// The .combine() METHOD on PipelineBuilder (as opposed to the standalone utility)
// has its own parallel-strategy StopSignal branches at lines 135-136 that are
// distinct from those in utils/combine.ts.

describe("PipelineBuilder.combine() method — default strategy and sequential StopSignal branches", () => {
  it("defaults to sequential when no options are provided (covers ?? 'sequential')", async () => {
    // Calling .combine() without options → options?.strategy is undefined → ?? "sequential"
    const AddA: Step<{ value: string }> = {
      name: "AddA",
      async handle(payload, next) {
        return next({ ...payload, value: payload.value + "_a" });
      },
    };
    const AddB: Step<{ value: string }> = {
      name: "AddB",
      async handle(payload, next) {
        return next({ ...payload, value: payload.value + "_b" });
      },
    };

    const result = await pipeline({ value: "test" })
      .combine(AddA, AddB) // no options
      .thenReturn();

    expect(result).toEqual({ value: "test_a_b" });
  });

  it("sequential: unwraps StopSignal from pipelineA (covers line 122)", async () => {
    const StopA: Step<{ value: string }> = {
      name: "StopA",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: "stop_a" }) as unknown as {
          value: string;
        };
      },
    };
    const AppendB: Step<{ value: string }> = {
      name: "AppendB",
      async handle(payload, next) {
        return next({ ...payload, value: payload.value + "_b" });
      },
    };

    const result = await pipeline({ value: "test" })
      .combine(StopA, AppendB, { strategy: "sequential" })
      .thenReturn();

    expect(result).toEqual({ value: "stop_a_b" });
  });

  it("sequential: unwraps StopSignal from pipelineB (covers line 126)", async () => {
    const PassA: Step<{ value: string }> = {
      name: "PassA",
      async handle(payload, next) {
        return next(payload);
      },
    };
    const StopB: Step<{ value: string }> = {
      name: "StopB",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, value: payload.value + "_stop_b" }) as unknown as {
          value: string;
        };
      },
    };

    const result = await pipeline({ value: "test" })
      .combine(PassA, StopB, { strategy: "sequential" })
      .thenReturn();

    expect(result).toEqual({ value: "test_stop_b" });
  });
});

describe("PipelineBuilder.combine() method — parallel StopSignal branches", () => {
  it("unwraps StopSignal from both raw parallel steps", async () => {
    const StopA: Step<{ a?: string; b?: string }> = {
      name: "StopA",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, a: "a_val" }) as unknown as {
          a?: string;
          b?: string;
        };
      },
    };

    const StopB: Step<{ a?: string; b?: string }> = {
      name: "StopB",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, b: "b_val" }) as unknown as {
          a?: string;
          b?: string;
        };
      },
    };

    const result = await pipeline({} as { a?: string; b?: string })
      .combine(StopA, StopB, { strategy: "parallel" })
      .thenReturn();

    expect(result).toMatchObject({ a: "a_val", b: "b_val" });
  });
});

// ─── .measure() + step without next() ────────────────────────────────────────
//
// Line 423: `if (metrics) metrics[stepName] = duration;` inside the !nextCalled
// branch is only reachable when a step returns directly AND .measure() is active.

describe(".measure() — step returns without calling next()", () => {
  it("records metrics for a step that returns directly without next()", async () => {
    const NoNextStep: Step<{ value: string }> = {
      name: "NoNextStep",
      handle(payload) {
        return { ...payload, value: "no_next" };
      },
    };

    const measured = await pipeline({ value: "test" })
      .measure()
      .through([NoNextStep])
      .thenReturn();

    expect(measured).not.toBeNull();
    const { result, metrics } = measured as unknown as {
      result: { value: string };
      metrics: Record<string, number>;
    };
    expect(result).toEqual({ value: "no_next" });
    expect(metrics).toHaveProperty("NoNextStep");
  });
});

// ─── give() — same key overridden by a second call ───────────────────────────

describe("give() — context key override", () => {
  it("second give() with same key overrides the first value", async () => {
    const contextSpy = vi.fn();

    const ReadContext: Step<{ value: string }, { db: string }> = {
      name: "ReadContext",
      async handle(payload, next, context) {
        contextSpy(context.db);
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .give({ db: "postgres" })
      .give({ db: "mysql" })
      .through([ReadContext])
      .thenReturn();

    expect(contextSpy).toHaveBeenCalledWith("mysql");
  });
});

// ─── combine() — StopSignal from raw steps ────────────────────────────────────
//
// Pipeline.define() already unwraps StopSignals before returning, so combine()
// never sees them when steps are composed via Pipeline.define(). To hit those
// branches we must pass raw Steps that call stop() directly.

describe("combine() — StopSignal from raw steps", () => {
  it("sequential: unwraps StopSignal from pipelineA and pipes it into pipelineB", async () => {
    // StopRawA calls stop(), which makes combine receive a StopSignal for resultA
    const StopRawA: Step<{ value: string }> = {
      name: "StopRawA",
      handle(payload, _next, _ctx, stop) {
        return stop({
          ...payload,
          value: "stopped_a",
        }) as unknown as { value: string };
      },
    };

    const AppendB: Step<{ value: string }> = {
      name: "AppendB",
      async handle(payload, next) {
        return next({ ...payload, value: payload.value + "_b" });
      },
    };

    const combined = combine(StopRawA, AppendB, { strategy: "sequential" });

    const result = await pipeline({ value: "test" })
      .through([combined])
      .thenReturn();

    // resultA StopSignal is unwrapped → "stopped_a" is passed to AppendB
    expect(result).toEqual({ value: "stopped_a_b" });
  });

  it("sequential: unwraps StopSignal from pipelineB", async () => {
    const PassThrough: Step<{ value: string }> = {
      name: "PassThrough",
      async handle(payload, next) {
        return next(payload);
      },
    };

    // StopRawB calls stop(), making combine receive a StopSignal for resultB
    const StopRawB: Step<{ value: string }> = {
      name: "StopRawB",
      handle(payload, _next, _ctx, stop) {
        return stop({
          ...payload,
          value: payload.value + "_stopped_b",
        }) as unknown as { value: string };
      },
    };

    const combined = combine(PassThrough, StopRawB, { strategy: "sequential" });

    const result = await pipeline({ value: "test" })
      .through([combined])
      .thenReturn();

    expect(result).toEqual({ value: "test_stopped_b" });
  });

  it("parallel: unwraps StopSignals from both branches", async () => {
    const StopA: Step<{ a?: string; b?: string }> = {
      name: "StopA",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, a: "a_val" }) as unknown as {
          a?: string;
          b?: string;
        };
      },
    };

    const StopB: Step<{ a?: string; b?: string }> = {
      name: "StopB",
      handle(payload, _next, _ctx, stop) {
        return stop({ ...payload, b: "b_val" }) as unknown as {
          a?: string;
          b?: string;
        };
      },
    };

    const combined = combine(StopA, StopB, { strategy: "parallel" });

    const result = await pipeline({} as { a?: string; b?: string })
      .through([combined])
      .thenReturn();

    expect(result).toMatchObject({ a: "a_val", b: "b_val" });
  });
});
