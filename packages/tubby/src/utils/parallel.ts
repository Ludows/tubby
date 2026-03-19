import type { Context, Step } from "../core/types";
import { pipeline } from "./pipeline";

export function parallel<P extends object, C extends Context = Context>(
  steps: Step<P, C>[],
  options?: { concurrency?: number },
): Step<P, C> {
  return {
    name: "parallel",
    async handle(payload, next, context) {
      if (steps.length === 0) return next(payload);

      const concurrency = options?.concurrency;

      if (!concurrency || concurrency >= steps.length) {
        // Original unbounded behavior
        const results = await Promise.all(
          steps.map(async (step) =>
            pipeline(payload)
              .give(context as Record<string, unknown>)
              .through([step as Step<P>])
              .thenReturn(),
          ),
        );
        const merged = Object.assign({} as P, ...results) as P;
        return next(merged);
      }

      // Semaphore / worker-pool pattern
      const results: (P | null)[] = new Array(steps.length).fill(null);
      let cursor = 0;

      const worker = async () => {
        while (cursor < steps.length) {
          const index = cursor++;
          const step = steps[index];
          results[index] = await pipeline(payload)
            .give(context as Record<string, unknown>)
            .through([step as Step<P>])
            .thenReturn();
        }
      };

      const workers = Array.from(
        { length: Math.min(concurrency, steps.length) },
        worker,
      );
      await Promise.all(workers);

      const merged = Object.assign({} as P, ...results) as P;
      return next(merged);
    },
  };
}
