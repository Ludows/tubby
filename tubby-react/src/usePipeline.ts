"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import type { PipelineBuilder } from "@ludoows/tubby";
import type {
  PipelineAction,
  PipelineFactory,
  PipelineState,
  UsePipelineOptions,
  UsePipelineResult,
} from "./types";

const initialState = { data: null, loading: false, error: null };

export function reducer<TPayload>(
  state: PipelineState<TPayload>,
  action: PipelineAction<TPayload>,
): PipelineState<TPayload> {
  switch (action.type) {
    case "RUN":
      return { ...state, loading: true, error: null };
    case "SUCCESS":
      return { data: action.payload, loading: false, error: null };
    case "ERROR":
      return { ...state, loading: false, error: action.error };
    case "RESET":
      return { data: null, loading: false, error: null };
    case "CANCEL":
      return { ...state, loading: false };
  }
}

export function usePipeline<TPayload>(
  factoryOrInstance:
    | PipelineFactory<TPayload>
    | PipelineBuilder<TPayload, Record<string, unknown>>,
  options?: UsePipelineOptions<TPayload>,
): UsePipelineResult<TPayload> {
  const isFactory = typeof factoryOrInstance === "function";
  const [state, dispatch] = useReducer(
    reducer<TPayload>,
    initialState as PipelineState<TPayload>,
  );

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const isFirstRender = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const execute = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    dispatch({ type: "RUN" });

    try {
      const instance = isFactory
        ? (factoryOrInstance as PipelineFactory<TPayload>)()
        : factoryOrInstance;

      const result = await (
        instance as PipelineBuilder<TPayload, Record<string, unknown>>
      )
        .give({ signal: controller.signal })
        .thenReturn();

      if (!mountedRef.current || controller.signal.aborted) {
        options?.onCancel?.();
        return;
      }

      dispatch({ type: "SUCCESS", payload: result as TPayload });
      options?.onSuccess?.(result as TPayload);
    } catch (err) {
      if (!mountedRef.current || controller.signal.aborted) {
        options?.onCancel?.();
        return;
      }
      const error = err instanceof Error ? err : new Error(String(err));
      dispatch({ type: "ERROR", error });
      options?.onError?.(error);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFactory, factoryOrInstance, options]);

  // immediate — run once at mount
  useEffect(() => {
    if (options?.immediate) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // watch + auto — skip first render to avoid double-run with immediate
  const watchDeps = options?.watch ?? [];
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (options?.auto) {
      execute();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...watchDeps]);

  const run = useCallback(() => {
    execute();
  }, [execute]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "RESET" });
  }, []);

  return {
    data: state.data,
    loading: state.loading,
    error: state.error,
    run,
    reset,
  };
}
