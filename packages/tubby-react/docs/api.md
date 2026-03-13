# API Reference

## `usePipeline(factory, options?)`

```ts
import { usePipeline } from '@ludoows/tubby-react'
```

**Signature:**

```ts
function usePipeline<TPayload>(
  factory: PipelineFactory<TPayload> | PipelineBuilder<TPayload>,
  options?: UsePipelineOptions<TPayload>
): UsePipelineResult<TPayload>
```

The first argument can be:
- A **factory function** `() => PipelineBuilder` — recommended. Recreated on each `run()` call.
- A **`PipelineBuilder` instance** directly — if you manage it yourself.

---

## Options

```ts
interface UsePipelineOptions<TPayload> {
  immediate?: boolean
  auto?: boolean
  watch?: unknown[]
  onSuccess?: (data: TPayload) => void
  onError?: (error: Error) => void
  onCancel?: () => void
}
```

| Option | Default | Description |
|---|---|---|
| `immediate` | `false` | Run the pipeline once when the component mounts |
| `auto` | `false` | Re-run automatically when `watch` values change |
| `watch` | `[]` | Dependency array for `auto` mode (works like `useEffect` deps) |
| `onSuccess` | — | Callback fired with the result on success |
| `onError` | — | Callback fired with the error on failure |
| `onCancel` | — | Callback fired when a run is cancelled |

---

## Return value

```ts
interface UsePipelineResult<TPayload> {
  data: TPayload | null
  loading: boolean
  error: Error | null
  run: () => void
  reset: () => void
}
```

| Property | Description |
|---|---|
| `data` | The pipeline result, or `null` if not yet run or blocked |
| `loading` | `true` while the pipeline is executing |
| `error` | The error if the pipeline threw, otherwise `null` |
| `run()` | Triggers the pipeline manually |
| `reset()` | Cancels any running pipeline and clears state |

---

## Examples

### Manual form submit

```tsx
function CheckoutForm() {
  const [form, setForm] = useState({ email: '', total: 0 })

  const { loading, error, run } = usePipeline(
    () =>
      pipeline(form)
        .ensure((f) => f.email.includes('@'), 'Invalid email')
        .through([validateStock, chargePayment, sendConfirmation]),
    {
      onSuccess: () => router.push('/confirmation'),
      onError: (err) => toast.error(err.message),
    }
  )

  return (
    <>
      {error && <p>{error.message}</p>}
      <button onClick={run} disabled={loading}>
        {loading ? 'Processing...' : 'Place order'}
      </button>
    </>
  )
}
```

### Data fetching with deps

```tsx
function ProductList({ categoryId }: { categoryId: string }) {
  const { data, loading } = usePipeline(
    () => pipeline({ categoryId }).through([fetchProducts, sortByRating]),
    { immediate: true, auto: true, watch: [categoryId] }
  )

  if (loading) return <Spinner />
  return <ul>{data?.map((p) => <li key={p.id}>{p.name}</li>)}</ul>
}
```

### Reset on modal close

```tsx
function SearchModal({ open }: { open: boolean }) {
  const { data, loading, run, reset } = usePipeline(
    () => pipeline(query).through([searchProducts])
  )

  useEffect(() => {
    if (!open) reset()
  }, [open])

  return <SearchUI onSearch={run} results={data} loading={loading} />
}
```

### Using the abort signal in a step

The hook injects `signal` into the pipeline context automatically.

```ts
import type { Step } from '@ludoows/tubby'

const fetchData: Step<{ url: string }, { signal: AbortSignal }> = {
  name: 'fetchData',
  async handle(payload, next, ctx) {
    const res = await fetch(payload.url, { signal: ctx.signal })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return next({ ...payload, data: await res.json() })
  },
}
```

---

## Types

```ts
import type {
  PipelineFactory,
  UsePipelineOptions,
  UsePipelineResult,
  PipelineState,
} from '@ludoows/tubby-react'
```

```ts
type PipelineFactory<TPayload> = () => PipelineBuilder<TPayload, Record<string, unknown>>

interface UsePipelineOptions<TPayload> {
  immediate?: boolean
  auto?: boolean
  watch?: unknown[]
  onSuccess?: (data: TPayload) => void
  onError?: (error: Error) => void
  onCancel?: () => void
}

interface UsePipelineResult<TPayload> {
  data: TPayload | null
  loading: boolean
  error: Error | null
  run: () => void
  reset: () => void
}
```
