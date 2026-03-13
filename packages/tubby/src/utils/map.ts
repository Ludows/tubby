import type { Context, Step } from "../core/types";

export function map<P, C extends Context = Context>(
  fn: (payload: P, context: Readonly<C>) => P | Promise<P>,
): Step<P, C> {
  return {
    name: "map",
    async handle(payload, next, context) {
      const result = await fn(payload, context);
      return next(result);
    },
  };
}
