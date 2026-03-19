import type { Context, Next, Step, Stop } from "../core/types";
import { StopSignal } from "../core/types";

export interface LoopOptions<P> {
  until: (payload: P) => boolean | Promise<boolean>;
  maxAttempts?: number;
  delay?: number;
}

export function loop<P, C extends Context = Context>(
  step: Step<P, C>,
  options: LoopOptions<P>,
): Step<P, C> {
  const { until, maxAttempts = Infinity, delay: delayMs = 0 } = options;

  return {
    name: `loop(${step.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      let current = payload;
      let attempt = 0;

      while (attempt < maxAttempts) {
        attempt++;
        const noopNext: Next<P> = async (p) => p;
        const noopStop: Stop<P> = (v) => new StopSignal(v);
        const result = await step.handle(current, noopNext, context, noopStop);
        current = result instanceof StopSignal ? result.value : result;

        if (await until(current)) break;

        if (attempt < maxAttempts && delayMs > 0) {
          await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        }
      }

      return next(current);
    },
  };
}
