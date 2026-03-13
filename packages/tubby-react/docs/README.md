# tubby-react

React integration for tubby. Wraps any pipeline in a hook with loading, error, and data state.

## Install

```sh
npm install @ludoows/tubby @ludoows/tubby-react
```

Requires React ≥ 18 as a peer dependency.

## Quick start

```tsx
import { usePipeline, pipeline, map, tap } from '@ludoows/tubby'
import { usePipeline } from '@ludoows/tubby-react'

function OrderSummary({ orderId }: { orderId: string }) {
  const { data, loading, error, run } = usePipeline(
    () =>
      pipeline({ id: orderId })
        .through([fetchOrder, applyPricing, formatSummary]),
    { immediate: true }
  )

  if (loading) return <p>Loading...</p>
  if (error)   return <p>Error: {error.message}</p>
  if (!data)   return null

  return <div>{data.summary}</div>
}
```

## Modes

### Manual trigger

The default. Call `run()` to execute the pipeline.

```tsx
const { data, loading, run } = usePipeline(
  () => pipeline(form).through([validateForm, submitOrder])
)

return <button onClick={run} disabled={loading}>Submit</button>
```

### Run at mount

```tsx
usePipeline(factory, { immediate: true })
```

### Re-run when dependencies change

```tsx
const { data } = usePipeline(
  () => pipeline({ page, filters }).through([fetchResults]),
  { auto: true, watch: [page, filters] }
)
```

`watch` accepts any array of values (like `useEffect` deps). The pipeline re-runs whenever they change. Combines cleanly with `immediate`.

## Cancellation

Pending pipelines are automatically cancelled when:

- The component unmounts
- `run()` is called again while a pipeline is already running
- `reset()` is called

Cancellation is handled via `AbortController`. The signal is injected into context as `ctx.signal` — use it in steps that support abort:

```ts
const fetchStep: Step<{ url: string }, { signal: AbortSignal }> = {
  name: 'fetch',
  async handle(payload, next, ctx) {
    const res = await fetch(payload.url, { signal: ctx.signal })
    return next({ ...payload, data: await res.json() })
  },
}
```

## TypeScript

Pass your payload type to `usePipeline`:

```tsx
type SearchResult = { items: Item[]; total: number }

const { data } = usePipeline<SearchResult>(
  () => pipeline(query).through([search, formatResults]),
  { immediate: true }
)

// data is SearchResult | null
```

---

See [api.md](./api.md) for the full `usePipeline` reference.
