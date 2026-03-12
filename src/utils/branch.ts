import type { Context, Step } from "../core/types";
import { StopSignal } from "../core/types";

export function branch<P, C extends Context = Context>(options: {
  if: (payload: P, context: Readonly<C>) => boolean;
  then: Step<P, C>[];
  else: Step<P, C>[];
}): Step<P, C> {
  return {
    name: "branch",
    async handle(payload, next, context, stop) {
      const steps = options.if(payload, context) ? options.then : options.else;
      let current = payload;
      for (const step of steps) {
        const innerNext = async (p: P) => p;
        const result = await step.handle(current, innerNext, context, stop);
        if (result instanceof StopSignal) {
          return stop(result.value) as unknown as P;
        }
        current = result;
      }
      return next(current);
    },
  };
}
