export type Context = Record<string, unknown>;

export interface Step<TPayload, TContext extends Context = Context> {
  name?: string;
  handle(
    payload: TPayload,
    next: Next<TPayload>,
    context: Readonly<TContext>,
    stop: Stop<TPayload>,
  ): Promise<TPayload> | TPayload;
  onError?(
    error: Error,
    payload: TPayload,
    context: Readonly<TContext>,
  ): Promise<TPayload> | TPayload | never;
}

export type Next<TPayload> = (payload: TPayload) => Promise<TPayload>;
export type Stop<TPayload> = (value: TPayload) => StopSignal<TPayload>;

export class StopSignal<TPayload> {
  readonly value: TPayload;
  constructor(value: TPayload) {
    this.value = value;
  }
}

export interface StepSnapshot<TPayload> {
  step: string;
  payload: TPayload;
  duration: number;
  skipped?: boolean;
}

export interface MeasuredResult<TPayload> {
  result: TPayload;
  metrics: Record<string, number>;
  totalDuration: number;
}

export interface StepEvent<TPayload, TContext extends Context = Context> {
  step: string;
  status: "completed" | "skipped" | "failed";
  payloadBefore: TPayload;
  payloadAfter: TPayload;
  context: Readonly<TContext>;
  duration: number;
  error?: Error;
}

export interface EnsureOptions {
  strategy?: "first" | "all";
}

export interface CombineOptions<TPayload> {
  strategy?: "sequential" | "parallel";
  merge?: (a: TPayload, b: TPayload) => TPayload;
}

export interface InspectOptions {
  logger?: (message: string) => void;
  showPayload?: boolean;
  showContext?: boolean;
  showTimings?: boolean;
}

export type EnsureCondition<TPayload, TContext extends Context> = (
  payload: TPayload,
  context: Readonly<TContext>,
) => boolean | Promise<boolean>;

export type EnsureMessage<TPayload, TContext extends Context> =
  | string
  | ((payload: TPayload, context: Readonly<TContext>) => string);

export interface EnsureEntry<TPayload, TContext extends Context> {
  condition: EnsureCondition<TPayload, TContext>;
  message?: EnsureMessage<TPayload, TContext>;
  options?: EnsureOptions;
}

export type StepProvider<TPayload, TContext extends Context> =
  | Step<TPayload, TContext>[]
  | ((
      payload: TPayload,
      context: Readonly<TContext>,
    ) => Step<TPayload, TContext>[] | Promise<Step<TPayload, TContext>[]>);
