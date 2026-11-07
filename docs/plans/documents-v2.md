# Documents v2: camp folder, recursive scan, PDF preview, usability

Status: **plan, not implemented**. Maintainer's request: "i would like to add one folder, search the sub
folders. make a pdf preview + make it more usable".
All paths are relative to `apps/desktop/` unless noted. Line references are as of `feat/next-features`.

## 1. Current state

**Folders and scope**
- `pick_folder` adds the canonical folder to the persisted `PathScope` (`src-tauri/src/files.rs:187-194`).
  `PathScope::contains` is a prefix check, so everything below the folder is readable
  (`crates/coco-core/src/scope.rs:40-42`).
- `reject_unsafe_grant` blocks UNC paths, drive roots and the home folder (`files.rs:110-131`). It only runs
  for dropped paths (`allow_path`, `files.rs:70-78`); `pick_folder` and `watch_folder` skip it.
- Each camp can have any number of `WatchedFolder { id, campIri, path, addedAt }` rows. The Dexie index is
  `&path` (globally unique, `src/domain/storage/db.ts`), so one folder cannot belong to two camps.

**Watching and scanning (the main gap)**
- The Rust watcher is recursive (`files.rs:388`), but the initial scan and «Neu einlesen» are not:
  `scanFolder` uses `list_folder` (`src/composables/useDocuments.ts:128-136`), which reads one level only
  (`files.rs:303-329`). Files in subfolders only show up after they change on disk. **This is why
  "search the sub folders" does not work today.**
- No depth, file-count or ignore limits. Hidden checks only look at the last path component
  (`files.rs:146-158`), so `node_modules/x/README.md` or `.obsidian/notes.md` is ingested when it changes.
- The event-to-folder match uses `e.path.startsWith(f.path)` without a separator
  (`useDocuments.ts:215`): `C:\Lager` also matches `C:\Lager2\...` (bug).
- `rescan` never removes records for files deleted while the app was closed (`useDocuments.ts:168-176`);
  a rename is remove + create, so confirmed activity links are lost (`:218-221`).
- Missed notify events (overflow, `Rescan` flag) are dropped silently (`files.rs:366-378`).
- Allowed types: `pdf`, `docx`, `gpx`, `txt`, `md`, `markdown` (`files.rs:133`); 25 MB cap (`coco-core/src/docs.rs:5`).

**Ingest**
- Every scan reads every file in full as base64 JSON (`files.rs:274-301`) before comparing the SHA-256
  (`src/domain/documents/ingest.ts:46-49`); size + mtime are not used as a shortcut.
- Sequential processing; text-item loop, mammoth and hashing run on the main thread
  (`src/domain/documents/extract.ts:26-62`). Only an indeterminate progress bar.
- PDF pages are joined with `\n\n` (`extract.ts:49-51`): page boundaries are lost, so a hit cannot point to a page.

**Search**
- MiniSearch over name + text and eCamp activity texts, max 50 hits (`src/domain/documents/index.ts:431-474`).
- One snippet per hit, no highlighting, no page, no folder (`index.ts:416-429`).
- Results sit above the document list and do not filter it (`DocumentSearch.vue`). Clicking an activity
  hit selects the first linked document or nothing (`DocumentsView.vue:45-48`).

**Preview**
- None. The detail card shows the first 1500 characters of extracted text in a 200 px `<pre>`
  (`DocumentDetail.vue:65-68`).
- pdfjs-dist is already bundled (lazy, Vite `?url` worker, `extract.ts:8-15`) and ships `TextLayer`,
  `cmaps/`, `standard_fonts/`, `wasm/`.
- CSP: `script-src 'self'`, `img-src` allows `blob:`, `connect-src` is `ipc:` only, no `wasm-unsafe-eval`
  (`src-tauri/tauri.conf.json:24-35`).

**List and layout**
- Big drop-zone card on top; below a two-column row with an unpaged `v-list lines="three"` + «Überwachte
  Ordner» left and the detail right (`DocumentsView.vue:63-129`).
- No filters, sorting, folder grouping or relative paths; links confirmed one by one; no «open in OS», no
  re-extract, no keyboard navigation; ingest errors joined into one alert (`useDocuments.ts:115`).

