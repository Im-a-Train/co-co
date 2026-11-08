# Documentation

| Document | What it is for |
| --- | --- |
| [architecture.md](architecture.md) | Module map, storage, key flows, Rust side – start here |
| [adr/](adr/) | Architecture decision records (Tauri, Vue/Vuetify, login via webview cookies, no backend, data zones + AI, [0011](adr/0011-openai-compatible-and-mcp.md) OpenAI-compatible/local AI + local MCP server) |
| [contracts/commands.md](contracts/commands.md) | Contract of every Tauri command and event (args, returns, security rules) |
| [contracts/ecamp-api.md](contracts/ecamp-api.md) | Verified facts about the eCamp v3 API (filters, HAL, times, auth) |
| [spec/co-co-spec.html](spec/co-co-spec.html) | Product spec + status page incl. rule set, feature status and the MiData design (published as a Claude artifact) |
| [m0-spike-protocol.md](m0-spike-protocol.md) | Manual test plan of the M0 login spike (historical; still useful for testing login on macOS/Linux) |

Write a new ADR (`adr/NNNN-title.md`) for decisions that are hard to reverse: new external system,
new write access to eCamp, new data zone rules, storage changes.
