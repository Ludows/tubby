# Utility steps

All utilities return a `Step` and can be dropped into any `.through([...])` call.

---

## `map(fn)`

Transforms the payload.

```ts
import { map } from '@ludoows/tubby'

map((order) => ({ ...order, total: order.price * order.qty }))
```

**Signature:**
```ts
map<P, C extends Context = Context>(
  fn: (payload: P, context: Readonly<C>) => P | Promise<P>
): Step<P, C>
```

---

## `tap(fn)`

Side effect. Receives the payload, does not modify it.

```ts
import { tap } from '@ludoows/tubby'

tap((order, ctx) => {
  logger.info('Processing order', { id: order.id, user: ctx.userId })
})
```

**Signature:**
```ts
tap<P, C extends Context = Context>(
  fn: (payload: P, context: Readonly<C>) => void | Promise<void>
): Step<P, C>
```

---

## `branch({ if, then, else })`

Conditional branching. Runs one set of steps or another depending on the condition.

```ts
import { branch } from '@ludoows/tubby'

branch({
  if: (order) => order.isPremium,
  then: [applyPremiumDiscount, assignFastShipping],
  else: [applyStandardPricing],
})
```

**Signature:**
```ts
branch<P, C extends Context = Context>(options: {
  if: (payload: P, context: Readonly<C>) => boolean
  then: Step<P, C>[]
  else: Step<P, C>[]
}): Step<P, C>
```

---

## `when(condition, step)`

Runs the step only if the condition is true. Otherwise passes the payload through.

```ts
import { when } from '@ludoows/tubby'

when(
  (order) => order.couponCode !== null,
  applyCoupon
)
```

**Signature:**
```ts
when<P, C extends Context = Context>(
  condition: (payload: P, context: Readonly<C>) => boolean,
  step: Step<P, C>
): Step<P, C>
```

---

## `unless(condition, step)`

Inverse of `when`. Runs the step only if the condition is false.

```ts
import { unless } from '@ludoows/tubby'

unless(
  (order) => order.isInternal,
  chargePayment
)
```

**Signature:**
```ts
unless<P, C extends Context = Context>(
  condition: (payload: P, context: Readonly<C>) => boolean,
  step: Step<P, C>
): Step<P, C>
```

---

## `delay(ms)`

Pauses execution for `ms` milliseconds.

```ts
import { delay } from '@ludoows/tubby'

delay(500)
```

**Signature:**
```ts
delay<P>(ms: number): Step<P, Context>
```

---

## `retry(step, options)`

Retries a step on failure with exponential backoff.

```ts
import { retry } from '@ludoows/tubby'

retry(fetchExternalData, {
  attempts: 3,
  delay: 300,     // base delay in ms (default: 500)
  factor: 2,      // backoff multiplier (default: 2)
  onRetry: (error, attempt) => {
    console.warn(`Attempt ${attempt} failed:`, error.message)
  },
})
```

Backoff formula: `delay * factor^(attempt - 1)`
- Attempt 1: 300ms
- Attempt 2: 600ms
- Attempt 3: 1200ms

After exhausting all attempts, the last error is thrown.

**Signature:**
```ts
retry<P, C extends Context = Context>(
  step: Step<P, C>,
  options: {
    attempts: number
    delay?: number
    factor?: number
    onRetry?: (error: Error, attempt: number) => void
  }
): Step<P, C>
```

---

## `timeout(step, ms)`

Throws a `TimeoutError` if the step takes longer than `ms` milliseconds.

```ts
import { timeout, TimeoutError } from '@ludoows/tubby'

timeout(fetchExternalData, 3000)
```

Combine with `retry` for resilience:

```ts
retry(timeout(fetchExternalData, 3000), { attempts: 3 })
```

**Signature:**
```ts
timeout<P, C extends Context = Context>(
  step: Step<P, C>,
  ms: number
): Step<P, C>
```

---

## `merge(extra)`

Merges extra fields into the payload.

```ts
import { merge } from '@ludoows/tubby'

merge({ source: 'api', processedAt: new Date() })
```

**Signature:**
```ts
merge<P extends object, E extends object>(extra: E): Step<P, Context>
```

