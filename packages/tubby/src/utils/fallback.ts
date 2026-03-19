import type { Context, Next, Step, Stop } from "../core/types";
import { StopSignal } from "../core/types";

export function fallback<P, C extends Context = Context>(
  primary: Step<P, C>,
  backup: Step<P, C>,
): Step<P, C> {
  return {
    name: `fallback(${primary.name ?? "anonymous"})`,
    async handle(payload, next, context, stop) {
      const noopNext: Next<P> = async (p) => p;
      const noopStop: Stop<P> = (v) => new StopSignal(v);
      try {
        const r = await primary.handle(payload, noopNext, context, noopStop);
        const value = r instanceof StopSignal ? r.value : r;
        return next(value);
      } catch {
        const r = await backup.handle(payload, noopNext, context, noopStop);
        const value = r instanceof StopSignal ? r.value : r;
        return next(value);
      }
    },
  };
}
