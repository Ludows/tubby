# Tubby

Pipeline orchestrator for TypeScript — lightweight, expressive, fully typed.

```sh
npm install tubby
```

---

## What it does

Tubby lets you compose async operations as a sequence of typed **steps**. Each step receives a payload, does its thing, and hands it to the next.

```ts
import { pipeline, map, tap, retry, timeout } from 'tubby'

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

## Packages

### `tubby` — core

The pipeline engine. Works anywhere TypeScript runs.

- Chainable builder API (`pipeline().give().through().thenReturn()`)
- Typed payload and context throughout the chain
- Step-level error recovery with `onError`
- Guards with `ensure()`, early exit with `stop()`
- Built-in utilities: `map`, `tap`, `branch`, `when`, `unless`, `retry`, `timeout`, `delay`, `merge`, `pick`, `parallel`, `combine`, `once`
- Observability: `inspect()`, `measure()`, `onStep()`, `collect()`

→ [Documentation](./docs/tubby/README.md) · [Full API](./docs/tubby/api.md) · [Utilities](./docs/tubby/utils.md)

---

### `tubby-react` — React integration

```sh
npm install tubby tubby-react
```

A single hook — `usePipeline` — that wraps any pipeline with `data`, `loading`, and `error` state. Handles cancellation automatically.

```tsx
const { data, loading, error, run } = usePipeline(
  () => pipeline(query).through([fetchResults, formatResults]),
  { immediate: true, auto: true, watch: [query] }
)
```

Modes: run at mount, re-run on deps change, or trigger manually.
Requests are cancelled on unmount and on re-run.

→ [Documentation](./docs/tubby-react/README.md) · [Full API](./docs/tubby-react/api.md)

---

## TypeScript

Both packages are written in TypeScript and ship their own types. No `@types` needed.

Payload and context types flow end-to-end:

```ts
type Order = { id: string; total: number }
type Ctx   = { userId: string }

const result = await pipeline<Order>({ id: '1', total: 50 })
  .give<Ctx>({ userId: 'u_1' })
  .through([myStep]) // Step<Order, Ctx> — fully checked
  .thenReturn()      // Order | null
```

---

## Contributing

Issues and PRs are welcome.

**To get started:**

```sh
git clone https://github.com/your-org/tubby
cd tubby && npm install
npm test

cd tubby-react && npm install
npm test
```

A few guidelines:

- Keep it minimal. Every addition has a cost.
- New utilities belong in `src/utils/` and should follow the existing pattern.
- PRs should include tests and update the relevant doc if behavior changes.

Open an issue first if you're planning something significant.