---

## `pick(keys)`

Keeps only the specified keys in the payload.

```ts
import { pick } from '@ludoows/tubby'

pick(['id', 'name', 'email'])
```

**Signature:**
```ts
pick<P extends object, K extends keyof P>(keys: K[]): Step<P, Context>
```

---

## `parallel(steps, options?)`

Runs steps concurrently against the same payload, then merges all results with `Object.assign`.

```ts
import { parallel } from '@ludoows/tubby'

parallel([fetchUserProfile, fetchUserOrders, fetchUserPreferences])
```

Each step receives the original payload independently. Results are merged shallowly.

Use the `concurrency` option to limit how many steps run at the same time (worker-pool pattern):

```ts
// at most 2 steps run simultaneously
parallel(steps, { concurrency: 2 })

// execute one at a time, in order (equivalent to sequential)
parallel(steps, { concurrency: 1 })
```

**Signature:**
```ts
parallel<P extends object, C extends Context = Context>(
  steps: Step<P, C>[],
  options?: { concurrency?: number }
): Step<P, C>
```

---

## `combine(pipelineA, pipelineB, options?)`

Runs two sub-pipelines and merges their outputs. Both must be `Step` instances (use `Pipeline.define()` to wrap a sequence).

```ts
import { combine, Pipeline } from '@ludoows/tubby'

const pricing  = Pipeline.define([applyTax, applyDiscount])
const shipping = Pipeline.define([calculateShipping])

combine(pricing, shipping, { strategy: 'parallel' })
```

Options:

```ts
{
  strategy: 'sequential' | 'parallel'   // default: 'sequential'
  merge: (a, b) => merged               // default: Object.assign({}, a, b)
}
```

**Signature:**
```ts
combine<P, C extends Context = Context>(
  pipelineA: Step<P, C>,
  pipelineB: Step<P, C>,
  options?: CombineOptions<P>
): Step<P, C>
```

---

## `once(step)`

Executes a step only on the first call. Subsequent calls return the cached result.

```ts
import { once } from '@ludoows/tubby'

const loadConfig = once(fetchRemoteConfig)

// used in multiple pipelines — only fetches once
```

**Signature:**
```ts
once<P, C extends Context = Context>(step: Step<P, C>): Step<P, C>
```

---

## `race(steps)`

Runs all steps concurrently and returns the result of the first one to resolve. Ignores failures unless all steps fail.

```ts
import { race } from '@ludoows/tubby'

race([fetchFromRegionA, fetchFromRegionB, fetchFromRegionC])
```

If all steps throw, a `PipelineError` is thrown. If the array is empty, the payload passes through unchanged.

**Signature:**
```ts
race<P, C extends Context = Context>(steps: Step<P, C>[]): Step<P, C>
```

---

## `fallback(primary, backup)`

Runs the primary step. If it throws, runs the backup step instead.

```ts
import { fallback } from '@ludoows/tubby'

fallback(fetchFromRemoteCache, fetchFromDatabase)
```

If both throw, the error from the backup step is propagated as a `PipelineError`.

The generated step name is `fallback(<primaryName>)`.

**Signature:**
```ts
fallback<P, C extends Context = Context>(
  primary: Step<P, C>,
  backup: Step<P, C>
): Step<P, C>
```

---

## `loop(step, options)`

Repeats a step until a condition is met or a maximum number of attempts is reached.

```ts
import { loop } from '@ludoows/tubby'

loop(pollJobStatus, {
  until: (payload) => payload.status === 'done',
  maxAttempts: 10,
  delay: 1000,   // ms between iterations
})
```

- `until` — called after each iteration; stops when it returns `true`. Can be async.
- `maxAttempts` — hard cap on iterations (default: `Infinity`).
- `delay` — milliseconds to wait between iterations (default: `0`).

The generated step name is `loop(<stepName>)`.

**Signature:**
```ts
loop<P, C extends Context = Context>(
  step: Step<P, C>,
  options: LoopOptions<P>
): Step<P, C>

interface LoopOptions<P> {
  until: (payload: P) => boolean | Promise<boolean>
  maxAttempts?: number
  delay?: number
}
```
