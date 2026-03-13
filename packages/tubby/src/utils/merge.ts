import type { Context, Step } from "../core/types";

export function merge<P extends object, E extends object>(
  extra: E,
): Step<P, Context> {
  return {
    name: "merge",
    async handle(payload, next) {
      return next({ ...payload, ...extra } as P);
    },
  };
}
