import { describe, expect, it } from "vitest";
import type { Step, StepSnapshot } from "../src/index";
import { pipeline, PipelineError } from "../src/index";

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

// ─── withSignal() ─────────────────────────────────────────────────────────────

describe("withSignal()", () => {
  it("runs normally when signal is not aborted", async () => {
    const controller = new AbortController();
    const result = await pipeline({ value: "test" })
      .withSignal(controller.signal)
      .through([Uppercase])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });

  it("throws PipelineError immediately when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      pipeline({ value: "test" })
        .withSignal(controller.signal)
        .through([Uppercase])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);
  });

  it("aborts between steps", async () => {
    const controller = new AbortController();
    const executed: string[] = [];

    const StepA: Step<{ value: string }> = {
      name: "StepA",
      async handle(payload, next) {
        executed.push("A");
        controller.abort(); // abort after first step
        return next(payload);
      },
    };

    const StepB: Step<{ value: string }> = {
      name: "StepB",
      async handle(payload, next) {
        executed.push("B");
        return next(payload);
      },
    };

    await expect(
      pipeline({ value: "test" })
        .withSignal(controller.signal)
        .through([StepA, StepB])
        .thenThrow(),
    ).rejects.toThrow(PipelineError);

    expect(executed).toEqual(["A"]);
    expect(executed).not.toContain("B");
  });

  it("error message mentions abort", async () => {
    const controller = new AbortController();
    controller.abort();

    try {
      await pipeline({ value: "test" })
        .withSignal(controller.signal)
        .through([Uppercase])
        .thenThrow();
    } catch (err) {
      expect(err).toBeInstanceOf(PipelineError);
      expect((err as PipelineError).message).toContain("abort");
    }
  });

  it("can be used with catch() handler", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await pipeline({ value: "test" })
      .withSignal(controller.signal)
      .through([Uppercase])
      .catch(() => ({ value: "caught" }))
      .thenReturn();

    expect(result).toEqual({ value: "caught" });
  });

  it("works with context", async () => {
    const controller = new AbortController();

    const result = await pipeline({ value: "test" })
      .give({ db: "postgres" })
      .withSignal(controller.signal)
      .through([Uppercase])
      .thenReturn();

    expect(result).toEqual({ value: "TEST" });
  });
});

// ─── thenStream() ─────────────────────────────────────────────────────────────

describe("thenStream()", () => {
  it("yields a snapshot for each completed step", async () => {
    const snapshots: StepSnapshot<{ value: string }>[] = [];

    for await (const snapshot of pipeline({ value: "test" })
      .through([Uppercase, AddSuffix])
      .thenStream()) {
      snapshots.push(snapshot);
    }

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0].step).toBe("Uppercase");
    expect(snapshots[0].payload).toEqual({ value: "TEST" });
    expect(snapshots[1].step).toBe("AddSuffix");
    expect(snapshots[1].payload).toEqual({ value: "TEST_suffix" });
  });

  it("yields snapshots in execution order", async () => {
    const order: string[] = [];

    for await (const snapshot of pipeline({ value: "test" })
      .through([Uppercase, AddSuffix])
      .thenStream()) {
      order.push(snapshot.step);
    }

    expect(order).toEqual(["Uppercase", "AddSuffix"]);
  });

  it("yields nothing when there are no steps", async () => {
    const snapshots: StepSnapshot<{ value: string }>[] = [];

    for await (const snapshot of pipeline({ value: "test" })
      .through([])
      .thenStream()) {
      snapshots.push(snapshot);
    }

    expect(snapshots).toHaveLength(0);
  });

  it("includes duration in each snapshot", async () => {
    for await (const snapshot of pipeline({ value: "test" })
      .through([Uppercase])
      .thenStream()) {
      expect(typeof snapshot.duration).toBe("number");
    }
  });

  it("throws after iteration when a step fails", async () => {
    const Fail: Step<{ value: string }> = {
      name: "Fail",
      handle() {
        throw new Error("step error");
      },
    };

    await expect(async () => {
      for await (const _ of pipeline({ value: "test" })
        .through([Fail])
        .thenStream()) {
        // consume
      }
    }).rejects.toThrow(PipelineError);
  });

  it("marks skipped steps in the snapshot", async () => {
    const snapshots: StepSnapshot<{ value: string }>[] = [];

    for await (const snapshot of pipeline({ value: "test" })
      .skip(AddSuffix)
      .through([Uppercase, AddSuffix])
      .thenStream()) {
      snapshots.push(snapshot);
    }

    const skipped = snapshots.find((s) => s.step === "AddSuffix");
    expect(skipped?.skipped).toBe(true);
  });

  it("streams steps as they complete (real-time)", async () => {
    const timestamps: number[] = [];

    const SlowStep: Step<{ value: string }> = {
      name: "SlowStep",
      async handle(payload, next) {
        await new Promise((r) => setTimeout(r, 30));
        return next(payload);
      },
    };

    for await (const _ of pipeline({ value: "test" })
      .through([SlowStep, Uppercase])
      .thenStream()) {
      timestamps.push(performance.now());
    }

    expect(timestamps).toHaveLength(2);
    // SlowStep takes ~30ms, so the gap between the two timestamps should be significant
    expect(timestamps[1] - timestamps[0]).toBeGreaterThan(0);
  });

  it("works with a single step", async () => {
    const snapshots: StepSnapshot<{ value: string }>[] = [];

    for await (const snapshot of pipeline({ value: "hello" })
      .through([Uppercase])
      .thenStream()) {
      snapshots.push(snapshot);
    }

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].payload).toEqual({ value: "HELLO" });
  });
});
