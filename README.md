# Tubby

Pipeline orchestrator for TypeScript — lightweight, expressive, fully typed.

---

## Packages

| Package | Description |
|---|---|
| [`@ludoows/tubby`](packages/tubby) | Core pipeline engine — works anywhere TypeScript runs |
| [`@ludoows/tubby-react`](packages/tubby-react) | React hook (`usePipeline`) with loading/error state and cancellation |

---

## Contributing

```sh
git clone https://github.com/Ludows/tubby
cd tubby && npm install
npm run build
npm test
```

npm workspaces handles all packages at once from the root.

- Keep it minimal. Every addition has a cost.
- New utilities belong in `packages/tubby/src/utils/` and should follow the existing pattern.
- PRs should include tests and update the relevant doc if behavior changes.

Open an issue first if you're planning something significant.
