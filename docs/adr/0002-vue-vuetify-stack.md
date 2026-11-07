# ADR 0002: Vue 3 + Vuetify 3 + vue-i18n frontend

- Status: accepted
- Date: 2026-11-07

## Context

The frontend runs in the Tauri webview. It needs:

- forms, cards, lists and dialogs with little design effort;
- a German UI, with French and Italian later, because J+S is national;
- TypeScript and fast tests.

eCamp v3 itself uses Vue + Vuetify. Matching that stack helps in two ways:

- the look feels familiar to coaches;
- eCamp contributors could later help with co-co.

## Decision

- **Vue 3** (Composition API, `<script setup lang="ts">`) with **TypeScript ~5.9**.
  - Not TS 7: `vue-tsc` needs the TypeScript JS API.
- **Vuetify 3**, pinned to `~3.13`.
  - npm `latest` is Vuetify 4. We do not take that major yet.
- Material Design Icons via `@mdi/font`, bundled locally (no CDN, because of the CSP).
- **vue-i18n 11** with German (`de`) as the default locale.
  - All UI strings live in `src/locales/de.json`. No hard-coded UI text.
  - The default JIT message compilation works without `unsafe-eval`, which suits our strict CSP.
- **Vite 8** as the bundler and **Vitest** for unit tests of pure helpers:
  - JWT payload decode;
  - refresh scheduling;
  - report generation.
- **npm workspaces** (root `package.json`, app in `apps/desktop`). No pnpm or yarn.

## Consequences

- Vuetify injects `<style>` tags at runtime for theming. The CSP therefore allows
  `style-src 'unsafe-inline'`, and Tauri's nonce injection for `style-src` is disabled
  (`dangerousDisableAssetCspModification: ["style-src"]`). Scripts stay `'self'` only.
- Moving to Vuetify 4 later is a separate decision.
- The frontend has no network access of its own (`connect-src` is limited to Tauri IPC). All data
  comes through Tauri commands, which keeps the frontend easy to test with mocks.
- In a plain browser (Vite dev server without Tauri), the app shows "Nur in der Desktop-App verfügbar"
  instead of failing.