**Backup**
- `documents` and `watchedFolders` are exported; import forces `aiAllowed: false`. Restored folder paths
  are not in the Rust scope, so `watch_folder` fails with «Pfad ist nicht freigegeben» and there is no
  recovery UI.

## 2. Target design

### (a) One root folder per camp, scanned recursively

**Recommendation: one «Lagerordner» per camp** (not a global root with camp subfolders): `WatchedFolder`
is already per camp, coaches keep material per camp (often OneDrive/Google Drive), and a global root
needs a name-to-camp mapping that breaks on rename. Existing extra folders stay valid as `role: 'extra'`;
the UI pushes one root.

- **Scan (Rust, new `scan_folder`).** Walk with `symlink_metadata`; never follow symlinks or junctions
  (Windows reparse-point attribute `0x400`).
- **Ignore rules** (pure, `coco-core::scan`): names starting with `.` and the Windows hidden/system
  attribute; `node_modules`, `$RECYCLE.BIN`, `System Volume Information`, `__MACOSX`, `AppData`, `.git`;
  Office lock files `~$*`, `Thumbs.db`, `desktop.ini`; cloud-only placeholders (attributes `0x400000`
  RECALL_ON_DATA_ACCESS or `0x1000` OFFLINE) reported as `skipped.offline` and never read (reading
  triggers a download); extensions outside `DOCUMENT_EXTENSIONS`.
- **Limits:** `maxDepth` 8, `maxFiles` 2000 (`truncated: true`), files over 25 MB → `skipped.tooLarge`.
- **Output:** `{ path, relPath ('/' separators), size, modifiedMs }[]` + `skipped` counts + `truncated`.
  The UI shows «12 übersprungen: 3 zu gross, 9 nur online».
- **Watcher:** same ignore rules on every ancestor below the root (new `PathScope::root_of(p)`); notify
  `Rescan` flag and errors → new event `docs://rescan { folder }` → incremental rescan.
- **Folder tree in the UI:** pure `buildFolderTree(docs)` from `relPath`, shown with Vuetify `VTreeview`
  with count badges; selecting a node filters the list.

### (b) PDF preview in the app

- **Bytes to the webview:** new command `read_document_raw(path)` returning `tauri::ipc::Response` (raw
  binary → `ArrayBuffer`), same canonicalise / scope / extension / hidden / size checks as
  `read_document`, factored into one `checked_document_path()`. Ingest switches to it too (saves the
  +33 % base64 overhead). *Asset protocol rejected:* it needs a second glob-based scope next to
  `PathScope` plus CSP changes; two scope systems would drift apart.
- **Viewer** (`components/documents/PdfViewer.vue`): thin component on the pdfjs core API (not the heavy
  `PDFViewer`). One canvas per page, rendered lazily with `IntersectionObserver` (visible ±1 page);
  `TextLayer` for selection and highlight marks. Toolbar: page `n / N`, previous/next, zoom (fit width,
  fit page, 50–300 %), in-document search (Ctrl+F) with previous/next match. Keys PgUp/PgDn, Home/End,
  `+`/`-`. Load options `isEvalSupported: false`, `enableXfa: false`; `standardFontDataUrl`, `cMapUrl`,
  `wasmUrl` as Vite-bundled `'self'` URLs. **CSP delta:** add `'self'` to `connect-src` (local bundle
  only, the network rule is unchanged); `'wasm-unsafe-eval'` only if the P0 spike shows JPX/ICC images
  render blank otherwise. Destroy the loading task on switch; cache only the last document.
- **Jump to a hit:** extraction stores `pageStarts: number[]`; pure `pageForOffset()` maps snippet
  offsets to pages. Search hits carry `page` and open the viewer there with terms highlighted. Deep links
  `?doc=<id>&page=<n>&q=<terms>` also from `ActivityDrawer` and findings.
- **Other types:** DOCX/TXT/MD get a full scrollable text preview (no 1500-char cut, `<mark>` from split
  segments, no `v-html`). GPX keeps `GpxCard`. Scanned PDFs show rendered pages + «Kein Text gefunden».

### (c) Usability

- **Layout (wide):** compact toolbar replaces the drop card («Lagerordner wählen/ändern», «Dateien
  hinzufügen», «Neu einlesen», progress «37 / 140»). Three panes: folder tree (collapsible), document
  table (`v-data-table-virtual`: Name, Ordner, Typ, Verknüpfung, Sicherheit, Geändert), detail with tabs
  **Vorschau | Infos & Verknüpfungen | Sicherheitscheck | KI**. Narrow: tree in a drawer, detail as a
  full-height dialog.
