import { Pipeline } from "../core/Pipeline";
import type { PipelineBuilder } from "../core/PipelineBuilder";

export function pipeline<TPayload>(
  payload: TPayload,
): PipelineBuilder<TPayload, Record<string, never>> {
  return Pipeline.send(payload);
}
