import type { Context, Step } from "../core/types";

export function pick<P extends object, K extends keyof P>(
  keys: K[],
): Step<P, Context> {
  return {
    name: "pick",
    async handle(payload, next) {
      const result = {} as Pick<P, K>;
      for (const key of keys) {
        result[key] = payload[key];
      }
      return next(result as unknown as P);
    },
  };
}
