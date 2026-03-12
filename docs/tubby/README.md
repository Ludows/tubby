# tubby

Pipeline orchestrator for TypeScript. Lightweight, expressive, fully typed.

## Install

```sh
npm install tubby
```

## Quick start

```ts
import { pipeline, map, tap } from 'tubby'

const result = await pipeline({ name: 'alice', score: 0 })
  .through([
    map((user) => ({ ...user, score: user.score + 10 })),
    tap((user) => console.log('processed:', user.name)),
  ])
  .thenReturn()

// { name: 'alice', score: 10 }
```

## Concept

A pipeline takes a **payload**, runs it through a sequence of **steps**, and returns the result.

Each step receives `(payload, next, context, stop)`:

- Call `next(payload)` to pass control to the next step.
- Call `stop(payload)` to exit the pipeline early with a value.
- Return a value without calling `next` to end the chain at this step.

### Writing a step

```ts
import type { Step } from 'tubby'

const addTax: Step<{ price: number }> = {
  name: 'addTax',
  async handle(payload, next) {
    return next({ ...payload, price: payload.price * 1.2 })
  },
}
```

You can also handle errors at the step level with `onError`:

```ts
const riskyStep: Step<Order> = {
  name: 'riskyStep',
  async handle(payload, next) {
    const data = await fetchSomething()
    return next({ ...payload, data })
  },
  async onError(error, payload) {
    // recover and continue with fallback
    return { ...payload, data: null }
  },
}
```

### Using context

Context is shared read-only data injected before execution — user, config, request info, etc.

```ts
type MyContext = { userId: string }

const step: Step<Order, MyContext> = {
  name: 'checkOwner',
  async handle(payload, next, context) {
    if (payload.ownerId !== context.userId) throw new Error('Forbidden')
    return next(payload)
  },
}

const result = await pipeline({ ownerId: '42' })
  .give({ userId: '42' })
  .through([step])
  .thenReturn()
```

### Stopping early

```ts
import { map } from 'tubby'

const earlyExit: Step<{ approved: boolean; total: number }> = {
  name: 'earlyExit',
  async handle(payload, next, _ctx, stop) {
    if (!payload.approved) return stop({ ...payload, total: 0 })
    return next(payload)
  },
}
```

## TypeScript

Tubby is fully typed. Payload and context types propagate through the entire chain.

```ts
type Order = { price: number; discount: number }

const result = await pipeline<Order>({ price: 100, discount: 0 })
  .through([addTax, applyDiscount])
  .thenReturn()

// result is Order | null
```

The `null` case occurs when an `ensure()` guard blocks execution. Use `thenThrow()` if you always expect a result.

---

See [api.md](./api.md) for the full `PipelineBuilder` reference.
See [utils.md](./utils.md) for built-in utility steps.