- **Drag and drop:** full-window overlay; dropping a folder offers «Als Lagerordner setzen» or «Nur
  einmal einlesen».
- **Filters** (kept in the query string): kind, linked / unlinked / has suggestions, safety-relevant,
  error / missing, folder. **Sorting:** name, folder, modified, imported, size.
- **Search:** one field that filters the table in place, ranked by score; rows expand to up to 3
  snippets with an «S. n» chip; activity hits in their own collapsible group; `relPath` indexed with
  boost 1.5 so folder names like «Sicherheit» count.
- **Bulk actions:** checkboxes → «Mit Aktivität verknüpfen…», «Vorschläge bestätigen», «Entfernen»,
  «Neu extrahieren».
- **Per document:** «Im Standardprogramm öffnen», «Im Ordner zeigen», «Neu extrahieren».
- **Empty / error states:** no camp folder (call-to-action), folder missing (drive/cloud offline, «Neu
  wählen»), not authorised after backup import («Zugriff erneut erlauben»), scan truncated, per-file
  errors as badges + collapsible list.
- **Missing files:** badge «fehlt», links kept; reattached automatically when a file with the same
  `contentHash` appears (rename/move), otherwise removed by hand.
- **Keyboard:** ↑/↓ in the table, Enter opens the preview, `/` focuses search, Space selects.

## 3. Data model, commands, security, performance

**Dexie v5** (v4 is taken by `selfChecks`; never edit existing versions):
- `documents: 'id, campIri, path, contentHash, folder, [campIri+path], [campIri+folder]'`
- `watchedFolders: 'id, campIri, path, [campIri+path]'` — drops the global `&path` uniqueness (Q2).
- `DocumentRecord` + `relPath: string | null`, `pageStarts: number[] | null`, `pageCount: number | null`,
  `extractVersion: number` (current 2; older rows re-extracted lazily), `missingSince: IsoDateTime | null`.
- `WatchedFolder` + `role: 'root' | 'extra'`, `lastScanAt`, `lastScan: { files; skipped; truncated } | null`.
- Upgrade via pure `migrateDocumentV5(row)` / `migrateFoldersV5(rows)` (relPath from folder + path; oldest
  folder per camp becomes root; defaults). The same normaliser runs on backup import so old exports stay
  valid. No new table → `TABLE_NAMES` unchanged. Add a backup round-trip test for the new fields.

**Tauri commands** (each: Rust command → `build.rs` `COMMANDS` → `allow-<name>` in
`capabilities/default.json` (main only) → `src/lib/tauri.ts` → `docs/contracts/commands.md` → coco-core
tests → `src/dev/mockTauri.ts` case):

| Command | Args | Returns | Notes |
| --- | --- | --- | --- |
| `scan_folder` | `path` | `{ entries[], skipped, truncated }` | Scope-checked, rejects symlinked roots, rules from `coco-core::scan` |
| `read_document_raw` | `path` | `ArrayBuffer` (`ipc::Response`) | Same checks as `read_document`; ingest + preview |
| `open_document` | `path` | `void` | Opener from Rust; scope + `DOCUMENT_EXTENSIONS` only, so `.exe`/`.lnk`/`.url` can never launch; no opener permission in the frontend |
| `reveal_document` | `path` | `void` | `reveal_item_in_dir`, same checks |
| event `docs://rescan` | `{ folder }` | – | Watcher overflow or error |

`list_folder` stays for drop detection; `read_document` stays until all callers moved, then deprecated.

**Security:** canonicalise before every scope check (already the case); the scan never follows links, so
a junction to `C:\Users\x` cannot widen access; `reject_unsafe_grant` also in `pick_folder` and
`watch_folder`, plus a warning/refusal for broad folders (Desktop, Documents root — Q4); the
hidden/protected/ignore check covers every component below the scope root (for `read_document*`,
watcher and scan). Rust tests: `..` traversal, symlink/junction pointing outside, hidden ancestor,
sibling-prefix (`/docs` vs `/docs2`), extension allow-list for `open_document`. Documents stay **yellow**;
preview is local only; `aiGateway` unchanged.

