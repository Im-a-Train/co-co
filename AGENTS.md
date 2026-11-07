# AGENTS.md

Instructions for coding agents live in **[CLAUDE.md](CLAUDE.md)**; read it first. It covers the project
summary, layout, commands, the rules that must not be broken (network only via Rust, secrets, AI gateway,
data zones, rule confidence, i18n, Dexie schema versions) and the git workflow.

Quick start:

```bash
npm install
npm run typecheck && npm test && npm run build:vite -w apps/desktop
cd apps/desktop/src-tauri && cargo test --workspace && cargo clippy --workspace --all-targets -- -D warnings
```

Further reading: `docs/architecture.md` (module map), `docs/contracts/` (Tauri commands, eCamp API),
`docs/adr/` (decisions), `CONTRIBUTING.md` (how to add rules, commands, locale keys).
