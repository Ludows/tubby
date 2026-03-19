# @ludoows/tubby

Pipeline orchestrator for TypeScript — lightweight, expressive, fully typed.

```sh
npm install @ludoows/tubby
```

---

## What it does

Compose async operations as a sequence of typed **steps**. Each step receives a payload, does its thing, and hands it to the next.

```ts
import { pipeline, map, tap, retry, timeout } from '@ludoows/tubby'

const result = await pipeline({ orderId: '123', total: 99 })
  .give({ userId: 'u_42' })
  .ensure((order) => order.total > 0, 'Empty order')
  .through([
    validateStock,
    retry(timeout(chargePayment, 5000), { attempts: 3 }),
    tap((order) => logger.info('charged', order.orderId)),
    sendConfirmation,
  ])
  .thenReturn()
```

No magic. No decorators. Just functions and objects.

---

## Features

- Chainable builder API (`pipeline().give().through().thenReturn()`)
- Typed payload and context throughout the chain
- Step-level error recovery with `onError`
- Guards with `ensure()`, early exit with `stop()`
- Built-in utilities: `map`, `tap`, `branch`, `when`, `unless`, `retry`, `timeout`, `delay`, `merge`, `pick`, `parallel`, `combine`, `once`, `race`, `fallback`, `loop`
- Abort support via `.withSignal(AbortSignal)`
- Real-time step streaming with `.thenStream()`
- Observability: `inspect()`, `measure()`, `onStep()`, `collect()`

---

## TypeScript

Payload and context types flow end-to-end with no manual casting:

```ts
type Order = { id: string; total: number }
type Ctx   = { userId: string }

const result = await pipeline<Order>({ id: '1', total: 50 })
  .give<Ctx>({ userId: 'u_1' })
  .through([myStep]) // Step<Order, Ctx> — fully checked
  .thenReturn()      // Order | null
```

---

## CDN

```html
<!-- development -->
<script src="https://cdn.jsdelivr.net/npm/@ludoows/tubby/dist/index.global.js"></script>
<!-- production (minified) -->
<script src="https://cdn.jsdelivr.net/npm/@ludoows/tubby/dist/index.global.min.js"></script>
<script>
  const { pipeline, tap, retry } = Tubby
</script>
```

---

## Documentation

→ [Getting started](https://github.com/Ludows/tubby/blob/main/packages/tubby/docs/README.md) · [Full API](https://github.com/Ludows/tubby/blob/main/packages/tubby/docs/api.md) · [Utilities](https://github.com/Ludows/tubby/blob/main/packages/tubby/docs/utils.md)
