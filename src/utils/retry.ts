import type { Context, Step } from "../core/types";

export function retry<P, C extends Context = Context>(
  step: Step<P, C>,
  options: {
    attempts: number;
    delay?: number;
    factor?: number;
    onRetry?: (error: Error, attempt: number) => void;
  },
): Step<P, C> {
  const { attempts, delay: baseDelay = 500, factor = 2, onRetry } = options;

  return {
    name: `retry(${step.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          return await step.handle(payload, next, context, stop);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
          if (attempt < attempts) {
            onRetry?.(lastError, attempt);
            const ms = baseDelay * Math.pow(factor, attempt - 1);
            await new Promise((resolve) => setTimeout(resolve, ms));
          }
        }
      }
      throw lastError!;
    },
  };
}
