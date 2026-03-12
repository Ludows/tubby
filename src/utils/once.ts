import type { Context, Step } from "../core/types";

export function once<P, C extends Context = Context>(
  step: Step<P, C>,
): Step<P, C> {
  let executed = false;
  let cachedResult: P;

  return {
    name: `once(${step.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      if (executed) {
        return next(cachedResult);
      }
      const innerNext = async (p: P) => {
        cachedResult = p;
        executed = true;
        return next(p);
      };
      return step.handle(payload, innerNext, context, stop);
    },
  };
}
