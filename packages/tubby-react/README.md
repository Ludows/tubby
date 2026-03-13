# @ludoows/tubby-react

React integration for [Tubby](https://github.com/Ludows/tubby) — a single hook that wraps any pipeline with `data`, `loading`, and `error` state.

```sh
npm install @ludoows/tubby @ludoows/tubby-react
```

---

## Usage

```tsx
import { usePipeline } from '@ludoows/tubby-react'
import { pipeline } from '@ludoows/tubby'

const { data, loading, error, run } = usePipeline(
  () => pipeline(query).through([fetchResults, formatResults]),
  { immediate: true, auto: true, watch: [query] }
)
```

---

## Modes

| Option | Behavior |
|---|---|
| `immediate: true` | Run once on mount |
| `auto: true, watch: [deps]` | Re-run when deps change |
| _(none)_ | Manual trigger via `run()` |

Requests are cancelled on unmount and on re-run.

---

## CDN

```html
<script src="https://cdn.jsdelivr.net/npm/react/umd/react.production.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/react-dom/umd/react-dom.production.min.js"></script>
<!-- development -->
<script src="https://cdn.jsdelivr.net/npm/@ludoows/tubby/dist/index.global.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@ludoows/tubby-react/dist/index.global.js"></script>
<!-- production (minified) -->
<script src="https://cdn.jsdelivr.net/npm/@ludoows/tubby/dist/index.global.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@ludoows/tubby-react/dist/index.global.min.js"></script>
<script>
  const { usePipeline } = TubbyReact
</script>
```

---

## Return value

```ts
{
  data: T | null
  loading: boolean
  error: Error | null
  run: () => void
}
```

---

## Documentation

→ [Getting started](https://github.com/Ludows/tubby/blob/main/packages/tubby-react/docs/README.md) · [Full API](https://github.com/Ludows/tubby/blob/main/packages/tubby-react/docs/api.md)
