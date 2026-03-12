import type { Context, Step } from "../core/types";

export function delay<P>(ms: number): Step<P, Context> {
  return {
    name: "delay",
    async handle(payload, next) {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return next(payload);
    },
  };
}
