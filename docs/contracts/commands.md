# Tauri command contract (M1–M5)

Status: **frozen** (architect). The Rust builder implements these commands in `apps/desktop/src-tauri`.
The frontend uses the typed wrappers in `apps/desktop/src/lib/tauri.ts` (`commands.*`, `onDocsChanged`,
`onDocsDropped`). The one exception is `ai_complete`, which is wrapped in `apps/desktop/src/lib/tauriAi.ts`
and may only be imported by `src/domain/zones/aiGateway.ts`. A vitest guard enforces this.

General rules

- Arguments: JS passes camelCase keys. Tauri maps them to snake_case Rust parameters
  (`campIri` → `camp_iri`). Return structs use `#[serde(rename_all = "camelCase")]`.
- Errors: reject with a German, user-readable message string, as the M0 `AppError` does.
  Never put cookie or token values, API keys or file contents in errors or logs.
- Every new command needs:
  - an entry in `build.rs` `COMMANDS`;
  - an `allow-<name>` grant in `capabilities/default.json` (window `main` only).

  The remote `ecamp-login` window keeps **no** IPC access.
- All eCamp HTTP goes through the existing reqwest client and cookie jar. The base URL is the session
  instance's. Paths are validated the same way as `api_get` (relative `/api/...`, no host, no `..`).

## M0 (unchanged)

`discover_instance`, `open_login_window`, `password_login`, `session_status`, `refresh_session`,
`api_get`, `logout`. See `docs/m0-spike-protocol.md`.

## M2: eCamp comments (the only write access)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `api_post_comment` | `campIri: string`, `activityIri: string`, `textHtml: string` | created comment (HAL JSON object) | `POST /api/comments` only. Body `{ camp, activity, textHtml }`, `Content-Type: application/json`, `Accept: application/hal+json`. Rejects when `textHtml` > 1024 chars or empty, or when it contains HTML other than `<br>` (text must be escaped by the caller). Both IRIs must match `^/api/(camps\|activities)/[A-Za-z0-9]+$`. |
| `api_patch_comment` | `commentIri: string`, `patch: object` | updated comment (HAL JSON) | `PATCH /api/comments/{id}` only, `Content-Type: application/merge-patch+json`. `commentIri` must match `^/api/comments/[A-Za-z0-9]+$`. The upstream `Comment.php` has **no** Patch operation, but newer instances do (dev has `resolvedAt`/`resolvedBy`). So an HTTP 405/404 rejects with a clear message ("Kommentar kann auf dieser eCamp-Version nicht geändert werden"), and the frontend treats it as unsupported. Only the key `resolved` is forwarded; any other key is rejected. |

## M3: files and documents

Allowed-path scope: a set of absolute, canonicalised paths persisted as JSON in the app data dir
(`app_data_dir()/allowed-paths.json`), loaded at start-up. Entries:

- files returned by `pick_files`;
- files received via drag-and-drop;
- folders returned by `pick_folder`, or passed to `watch_folder`, together with everything below them.

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `pick_files` | `filters: { name: string, extensions: string[] }[] \| null` | `string[]` (absolute paths, empty when cancelled) | Native open dialog, multi-select. Adds the files to the scope. |
| `pick_folder` | – | `string \| null` | Native folder dialog. Adds the folder to the scope. |
| `read_document` | `path: string` | `{ path, name, size, modifiedMs, bytesBase64 }` | Only for allowed paths (canonicalise first, so symlinks or `..` cannot escape). Max **25 MB**, else rejects. `modifiedMs` is ms since epoch. |
| `list_folder` | `path: string` | `{ path, name, isDir, size, modifiedMs }[]` | Allowed folders only, non-recursive. Hidden files are skipped. |
| `watch_folder` | `path: string` | `void` | Allowed folder. Adds it to the scope and persists it, recursive watch (`notify` crate, debounced ≈ 500 ms). Emits `docs://changed`. |
| `unwatch_folder` | `path: string` | `void` | Stops the watch. The folder stays readable for the session but is not persisted. |

Events

- `docs://changed` payload `{ folder: string, path: string, kind: 'create' | 'modify' | 'remove' }`
- `docs://dropped` payload `{ paths: string[] }`. Rust listens to the main window's native drag-drop
  (`WindowEvent::DragDrop(Drop)`), adds the dropped files to the scope and then emits. Folders dropped
  are added as allowed folders, and their path is included.

The frontend re-watches persisted folders from IndexedDB (`watchedFolders`) at start-up by calling
`watch_folder` again. Rust may also restore watches itself; calling it twice must be idempotent.

## M4: backup files

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `save_text_file` | `defaultName: string`, `content: string` | `string \| null` | Native save dialog, filter `JSON (*.json)`. Writes UTF-8 and returns the path. `null` when cancelled. |
| `open_text_file` | – | `{ name, content } \| null` | Native open dialog, filter `JSON (*.json)`, max 100 MB. `null` when cancelled. Does **not** add the file to the document scope. |

## M5: AI (optional, off by default)

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `ai_set_key` | `key: string` | `void` | Stores the Anthropic API key in the OS keychain (`keyring` crate, service `ch.imatrain.coco`, user `anthropic-api-key`). Never logged or returned. |
| `ai_has_key` | – | `boolean` | |
| `ai_clear_key` | – | `void` | Idempotent. |
| `ai_complete` | `request: { model, system, prompt, maxTokens }` | `{ text, inputTokens, outputTokens }` | `POST https://api.anthropic.com/v1/messages` with headers `x-api-key` (from the keychain), `anthropic-version: 2023-06-01`, body `{ model, max_tokens, system, messages:[{role:'user',content:prompt}] }`. `model` must be one of `claude-sonnet-5-5`, `claude-opus-5-5`, `claude-haiku-5-5`, `maxTokens` ≤ 4096. Rejects with "Kein API-Schlüssel hinterlegt" when no key is stored. Uses its own reqwest client **without** the eCamp cookie jar. Logs only model and token counts. |

CSP: `connect-src` does **not** need `api.anthropic.com`, because the call happens in Rust. pdf.js
loads its worker from a same-origin asset (`script-src 'self'` covers it). If pdf.js needs WASM
decoders, add `'wasm-unsafe-eval'` to `script-src` (Rust builder owns `tauri.conf.json`).
