# API Reference

## `pipeline(payload)`

Alias for `Pipeline.send(payload)`. Returns a `PipelineBuilder`.

```ts
import { pipeline } from '@ludoows/tubby'

pipeline({ id: 1, name: 'alice' })
```

---

## PipelineBuilder

All methods return `this` (chainable) unless noted.

### `.give(context)`

Injects context into the pipeline. Merges with existing context. Narrows the `TContext` type.

```ts
pipeline(order)
  .give({ userId: '42', role: 'admin' })
  .through([...])
```

### `.through(steps)`

Adds a set of steps to the pipeline. Can be an array or a function that returns an array (resolved at execution time).

```ts
// static
.through([stepA, stepB])

// dynamic — steps resolved from payload/context at runtime
.through((payload, ctx) => ctx.role === 'admin' ? [adminStep] : [userStep])
```

Can be called multiple times — steps accumulate in order.

### `.ensure(condition, message?, options?)`

Guards execution. If the condition returns `false`, the pipeline is blocked and returns `null`.

```ts
pipeline(order)
  .ensure(
    (order) => order.total > 0,
    'Order total must be positive'
  )
  .through([...])
  .thenReturn()
```

By default, the first failing ensure stops immediately (`strategy: 'first'`). Use `strategy: 'all'` to collect all failures before stopping.

```ts
.ensure(isValid, 'invalid', { strategy: 'all' })
```

The message can be a string or a function:

```ts
.ensure(
  (order) => order.stock > 0,
  (order) => `Out of stock: ${order.productId}`
)
```

### `.before(fn)`

Runs before step execution.

```ts
.before((payload, ctx) => {
  console.log('Starting pipeline', payload)
})
```

### `.after(fn)`

Runs after all steps complete successfully.

```ts
.after((result, ctx, duration) => {
  console.log(`Done in ${duration}ms`, result)
})
```

### `.finally(fn)`

Always runs, regardless of success or failure.

```ts
.finally((ctx, duration) => {
  db.close()
})
```

### `.catch(handler)`

Catches a `PipelineError` (wraps any error thrown inside a step). Returns a fallback payload to continue.

```ts
.catch((error, payload, ctx) => {
  console.error(`Failed at step "${error.step}":`, error.originalError)
  return { ...payload, failed: true }
})
```

`PipelineError` exposes:
- `error.step` — name of the failing step
- `error.payload` — payload at the time of failure
- `error.originalError` — the original `Error`

### `.onStep(callback)`

Fires after each step with a `StepEvent`.

```ts
.onStep((event) => {
  console.log(event.step, event.status, event.duration)
})
```

`StepEvent<TPayload, TContext>`:

```ts
interface StepEvent<TPayload, TContext> {
  step: string
  status: 'completed' | 'skipped' | 'failed'
  payloadBefore: TPayload
  payloadAfter: TPayload
  context: Readonly<TContext>
  duration: number   // ms
  error?: Error
}
```

### `.inspect(options?)`

Logs a trace of each step to the console during execution.

```ts
.inspect()

// with options
.inspect({
  logger: (msg) => myLogger.debug(msg),
  showPayload: true,   // default: true
  showTimings: true,   // default: true
})
```

### `.measure()`

Enables per-step timing. Changes the return type of `thenReturn()` to `MeasuredResult<TPayload>`.

```ts
const result = await pipeline(order)
  .through([stepA, stepB])
  .measure()
  .thenReturn()

// result.result     → TPayload
// result.metrics    → { stepA: 12, stepB: 3 }  (ms)
// result.totalDuration → 15
```

### `.skip(...steps)`

Marks steps to skip during this execution. Skipped steps are tracked in `onStep` events with `status: 'skipped'`.

```ts
.skip(auditStep, notificationStep)
```

### `.combine(pipelineA, pipelineB, options?)`

Runs two sub-pipelines and merges their output.

```ts
import { Pipeline } from '@ludoows/tubby'

const enriched = Pipeline.define([fetchUserData])
const priced   = Pipeline.define([applyPricing])

pipeline(order)
  .combine(enriched, priced)
  .thenReturn()
```

Options:

```ts
{
  strategy: 'sequential' | 'parallel'  // default: 'sequential'
  merge: (a, b) => merged              // default: Object.assign({}, a, b)
}
```

---

## Terminating the pipeline

### `.thenReturn()`

Runs the pipeline and returns the result.

```ts
const result = await pipeline(order).through([...]).thenReturn()
// TPayload | null  (null if ensure() blocked)

// with .measure():
// MeasuredResult<TPayload> | null
```

### `.thenCall(fn)`

Runs the pipeline and calls `fn` with the result. Does nothing if blocked by `ensure()`.

```ts
await pipeline(order)
  .through([...])
  .thenCall((result) => {
    res.json(result)
  })
```

### `.thenThrow()`

Runs the pipeline and always returns `TPayload`. Use when you're certain the pipeline won't be blocked.

```ts
const result = await pipeline(order).through([...]).thenThrow()
// TPayload (throws if a step throws and no .catch() is set)
```

### `.collect()`

Runs the pipeline and returns a snapshot of each step's output.

```ts
const snapshots = await pipeline(order).through([stepA, stepB]).collect()

// [
//   { step: 'stepA', payload: {...}, duration: 5 },
//   { step: 'stepB', payload: {...}, duration: 2 },
// ]
```

`StepSnapshot<TPayload>`:

```ts
interface StepSnapshot<TPayload> {
  step: string
  payload: TPayload
  duration: number
  skipped?: boolean
}
```

---

## `Pipeline.define(steps)`

Wraps a sequence of steps into a single reusable `Step`. Useful for composing sub-pipelines.

```ts
import { Pipeline } from '@ludoows/tubby'

const pricingPipeline = Pipeline.define([applyTax, applyDiscount])

// use as a step in another pipeline
pipeline(order)
  .through([validateOrder, pricingPipeline, sendConfirmation])
  .thenReturn()
```

---

## Types

```ts
import type {
  Step,
  Context,
  Next,
  Stop,
  StopSignal,
  StepEvent,
  StepSnapshot,
  MeasuredResult,
  CombineOptions,
  EnsureOptions,
  InspectOptions,
} from '@ludoows/tubby'
```

```ts
type Context = Record<string, unknown>

interface Step<TPayload, TContext extends Context = Context> {
  name?: string
  handle(
    payload: TPayload,
    next: Next<TPayload>,
    context: Readonly<TContext>,
    stop: Stop<TPayload>
  ): Promise<TPayload> | TPayload
  onError?(
    error: Error,
    payload: TPayload,
    context: Readonly<TContext>
  ): Promise<TPayload> | TPayload | never
}

type Next<TPayload> = (payload: TPayload) => Promise<TPayload>
type Stop<TPayload> = (value: TPayload) => StopSignal<TPayload>
```

---

## Errors

```ts
import { TubbyError, PipelineError, TimeoutError } from '@ludoows/tubby'
```

| Class | When |
|---|---|
| `TubbyError` | Base class |
| `PipelineError` | A step threw — wraps the original error with `step`, `payload`, `originalError` |
| `TimeoutError` | A `timeout()` wrapper expired — exposes `step` and `ms` |
