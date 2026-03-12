import { TimeoutError } from "../core/errors";
import type { Context, Step } from "../core/types";

export function timeout<P, C extends Context = Context>(
  step: Step<P, C>,
  ms: number,
): Step<P, C> {
  return {
    name: `timeout(${step.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      const stepName = step.name ?? "anonymous";
      return new Promise<P>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new TimeoutError(stepName, ms));
        }, ms);

        Promise.resolve(step.handle(payload, next, context, stop))
          .then((result) => {
            clearTimeout(timer);
            resolve(result);
          })
          .catch((err) => {
            clearTimeout(timer);
            reject(err);
          });
      });
    },
  };
}
