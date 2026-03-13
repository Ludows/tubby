import type { Context, Step } from "../core/types";

export function unless<P, C extends Context = Context>(
  condition: (payload: P, context: Readonly<C>) => boolean,
  step: Step<P, C>,
): Step<P, C> {
  return {
    name: `unless(${step.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      if (!condition(payload, context)) {
        return step.handle(payload, next, context, stop);
      }
      return next(payload);
    },
  };
}
