import { describe, expect, it } from "vitest";
import type { Step } from "../src/index";
import {
  branch,
  combine,
  map,
  parallel,
  pipeline,
  Pipeline,
  retry,
  timeout,
} from "../src/index";

describe("Advanced Pipeline Scenarios", () => {
  // ─── Scenario 1: Real-World Data Fetching Flow ────────────────
  it("handles a complex real-world data fetching flow with retries, timeouts, and parallel steps", async () => {
    type UserData = {
      userId: number;
      user?: { id: number; name: string };
      posts?: string[];
      settings?: { theme: string };
      status?: "success" | "failed";
    };

    let fetchAttempts = 0;
    const FetchUser: Step<UserData> = {
      name: "FetchUser",
      async handle(payload, next) {
        fetchAttempts++;
        // Simulate a network failure on the first try, and a slow response on the second
        if (fetchAttempts === 1) throw new Error("Network Error");
        if (fetchAttempts === 2) {
          await new Promise((r) => setTimeout(r, 200)); // Will timeout (timeout is 100ms)
        }
        return next({
          ...payload,
          user: { id: payload.userId, name: "Alice" },
        });
      },
    };

    const FetchPosts: Step<UserData> = {
      name: "FetchPosts",
      async handle(payload, next) {
        return next({ ...payload, posts: ["Post 1", "Post 2"] });
      },
    };

    const FetchSettings: Step<UserData> = {
      name: "FetchSettings",
      async handle(payload, next) {
        return next({ ...payload, settings: { theme: "dark" } });
      },
    };

    const robustFetchUser = retry(timeout(FetchUser, 100), {
      attempts: 3,
      delay: 10,
    });

    const result = await pipeline({ userId: 1 } as UserData)
      .ensure((p) => p.userId > 0, "Invalid User ID")
      .through([robustFetchUser])
      .through([parallel([FetchPosts, FetchSettings])])
      .through([map((p) => ({ ...p, status: "success" }))])
      .catch((err, p) => ({ ...p, status: "failed" }))
      .thenReturn();

    expect(fetchAttempts).toBe(3); // 1: error, 2: timeout, 3: success
    expect(result).toMatchObject({
      userId: 1,
      user: { id: 1, name: "Alice" },
      posts: ["Post 1", "Post 2"],
      settings: { theme: "dark" },
      status: "success",
    });
  });

  // ─── Scenario 2: Deep Nesting of Pipelines and Combinations ────
  it("handles deeply nested pipelines, branches, and combinations without losing context or payload shape", async () => {
    const AddLevel = (level: number): Step<{ levels: number[] }> => ({
      name: `AddLevel_${level}`,
      async handle(payload, next) {
        return next({ ...payload, levels: [...(payload.levels || []), level] });
      },
    });

    const p1 = Pipeline.define([AddLevel(1), AddLevel(2)]);
    const p2 = Pipeline.define([AddLevel(3)]); // parallel branch 1
    const p3 = Pipeline.define([AddLevel(4)]); // parallel branch 2

    // Combine p2 and p3 in parallel, merging arrays
    const p2p3 = combine(p2, p3, {
      strategy: "parallel",
      merge: (a, b) => ({
        levels: [...new Set([...(a.levels || []), ...(b.levels || [])])].sort(),
      }),
    });

    const result = await pipeline({ levels: [] } as { levels: number[] })
      .through([p1])
      .through([
        branch({
          if: (p) => p.levels.includes(2),
          then: [p2p3],
          else: [AddLevel(99)],
        }),
      ])
      .thenReturn();

    expect(result?.levels).toEqual([1, 2, 3, 4]);
  });

  // ─── Scenario 3: Context Overriding and Immutability ────────────
  it("merges context at the builder level and distributes it to parallel branches", async () => {
    type Ctx = { tenantId: string; role: string; token?: string };

    const ReadContextBranchA: Step<{ seenInA?: string }, Ctx> = {
      async handle(payload, next, context) {
        return next({
          ...payload,
          seenInA: `A:${context.tenantId}:${context.role}:${context.token}`,
        });
      },
    };

    const ReadContextBranchB: Step<{ seenInB?: string }, Ctx> = {
      async handle(payload, next, context) {
        return next({
          ...payload,
          seenInB: `B:${context.tenantId}:${context.role}:${context.token}`,
        });
      },
    };

    const result = await pipeline({} as { seenInA?: string; seenInB?: string })
      .give({ tenantId: "t1" })
      .give({ role: "admin" })
      .give({ token: "xyz" })
      .through([parallel([ReadContextBranchA, ReadContextBranchB])])
      .thenReturn();

    expect(result).toMatchObject({
      seenInA: "A:t1:admin:xyz",
      seenInB: "B:t1:admin:xyz",
    });
  });

  // ─── Scenario 4: Error Recovery Within Parallel Branches ────────
  it("handles errors inside parallel branches gracefully when recovered via onError", async () => {
    const SafeStep: Step<{ val1?: string; val2?: string }> = {
      async handle(payload, next) {
        return next({ ...payload, val1: "safedata" });
      },
    };

    const FailingStepWithRecovery: Step<{ val1?: string; val2?: string }> = {
      handle() {
        throw new Error("Fatal inner error");
      },
      onError(err, payload) {
        return { ...payload, val2: "recovered_data" };
      },
    };

    const result = await pipeline({} as { val1?: string; val2?: string })
      .through([parallel([SafeStep, FailingStepWithRecovery])])
      .thenReturn();

    expect(result).toMatchObject({
      val1: "safedata",
      val2: "recovered_data",
    });
  });

  // ─── Scenario 5: Large Scale Pipeline (Stack Overflow Test) ─────
  it("executes 10,000 minimal steps without Call Stack Exceeded (RangeError)", async () => {
    const IncrementStep: Step<{ count: number }> = {
      async handle(payload, next) {
        return next({ count: payload.count + 1 });
      },
    };

    const steps = Array(10000).fill(IncrementStep);

    // We disable snapshots and metrics to save memory for the stress test
    const result = await pipeline({ count: 0 }).through(steps).thenReturn();

    expect(result?.count).toBe(10000);
  });

  // ─── Scenario 6: AbortSignal Integration in Tubby Core ──────────
  it("can be manually aborted from inside a step using AbortSignal injected in context", async () => {
    const controller = new AbortController();

    const AbortTriggerStep: Step<{ value: string }, { signal: AbortSignal }> = {
      async handle(payload, next, ctx, stop) {
        // Trigger abort
        controller.abort();

        // Immediately check if aborted
        if (ctx.signal.aborted) {
          return stop({ ...payload, value: "aborted" }) as unknown as {
            value: string;
          };
        }

        return next({ ...payload, value: "processed" });
      },
    };

    const result = await pipeline({ value: "start" })
      .give({ signal: controller.signal })
      .through([
        AbortTriggerStep,
        map((p) => ({ ...p, value: "should_not_reach_here" })),
      ])
      .thenReturn();

    expect(result?.value).toBe("aborted");
  });
});
