---
description: Run all co-co checks (typecheck, tests, build, Rust tests, clippy) and report the results
---

Run these from the repository root, in order, and report each result (pass/fail with the relevant
error lines). Do not stop at the first failure; run all steps, then summarise.

1. `npm run typecheck`
2. `npm test`
3. `npm run build:vite -w apps/desktop`
4. In `apps/desktop/src-tauri` (with `export PATH="$HOME/.cargo/bin:$PATH"` if cargo is not found):
   `cargo test --workspace` and `cargo clippy --workspace --all-targets -- -D warnings`
5. If files under `apps/desktop/src/views`, `components` or `layouts` changed: `npm run test:ui -w apps/desktop`,
   then open the screenshots it lists and check them. Afterwards make sure no Vite server is left on port 1420.

$ARGUMENTS