**Performance:** incremental rescan via pure `planRescan(records, entries) → { read, unchanged, missing,
moved }` keyed by `path`, compared on `size` + `modifiedMs`; only `read` files are fetched; `moved`
resolved by `contentHash`. Extraction in a module worker (`documents/extract.worker.ts`, Vite `?worker`,
CSP `'self'` suffices): hashing, PDF text with `pageStarts`, DOCX; concurrency 2, progress, cancel on
unmount. `bulkPut` per 20 files; rebuild the search index per batch. Target: 1000 files with 50 changed
rescanned in < 5 s on the second run.

## 4. Phases (small PRs)

**P0 – Spike.** Render one PDF from `read_document_raw` in the production build (`tauri build
--no-bundle`) under the real CSP: worker, standard fonts, a CJK/CMap PDF, a JPX image.
*Accept:* CSP deltas known and recorded here; `grep -r mockIPC dist` empty.

**P1 – Rust: recursive scan + hardening.** `coco-core::scan`, `PathScope::root_of`, component-wise hidden
check, `scan_folder`, `read_document_raw`, `open_document`, `reveal_document`, watcher filtering +
`docs://rescan`, `reject_unsafe_grant` on pick/watch.
*Tests:* temp-dir trees (depth-9 cut-off, `node_modules` skipped, `.hidden/` ancestor skipped, `~$x.docx`
skipped, truncation, symlink not followed on unix, junction not followed on Windows, `open_document`
refusing `.exe` and out-of-scope paths). Clippy clean; contract + mock updated.

**P2 – Domain + data: one camp folder, incremental ingest.** Dexie v5 + migrations, `planRescan`,
`isUnder(path, folder)` (fixes the prefix bug), `buildFolderTree`, `pageForOffset`, `pageStarts` in
extraction, missing/moved handling, root-folder flow in `useDocuments`, re-authorisation state after import.
*Tests:* migrations, `planRescan` (new/changed/unchanged/missing/renamed with links kept), `isUnder`
(`C:\Lager` vs `C:\Lager2`, mixed separators), tree building, page mapping, backup round-trip.
*Accept:* a folder with 3 levels ingests all supported files; a second rescan reads 0 unchanged files.

**P3 – PDF preview + search jump.** `PdfViewer.vue`, full text preview for other kinds, `SearchHit.page`
+ multiple snippets with term segments, deep links `?doc&page&q` (incl. `ActivityDrawer`).
*Tests:* snippet/page builder and highlight segmenting; UI harness with a 2-page invented fixture PDF,
shots `flow-documents-preview`, `flow-documents-search-jump`.

**P4 – Usability layout.** Toolbar, three panes, filters + sort in the query string, bulk-link dialog,
re-extract, open/reveal, empty/error/missing/truncated states, keyboard, drag overlay; strings in
`locales/de/documents.json`.
*Tests:* harness shots for the empty state, tree + table with a nested mock `scan_folder` tree, bulk-link
dialog, narrow layout without horizontal overflow.

**P5 – Performance.** Extraction worker, batching, progress, cancel; vitest for the worker message
protocol; manual check against a 1000-file folder with timings in the PR.

Every PR: typecheck, `npm test`, `build:vite`, cargo test + clippy, `test:ui` on a free port where UI
changed; update `docs/architecture.md`, `docs/contracts/commands.md` and the spec artifact.

## 5. Open questions for the maintainer

1. Per-camp root (recommended) OK, or one global «co-co» folder with a subfolder per camp matched by name?
2. May two camps share a folder (e.g. a template folder)? Decides whether `&path` uniqueness goes.
3. Limits OK (depth 8, 2000 files, 25 MB)? Skip cloud-only files (proposed) or download on demand?
4. Refuse or only warn when the camp folder is broad (Desktop, Documents, a whole OneDrive)?
5. More file types? `.pptx`, `.xlsx`, `.odt`, images (JPG/PNG preview without text).
6. Missing files: keep with «fehlt» until removed by hand (proposed), or delete after N days?
7. OCR for scanned PDFs later? (Local, e.g. Tesseract via Rust; needs its own ADR.)
8. CSP changes acceptable: `connect-src 'self'`, possibly `'wasm-unsafe-eval'`?
