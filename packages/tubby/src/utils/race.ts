import type { Context, Step } from "../core/types";
import { pipeline } from "./pipeline";

export function race<P, C extends Context = Context>(
  steps: Step<P, C>[],
): Step<P, C> {
  return {
    name: "race",
    async handle(payload, next, context) {
      if (steps.length === 0) return next(payload);
      const promises = steps.map((step) =>
        pipeline(payload)
          .give(context as Record<string, unknown>)
          .through([step as Step<P>])
          .thenReturn() as Promise<P>,
      );
      const result = await Promise.any(promises);
      return next(result);
    },
  };
}
