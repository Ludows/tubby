import type { CombineOptions, Context, Step } from "../core/types";
import { StopSignal } from "../core/types";

export function combine<P, C extends Context = Context>(
  pipelineA: Step<P, C>,
  pipelineB: Step<P, C>,
  options?: CombineOptions<P>,
): Step<P, C> {
  const strategy = options?.strategy ?? "sequential";
  const mergeFn =
    options?.merge ??
    ((a: P, b: P) => Object.assign({}, a as object, b as object) as P);

  return {
    name: "combine",
    async handle(payload, next, context) {
      const nextNoop = async (p: P) => p;
      const stopNoop = (v: P) => new StopSignal(v);

      if (strategy === "sequential") {
        let resultA = await pipelineA.handle(
          payload,
          nextNoop,
          context,
          stopNoop,
        );
        if (resultA instanceof StopSignal) resultA = resultA.value;
        let resultB = await pipelineB.handle(
          resultA,
          nextNoop,
          context,
          stopNoop,
        );
        if (resultB instanceof StopSignal) resultB = resultB.value;
        return next(resultB);
      } else {
        const [resultA, resultB] = await Promise.all([
          pipelineA.handle(payload, nextNoop, context, stopNoop),
          pipelineB.handle(payload, nextNoop, context, stopNoop),
        ]);
        const a = resultA instanceof StopSignal ? resultA.value : resultA;
        const b = resultB instanceof StopSignal ? resultB.value : resultB;
        return next(mergeFn(a, b));
      }
    },
  };
}
