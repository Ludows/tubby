/**
 * @vitest-environment jsdom
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Step } from "@ludoows/tubby";
import { pipeline } from "@ludoows/tubby";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PipelineFactory } from "../src/types";
import { reducer, usePipeline } from "../src/usePipeline";

// ─── Re-export reducer for testing ──────────────────────

// ─── Helper Steps ───────────────────────────────────────

const Uppercase: Step<{ value: string }> = {
  name: "Uppercase",
  async handle(payload, next) {
    return next({ ...payload, value: payload.value.toUpperCase() });
  },
};

const SlowStep: Step<{ value: string }> = {
  name: "SlowStep",
  async handle(payload, next) {
    await new Promise((r) => setTimeout(r, 100));
    return next({ ...payload, value: "slow_done" });
  },
};

const ThrowStep: Step<{ value: string }> = {
  name: "ThrowStep",
  handle() {
    throw new Error("Step failed");
  },
};

// ─── Tests ──────────────────────────────────────────────

describe("usePipeline", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // 1.
  it("returns initial state { data: null, loading: false, error: null }", () => {
    const factory = () => pipeline({ value: "test" }).through([Uppercase]);
    const { result } = renderHook(() => usePipeline(factory));

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(typeof result.current.run).toBe("function");
    expect(typeof result.current.reset).toBe("function");
  });

  // 2.
  it("run() sets loading=true then resolves with data", async () => {
    vi.useRealTimers();

    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([Uppercase]);

    const { result } = renderHook(() => usePipeline(factory));

    act(() => {
      result.current.run();
    });

    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ value: "TEST" });
    expect(result.current.error).toBeNull();
  });

  // 3.
  it("run() sets error on failure", async () => {
    vi.useRealTimers();

    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([ThrowStep]);

    const { result } = renderHook(() => usePipeline(factory));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBeInstanceOf(Error);
    expect(result.current.data).toBeNull();
  });

  // 4.
  it("reset() clears data, loading and error", async () => {
    vi.useRealTimers();

    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([Uppercase]);

    const { result } = renderHook(() => usePipeline(factory));

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({ value: "TEST" });
    });

    act(() => {
      result.current.reset();
    });

    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  // 5.
  it("immediate=true runs at mount", async () => {
    vi.useRealTimers();

    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([Uppercase]);

    const { result } = renderHook(() =>
      usePipeline(factory, { immediate: true }),
    );

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: "TEST" });
    });
  });

  // 6.
  it("data is preserved between runs (no flash)", async () => {
    vi.useRealTimers();

    let counter = 0;
    const factory: PipelineFactory<{ value: string }> = () => {
      counter++;
      return pipeline({ value: `run_${counter}` }).through([Uppercase]);
    };

    const { result } = renderHook(() => usePipeline(factory));

    // First run
    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(result.current.data).toEqual({ value: "RUN_1" });
    });

    // Second run — data should not reset to null
    act(() => {
      result.current.run();
    });
    // During loading, data should still be RUN_1 (preserved)
    expect(result.current.data).toEqual({ value: "RUN_1" });

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: "RUN_2" });
    });
  });

  // 7.
  it("onSuccess callback is called on success", async () => {
    vi.useRealTimers();

    const onSuccess = vi.fn();
    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([Uppercase]);

    const { result } = renderHook(() => usePipeline(factory, { onSuccess }));

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledWith({ value: "TEST" });
    });
  });

  // 8.
  it("onError callback is called on error", async () => {
    vi.useRealTimers();

    const onError = vi.fn();
    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([ThrowStep]);

    const { result } = renderHook(() => usePipeline(factory, { onError }));

    act(() => {
      result.current.run();
    });
    await waitFor(() => {
      expect(onError).toHaveBeenCalledTimes(1);
    });
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  // 9.
  it("run() cancels the previous run", async () => {
    vi.useRealTimers();

    const onCancel = vi.fn();
    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([SlowStep]);

    const { result } = renderHook(() => usePipeline(factory, { onCancel }));

    // First run
    act(() => {
      result.current.run();
    });
    // Immediately run again to cancel the first
    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    // onCancel should be called for the first cancelled run
    expect(onCancel).toHaveBeenCalled();
  });

  // 10.
  it("unmount aborts in-flight pipeline", async () => {
    vi.useRealTimers();

    const onCancel = vi.fn();
    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([SlowStep]);

    const { result, unmount } = renderHook(() =>
      usePipeline(factory, { onCancel }),
    );

    act(() => {
      result.current.run();
    });
    unmount();

    // Wait a bit for the async operation to resolve
    await new Promise((r) => setTimeout(r, 200));

    expect(onCancel).toHaveBeenCalled();
  });

  // 11.
  it("accepts a PipelineBuilder instance directly", async () => {
    vi.useRealTimers();

    const instance = pipeline({ value: "direct" }).through([Uppercase]);

    const { result } = renderHook(() =>
      usePipeline(
        instance as unknown as ReturnType<PipelineFactory<{ value: string }>>,
      ),
    );

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: "DIRECT" });
    });
  });

  // 12.
  it("non-Error thrown is wrapped in Error", async () => {
    vi.useRealTimers();

    const StringThrow: Step<{ value: string }> = {
      name: "StringThrow",
      handle() {
        throw "string error";
      },
    };

    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([StringThrow]);

    const { result } = renderHook(() => usePipeline(factory));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.error?.message).toContain("string error");
  });

  // 13.
  it("auto + watch re-runs on watch changes", async () => {
    vi.useRealTimers();

    let count = 0;
    const factory: PipelineFactory<{ value: string }> = () => {
      count++;
      return pipeline({ value: `v${count}` }).through([Uppercase]);
    };

    let watchValue = "a";
    const { result, rerender } = renderHook(
      ({ watch }) => usePipeline(factory, { auto: true, watch: [watch] }),
      { initialProps: { watch: watchValue } },
    );

    // First render — should not auto-run (skip first render)
    expect(count).toBe(0);

    // Change the watch value to trigger auto-run
    await act(async () => {
      rerender({ watch: "b" });
    });

    await waitFor(() => {
      expect(result.current.data).toEqual({ value: "V1" });
    });
  });

  // 14.
  it("auto=false does not re-run on watch changes", async () => {
    vi.useRealTimers();

    let count = 0;
    const factory: PipelineFactory<{ value: string }> = () => {
      count++;
      return pipeline({ value: `v${count}` }).through([Uppercase]);
    };

    const { result, rerender } = renderHook(
      ({ watch }) => usePipeline(factory, { auto: false, watch: [watch] }),
      { initialProps: { watch: "a" } },
    );

    await act(async () => {
      rerender({ watch: "b" });
    });

    // Should not run since auto is false
    expect(count).toBe(0);
    expect(result.current.data).toBeNull();
  });
  // 15.
  it("unmount during error ignores error and calls onCancel", async () => {
    vi.useRealTimers();

    const onCancel = vi.fn();
    const onError = vi.fn();

    const DelayedThrowStep: Step<{ value: string }> = {
      name: "DelayedThrow",
      async handle() {
        await new Promise((r) => setTimeout(r, 100));
        throw new Error("fail delay");
      },
    };

    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([DelayedThrowStep]);

    const { result, unmount } = renderHook(() =>
      usePipeline(factory, { onCancel, onError }),
    );

    act(() => {
      result.current.run();
    });

    // Unmount while it's loading and before it throws
    unmount();

    await new Promise((r) => setTimeout(r, 200));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  // 16.
  it("non-Error thrown directly by the factory is wrapped in Error", async () => {
    vi.useRealTimers();

    // The factory throws a raw string — not wrapped by the pipeline — so the
    // `err instanceof Error` false-branch on line 87 of usePipeline.ts is reached.
    const factory: PipelineFactory<{ value: string }> = () => {
      // eslint-disable-next-line @typescript-eslint/no-throw-literal
      throw "raw string from factory" as never;
    };

    const { result } = renderHook(() => usePipeline(factory));

    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(Error);
    });
    expect(result.current.error?.message).toContain("raw string from factory");
  });

  // 17.
  it("cancellation without onCancel callback does not throw", async () => {
    vi.useRealTimers();

    // Run then immediately run again — cancels the first without any onCancel option
    const factory: PipelineFactory<{ value: string }> = () =>
      pipeline({ value: "test" }).through([SlowStep]);

    const { result } = renderHook(() => usePipeline(factory));

    act(() => {
      result.current.run();
    });
    // Immediately trigger a second run, which cancels the first.
    // No onCancel provided → the options?.onCancel?.() branch takes the falsy path.
    act(() => {
      result.current.run();
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toEqual({ value: "slow_done" });
  });
});

// ─── Reducer Tests ────────────────────────────────────────

describe("reducer", () => {
  it("RUN preserves data and sets loading", () => {
    const state = { data: { value: "old" }, loading: false, error: null };
    const next = reducer(state, { type: "RUN" });
    expect(next.data).toEqual({ value: "old" }); // data preserved!
    expect(next.loading).toBe(true);
    expect(next.error).toBeNull();
  });

  it("SUCCESS sets data and clears loading/error", () => {
    const state = { data: null, loading: true, error: new Error("prev") };
    const next = reducer(state, { type: "SUCCESS", payload: { value: "ok" } });
    expect(next.data).toEqual({ value: "ok" });
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  it("ERROR sets error and clears loading", () => {
    const state = { data: { value: "old" }, loading: true, error: null };
    const err = new Error("fail");
    const next = reducer(state, { type: "ERROR", error: err });
    expect(next.data).toEqual({ value: "old" }); // data preserved!
    expect(next.loading).toBe(false);
    expect(next.error).toBe(err);
  });

  it("RESET clears everything", () => {
    const state = {
      data: { value: "old" },
      loading: true,
      error: new Error("x"),
    };
    const next = reducer(state, { type: "RESET" });
    expect(next.data).toBeNull();
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });

  it("CANCEL clears loading", () => {
    const state = { data: { value: "old" }, loading: true, error: null };
    const next = reducer(state, { type: "CANCEL" });
    expect(next.data).toEqual({ value: "old" });
    expect(next.loading).toBe(false);
    expect(next.error).toBeNull();
  });
});
