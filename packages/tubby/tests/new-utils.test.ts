import { describe, expect, it, vi } from "vitest";
import type { Step } from "../src/index";
import { fallback, loop, parallel, pipeline, PipelineError, race } from "../src/index";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const Uppercase: Step<{ value: string }> = {
  name: "Uppercase",
  async handle(payload, next) {
    return next({ ...payload, value: payload.value.toUpperCase() });
  },
};

const AddSuffix: Step<{ value: string }> = {
  name: "AddSuffix",
  async handle(payload, next) {
    return next({ ...payload, value: payload.value + "_suffix" });
  },
};

// ─── race() ───────────────────────────────────────────────────────────────────

describe("race()", () => {
  it("returns the result of the first step that resolves", async () => {
    const Fast: Step<{ value: string }> = {
      name: "Fast",
      async handle(payload, next) {
        return next({ ...payload, value: "fast" });
      },
    };
    const Slow: Step<{ value: string }> = {
      name: "Slow",
      async handle(payload, next) {
        await new Promise((r) => setTimeout(r, 100));
        return next({ ...payload, value: "slow" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([race([Fast, Slow])])
      .thenReturn();

    expect(result).toEqual({ value: "fast" });
  });

  it("rejects with PipelineError when all steps fail", async () => {
    const FailA: Step<{ value: string }> = {
      name: "FailA",
      handle() {
        throw new Error("fail A");
      },
    };
    const FailB: Step<{ value: string }> = {
      name: "FailB",
      handle() {
        throw new Error("fail B");
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([race([FailA, FailB])])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);
  });

  it("passes payload through unchanged when steps array is empty", async () => {
    const result = await pipeline({ value: "test" })
      .through([race([])])
      .thenReturn();

    expect(result).toEqual({ value: "test" });
  });

  it("works with a single step", async () => {
    const result = await pipeline({ value: "test" })
      .through([race([Uppercase])])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });

  it("takes the fastest step when multiple are available", async () => {
    const SlowFirst: Step<{ value: string }> = {
      name: "SlowFirst",
      async handle(payload, next) {
        await new Promise((r) => setTimeout(r, 80));
        return next({ ...payload, value: "slow_first" });
      },
    };
    const FastSecond: Step<{ value: string }> = {
      name: "FastSecond",
      async handle(payload, next) {
        await new Promise((r) => setTimeout(r, 10));
        return next({ ...payload, value: "fast_second" });
      },
    };

    const result = await pipeline({ value: "test" })
      .through([race([SlowFirst, FastSecond])])
      .thenReturn();

    expect(result).toEqual({ value: "fast_second" });
  });

  it("ignores failed steps when at least one succeeds", async () => {
    const Fail: Step<{ value: string }> = {
      name: "Fail",
      handle() {
        throw new Error("fail");
      },
    };

    const result = await pipeline({ value: "test" })
      .through([race([Fail, Uppercase])])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });
});

// ─── fallback() ───────────────────────────────────────────────────────────────

describe("fallback()", () => {
  it("returns primary result when primary succeeds", async () => {
    const result = await pipeline({ value: "test" })
      .through([fallback(Uppercase, AddSuffix)])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });

  it("falls back to backup when primary throws", async () => {
    const Primary: Step<{ value: string }> = {
      name: "Primary",
      handle() {
        throw new Error("primary failed");
      },
    };

    const result = await pipeline({ value: "test" })
      .through([fallback(Primary, AddSuffix)])
      .thenReturn();

    expect(result).toEqual({ value: "test_suffix" });
  });

  it("propagates error when both primary and backup throw", async () => {
    const Primary: Step<{ value: string }> = {
      name: "Primary",
      handle() {
        throw new Error("primary failed");
      },
    };
    const Backup: Step<{ value: string }> = {
      name: "Backup",
      handle() {
        throw new Error("backup failed");
      },
    };

    await expect(
      pipeline({ value: "test" })
        .through([fallback(Primary, Backup)])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);
  });

  it("step name includes the primary step name", async () => {
    const snapshots = await pipeline({ value: "test" })
      .through([fallback(Uppercase, AddSuffix)])
      .collect();

    expect(snapshots[0].step).toContain("Uppercase");
  });

  it("unnamed primary step uses 'anonymous' in step name", async () => {
    const anon: Step<{ value: string }> = {
      async handle(payload, next) {
        return next(payload);
      },
    };

    const snapshots = await pipeline({ value: "test" })
      .through([fallback(anon, AddSuffix)])
      .collect();

    expect(snapshots[0].step).toContain("anonymous");
  });

  it("context is passed to both primary and backup", async () => {
    const contextSpy = vi.fn();

    const Primary: Step<{ value: string }, { db: string }> = {
      name: "Primary",
      handle(_payload, _next, context) {
        contextSpy("primary", context.db);
        throw new Error("fail");
      },
    };
    const Backup: Step<{ value: string }, { db: string }> = {
      name: "Backup",
      async handle(payload, next, context) {
        contextSpy("backup", context.db);
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .give({ db: "postgres" })
      .through([fallback(Primary, Backup)])
      .thenReturn();

    expect(contextSpy).toHaveBeenCalledWith("primary", "postgres");
    expect(contextSpy).toHaveBeenCalledWith("backup", "postgres");
  });

  it("chained after another step", async () => {
    const Primary: Step<{ value: string }> = {
      name: "Primary",
      handle() {
        throw new Error("fail");
      },
    };

    const result = await pipeline({ value: "test" })
      .through([Uppercase, fallback(Primary, AddSuffix)])
      .thenReturn();

    expect(result).toEqual({ value: "TEST_suffix" });
  });
});

// ─── loop() ───────────────────────────────────────────────────────────────────

describe("loop()", () => {
  it("runs step until until() returns true", async () => {
    let callCount = 0;

    const Increment: Step<{ count: number }> = {
      name: "Increment",
      async handle(payload, next) {
        callCount++;
        return next({ ...payload, count: payload.count + 1 });
      },
    };

    const result = await pipeline({ count: 0 })
      .through([loop(Increment, { until: (p) => p.count >= 3 })])
      .thenReturn();

    expect(result).toEqual({ count: 3 });
    expect(callCount).toBe(3);
  });

  it("stops after maxAttempts even when condition is never met", async () => {
    let callCount = 0;

    const Increment: Step<{ count: number }> = {
      name: "Increment",
      async handle(payload, next) {
        callCount++;
        return next({ ...payload, count: payload.count + 1 });
      },
    };

    const result = await pipeline({ count: 0 })
      .through([loop(Increment, { until: () => false, maxAttempts: 5 })])
      .thenReturn();

    expect(result).toEqual({ count: 5 });
    expect(callCount).toBe(5);
  });

  it("runs only once when condition is true on the first iteration", async () => {
    const spy = vi.fn();

    const Step1: Step<{ value: string }> = {
      name: "Step1",
      async handle(payload, next) {
        spy();
        return next(payload);
      },
    };

    await pipeline({ value: "test" })
      .through([loop(Step1, { until: () => true })])
      .thenReturn();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("supports async until condition", async () => {
    let callCount = 0;

    const Increment: Step<{ count: number }> = {
      name: "Increment",
      async handle(payload, next) {
        callCount++;
        return next({ ...payload, count: payload.count + 1 });
      },
    };

    const result = await pipeline({ count: 0 })
      .through([
        loop(Increment, {
          until: async (p) => {
            await new Promise((r) => setTimeout(r, 5));
            return p.count >= 2;
          },
        }),
      ])
      .thenReturn();

    expect(result).toEqual({ count: 2 });
    expect(callCount).toBe(2);
  });

  it("step name includes the wrapped step name", async () => {
    const snapshots = await pipeline({ count: 0 })
      .through([
        loop(
          {
            name: "Increment",
            async handle(p, next) {
              return next({ ...p, count: p.count + 1 });
            },
          },
          { until: (p) => p.count >= 1 },
        ),
      ])
      .collect();

    expect(snapshots[0].step).toContain("Increment");
  });

  it("respects delay between iterations", async () => {
    const start = performance.now();
    let callCount = 0;

    const Step1: Step<{ count: number }> = {
      name: "Step1",
      async handle(payload, next) {
        callCount++;
        return next({ ...payload, count: payload.count + 1 });
      },
    };

    await pipeline({ count: 0 })
      .through([loop(Step1, { until: (p) => p.count >= 3, delay: 20 })])
      .thenReturn();

    const elapsed = performance.now() - start;
    // 3 iterations, 2 delays of 20ms each → ≥ 40ms
    expect(elapsed).toBeGreaterThanOrEqual(35);
    expect(callCount).toBe(3);
  });

  it("context is passed to each iteration", async () => {
    const contextSpy = vi.fn();

    const Step1: Step<{ count: number }, { db: string }> = {
      name: "Step1",
      async handle(payload, next, context) {
        contextSpy(context.db);
        return next({ ...payload, count: payload.count + 1 });
      },
    };

    await pipeline({ count: 0 })
      .give({ db: "postgres" })
      .through([loop(Step1, { until: (p) => p.count >= 2 })])
      .thenReturn();

    expect(contextSpy).toHaveBeenCalledTimes(2);
    expect(contextSpy).toHaveBeenCalledWith("postgres");
  });

  it("chained with other steps", async () => {
    const Increment: Step<{ count: number }> = {
      name: "Increment",
      async handle(payload, next) {
        return next({ ...payload, count: payload.count + 1 });
      },
    };

    const result = await pipeline({ count: 0 })
      .through([
        loop(Increment, { until: (p) => p.count >= 3 }),
        {
          name: "Double",
          async handle(payload, next) {
            return next({ ...payload, count: payload.count * 2 });
          },
        },
      ])
      .thenReturn();

    expect(result).toEqual({ count: 6 });
  });
});

// ─── parallel() — concurrency option ─────────────────────────────────────────

describe("parallel() — concurrency option", () => {
  it("behaves identically to original when concurrency is not set", async () => {
    const AddA: Step<{ a?: string; b?: string }> = {
      name: "AddA",
      async handle(payload, next) {
        return next({ ...payload, a: "A" });
      },
    };
    const AddB: Step<{ a?: string; b?: string }> = {
      name: "AddB",
      async handle(payload, next) {
        return next({ ...payload, b: "B" });
      },
    };

    const result = await pipeline({} as { a?: string; b?: string })
      .through([parallel([AddA, AddB])])
      .thenReturn();

    expect(result).toMatchObject({ a: "A", b: "B" });
  });

  it("limits max concurrent executions", async () => {
    let currentConcurrent = 0;
    let maxConcurrent = 0;

    const makeStep = (id: number): Step<{ results: number[] }> => ({
      name: `Step${id}`,
      async handle(payload, next) {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        await new Promise((r) => setTimeout(r, 20));
        currentConcurrent--;
        return next({ ...payload, results: [...payload.results, id] });
      },
    });

    const steps = Array.from({ length: 6 }, (_, i) => makeStep(i));

    await pipeline({ results: [] as number[] })
      .through([parallel(steps, { concurrency: 2 })])
      .thenReturn();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it("concurrency >= steps.length runs all steps simultaneously", async () => {
    const AddA: Step<{ a?: string; b?: string }> = {
      name: "AddA",
      async handle(payload, next) {
        return next({ ...payload, a: "A" });
      },
    };
    const AddB: Step<{ a?: string; b?: string }> = {
      name: "AddB",
      async handle(payload, next) {
        return next({ ...payload, b: "B" });
      },
    };

    const result = await pipeline({} as { a?: string; b?: string })
      .through([parallel([AddA, AddB], { concurrency: 10 })])
      .thenReturn();

    expect(result).toMatchObject({ a: "A", b: "B" });
  });

  it("concurrency: 1 executes steps one at a time in order", async () => {
    const order: number[] = [];

    const makeStep = (id: number): Step<{ results: number[] }> => ({
      name: `Step${id}`,
      async handle(payload, next) {
        order.push(id);
        return next({ ...payload, results: [...payload.results, id] });
      },
    });

    const steps = Array.from({ length: 4 }, (_, i) => makeStep(i));

    await pipeline({ results: [] as number[] })
      .through([parallel(steps, { concurrency: 1 })])
      .thenReturn();

    expect(order).toEqual([0, 1, 2, 3]);
  });

  it("handles empty steps array with concurrency option", async () => {
    const result = await pipeline(
      { value: "test" } as { value: string } & object,
    )
      .through([parallel([], { concurrency: 2 })])
      .thenReturn();

    expect(result).toEqual({ value: "test" });
  });

  it("merges results correctly with limited concurrency", async () => {
    const steps = ["a", "b", "c", "d"].map((key) => ({
      name: `Set${key}`,
      async handle(
        payload: Record<string, string>,
        next: (p: Record<string, string>) => Promise<Record<string, string>>,
      ) {
        return next({ ...payload, [key]: key.toUpperCase() });
      },
    })) as Step<Record<string, string>>[];

    const result = await pipeline({} as Record<string, string>)
      .through([parallel(steps, { concurrency: 2 })])
      .thenReturn();

    expect(result).toMatchObject({ a: "A", b: "B", c: "C", d: "D" });
  });
});
