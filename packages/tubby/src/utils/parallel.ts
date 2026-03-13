import type { Context, Step } from "../core/types";
import { pipeline } from "./pipeline";

export function parallel<P extends object, C extends Context = Context>(
  steps: Step<P, C>[],
): Step<P, C> {
  return {
    name: "parallel",
    async handle(payload, next, context) {
      const results = await Promise.all(
        steps.map(async (step) => {
          // Use pipeline() directly initialized with payload and context
          return pipeline(payload).give(context).through([step]).thenReturn();
        }),
      );
      const merged = Object.assign({} as P, ...results) as P;
      return next(merged);
    },
  };
}
