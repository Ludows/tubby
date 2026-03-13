import type { Context, Step } from "../core/types";

export function tap<P, C extends Context = Context>(
  fn: (payload: P, context: Readonly<C>) => void | Promise<void>,
): Step<P, C> {
  return {
    name: "tap",
    async handle(payload, next, context) {
      await fn(payload, context);
      return next(payload);
    },
  };
}
