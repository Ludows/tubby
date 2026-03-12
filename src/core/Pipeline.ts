import { PipelineBuilder } from "./PipelineBuilder";
import type { Context, Step } from "./types";
import { StopSignal } from "./types";

export class Pipeline {
  static send<TPayload>(
    payload: TPayload,
  ): PipelineBuilder<TPayload, Record<string, never>> {
    return new PipelineBuilder<TPayload, Record<string, never>>(payload);
  }

  static define<TPayload, TContext extends Context = Context>(
    steps:
      | Step<TPayload, TContext>[]
      | ((
          payload: TPayload,
          context: Readonly<TContext>,
        ) => Step<TPayload, TContext>[]),
  ): Step<TPayload, TContext> {
    return {
      name: "Pipeline.define",
      async handle(payload, next, context) {
        const resolvedSteps = Array.isArray(steps)
          ? steps
          : steps(payload, context);
        let current = payload;
        for (const step of resolvedSteps) {
          const innerNext = async (p: TPayload) => p;
          const innerStop = (v: TPayload) => new StopSignal(v);
          const result = await step.handle(
            current,
            innerNext,
            context,
            innerStop,
          );
          if (result instanceof StopSignal) {
            return next(result.value);
          }
          current = result;
        }
        return next(current);
      },
    };
  }
}
