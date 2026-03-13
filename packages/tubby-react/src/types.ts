"use client";

import type { PipelineBuilder } from "@ludoows/tubby";

export type PipelineFactory<TPayload> = () => PipelineBuilder<
  TPayload,
  Record<string, unknown>
>;

export interface UsePipelineOptions<TPayload> {
  immediate?: boolean;
  watch?: unknown[];
  auto?: boolean;
  onSuccess?: (data: TPayload) => void;
  onError?: (error: Error) => void;
  onCancel?: () => void;
}

export interface UsePipelineResult<TPayload> {
  data: TPayload | null;
  loading: boolean;
  error: Error | null;
  run: () => void;
  reset: () => void;
}

export type PipelineState<TPayload> = {
  data: TPayload | null;
  loading: boolean;
  error: Error | null;
};

export type PipelineAction<TPayload> =
  | { type: "RUN" }
  | { type: "SUCCESS"; payload: TPayload }
  | { type: "ERROR"; error: Error }
  | { type: "RESET" }
  | { type: "CANCEL" };
