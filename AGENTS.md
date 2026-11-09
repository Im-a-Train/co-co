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

## MCP tools

co-co runs a local MCP server (ADR 0012, `domain/mcp/`) so an external AI client can read a camp and, with the
coach's explicit consent, write drafts. Read tools are on by default, write tools are off and need a confirmation
dialog in co-co. Data zones: an MCP client is an external AI, so handlers never return MiData/NDS (red) data, redact
every camp text (collaborator names become "Leiter A", e-mail/phone/address are removed), never return file paths,
and documents only when `aiAllowed`. The dispatcher additionally runs every result through `assertMcpSendable()`.
Every `campId` accepts the short id or the IRI.

| Tool | Kind | Purpose | Zone notes |
| --- | --- | --- | --- |
| `list_camps` | read | List camps (Lager auflisten) | Camp metadata only. |
| `get_camp_overview` | read | Camp overview (Lager-Übersicht) | Redacted; no MiData/NDS. |
| `list_activities` | read | List activities (Programm auflisten) | Titles/texts redacted (collaborator names pseudonymised, e-mail/phone/address removed). |
| `get_activity` | read | Get activity (Aktivität lesen) | Texts redacted; findings without MiData/NDS. |
| `list_findings` | read | List findings (Befunde auflisten) | Rule findings only (no AI findings), red-derived stripped, texts redacted. |
| `get_rule_catalog` | read | Rule catalogue (Regelkatalog lesen) | Green (public rule texts). Includes `kind`, optional `kind`/`module` filter. |
| `list_deadlines` | read | List deadlines (Fristen auflisten) | Dates and sources only. |
| `list_feedback` | read | List feedback (Feedback lesen) | Redacted; red-derived items are filtered out. |
| `list_rounds` | read | List review rounds (Prüfrunden lesen) | Notes redacted. |
| `list_resources` | read | List resources (Hilfsmittel auflisten) | Green (public Hilfsmittel). |
| `search_resources` | read | Search resources (Hilfsmittel durchsuchen) | Green (public Hilfsmittel). |
| `get_resource` | read | Get resource (Hilfsmittel lesen) | Green, paged (max 20000 chars). |
| `list_manual_findings` | read | List manual findings (Eigene Befunde auflisten) | Comments redacted; comments quoting MiData/NDS are dropped. |
| `get_feedback_structure` | read | Feedback structure (Feedback-Struktur lesen) | Redacted; red-derived items filtered like `list_feedback`. |
| `list_general_feedback_points` | read | List general feedback points (Allgemeine Feedback-Punkte auflisten) | Static German reference text plus used state. |
| `get_camp_progress` | read | Camp review progress (Prüffortschritt lesen) | Counts and German labels only. |
| `list_documents` | read | List documents (Dokumente auflisten) | Metadata only: never the file path, never red-zone documents, names redacted. |
| `get_document_text` | read | Get document text (Dokumenttext lesen) | Only if the document is `aiAllowed`; redacted, paged (max 20000 chars); never red zone. |
| `get_review_guidance` | read | Get review guidance (Prüf-Leitfaden lesen) | Green (public rule texts); modules off and disabled rules are left out. |
| `add_manual_finding` | write | Add manual finding (Eigenen Befund hinzufügen) | Text de-redacted locally; MiData/NDS markers refused; anchor needs a document of the camp. |
| `update_manual_finding` | write | Update manual finding (Eigenen Befund ändern) | Text de-redacted locally; MiData/NDS markers refused. |
| `delete_manual_finding` | write | Delete manual finding (Eigenen Befund löschen) | Irreversible; confirmation shows the finding. |
| `add_feedback` | write | Add feedback draft (Feedback-Entwurf hinzufügen) | Text de-redacted locally; `documentId`/`generalPointId`/`manualFindingId` are validated against the camp. |
| `update_feedback` | write | Update feedback draft (Feedback-Entwurf ändern) | Drafts only; same link validation as `add_feedback`. |
| `ignore_finding` | write | Ignore finding (Befund ignorieren) | Reason de-redacted locally. |
| `set_review_status` | write | Set review status (Prüfstatus setzen) | Allowed transitions only. |
| `post_feedback_comment` | write | Post feedback as eCamp comment (Feedback als eCamp-Kommentar posten) | The only eCamp write (comment, max 1024 chars per part); activity drafts only. |
| `update_resource` | write | Update resource (Hilfsmittel ändern) | Marked as made via MCP. |
| `update_rule` | write | Update rule (Regel anpassen) | MCP cannot set severity `must` or confidence `verified`; reason required. |

**Maintenance rule:** Every change to `domain/mcp/catalog.ts` (new tool, renamed tool, changed arguments or output)
updates this table, `locales/de/mcpTools.json`, the handler tests and the counts in `e2e-ui/mcp-flows.mjs` in the same
change. `src/__tests__/contracts/agentsMdMcp.test.ts` fails when a tool from `MCP_TOOLS` is missing from this table.
