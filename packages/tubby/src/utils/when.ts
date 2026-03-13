import type { Context, Step } from "../core/types";

export function when<P, C extends Context = Context>(
  condition: (payload: P, context: Readonly<C>) => boolean,
  step: Step<P, C>,
): Step<P, C> {
  return {
    name: `when(${step.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      if (condition(payload, context)) {
        return step.handle(payload, next, context, stop);
      }
      return next(payload);
    },
  };
}
