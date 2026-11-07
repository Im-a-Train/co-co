## What and why

<!-- One or two sentences. Link the issue / spec section if there is one. -->

## How it was verified

- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build:vite -w apps/desktop`
- [ ] `cargo test --workspace` + `cargo clippy --workspace --all-targets -- -D warnings` (if Rust changed)
- [ ] `npm run test:ui -w apps/desktop` and screenshots checked (if UI changed)
- [ ] Tried in the running app (`npm run dev`) – describe what you clicked:

## Checklist

- [ ] No secrets, credentials or personal data in code, fixtures or logs
- [ ] New UI strings are in `src/locales/de/*.json`
- [ ] New Tauri command: `build.rs`, capabilities, `lib/tauri.ts`, `docs/contracts/commands.md`
- [ ] Docs updated (ADR / architecture / contracts / spec status) where behaviour changed
