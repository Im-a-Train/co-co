//! Pure logic of co-co's local MCP server (ADR 0011): HTTP request-head checks (loopback Host/Origin,
//! bearer token, method/path, size), JSON-RPC 2.0 message handling for the MCP "Streamable HTTP"
//! transport (JSON responses only, no SSE), protocol-version negotiation, tool registration
//! validation and token formatting. No sockets, no randomness, no Tauri: `src-tauri/src/mcp.rs` does I/O.
//!
//! Security: the token never appears in errors, `Debug` output of request heads or logs.

use std::net::Ipv4Addr;
use std::str::FromStr;

use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use url::Url;

use crate::CoreError;

pub const DEFAULT_PORT: u16 = 41731;
pub const MIN_PORT: u16 = 1024;
pub const MCP_PATH: &str = "/mcp";
/// Newest first. An unknown requested version is answered with LATEST_PROTOCOL_VERSION.
pub const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];
pub const LATEST_PROTOCOL_VERSION: &str = "2025-06-18";
pub const MAX_REQUEST_BYTES: usize = 1024 * 1024;
/// Max length of `ToolOutcome.text` accepted from the frontend (longer -> tool error).
pub const MAX_RESULT_CHARS: usize = 512 * 1024;
pub const MAX_TOOLS: usize = 64;
pub const TOKEN_PREFIX: &str = "coco_";
/// Keychain user (service `ai::KEY_SERVICE`) of the bearer token.
pub const TOKEN_KEY_USER: &str = "mcp-token";
pub const SERVER_NAME: &str = "co-co";
pub const SERVER_TITLE: &str = "co-co (Coach Cockpit)";
/// How long Rust waits for the frontend's `mcp_tool_result`, including the in-app confirmation. Kept below
/// the 60 s default request timeout of the MCP TypeScript SDK (Claude Desktop, mcp-remote): a longer wait
/// would let a confirmed write run after the client already reported a failure. The tool-call event carries
/// the deadline; the frontend drops the call (and its confirmation dialog) shortly before it.
pub const READ_TIMEOUT_SECS: u64 = 55;
pub const WRITE_TIMEOUT_SECS: u64 = 55;
/// Tool calls waiting for the frontend at the same time; more -> tool error «beschäftigt».
pub const MAX_IN_FLIGHT: usize = 4;
/// Entries kept in the in-memory activity log.
pub const LOG_CAPACITY: usize = 50;

/// `initialize` result `instructions` for the client's model.
pub const SERVER_INSTRUCTIONS: &str = "co-co is the desktop cockpit of a Swiss J+S / scout camp coach. \
Its tools read the coach's eCamp camps, programme, rule-check findings, deadlines, feedback and review rounds. \
Person names are pseudonymised (Leiter A, Leiter B, ...) and contact data is removed; use the pseudonyms in texts you write, \
co-co replaces them locally. Write tools only work when the coach enabled them, and the coach confirms every write in co-co. \
Answer the coach in German unless asked otherwise.";

// JSON-RPC 2.0 error codes.
pub const PARSE_ERROR: i64 = -32700;
pub const INVALID_REQUEST: i64 = -32600;
pub const METHOD_NOT_FOUND: i64 = -32601;
pub const INVALID_PARAMS: i64 = -32602;
pub const INTERNAL_ERROR: i64 = -32603;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ToolKind {
    Read,
    Write,
}

/// One enabled tool as pushed by the frontend (`mcp_set_tools`), see `src/domain/mcp/types.ts` McpToolRegistration.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolRegistration {
    pub name: String,
    pub title: String,
    pub description: String,
    pub kind: ToolKind,
    /// JSON Schema object (`{"type":"object", ...}`).
    pub input_schema: Value,
}

/// Answer of the frontend (`mcp_tool_result`), see McpToolOutcome.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutcome {
    pub text: String,
    pub is_error: bool,
}

fn valid_tool_name(name: &str) -> bool {
    let mut chars = name.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {}
        _ => return false,
    }
    name.len() <= 64 && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
}

/// Names `^[a-z][a-z0-9_]{0,63}$`, unique, at most MAX_TOOLS, `input_schema` is an object with
/// `"type":"object"`, title/description non-empty and <= 2000 chars.
pub fn validate_tools(tools: &[ToolRegistration]) -> Result<(), CoreError> {
    if tools.len() > MAX_TOOLS {
        return Err(CoreError::Invalid(format!("Zu viele Tools (maximal {MAX_TOOLS})")));
    }
    let mut seen = std::collections::HashSet::new();
    for t in tools {
        if !valid_tool_name(&t.name) {
            return Err(CoreError::Invalid(format!("Ungültiger Tool-Name: {}", t.name.chars().take(64).collect::<String>())));
        }
        if !seen.insert(t.name.as_str()) {
            return Err(CoreError::Invalid(format!("Tool-Name doppelt: {}", t.name)));
        }
        let schema_ok = t.input_schema.is_object() && t.input_schema.get("type").and_then(Value::as_str) == Some("object");
        if !schema_ok {
            return Err(CoreError::Invalid(format!("Ungültiges Eingabeschema für Tool {}", t.name)));
        }
        for (label, text) in [("Titel", &t.title), ("Beschreibung", &t.description)] {
            let n = text.trim().chars().count();
            if n == 0 || text.chars().count() > 2000 {
                return Err(CoreError::Invalid(format!("{label} von Tool {} ist leer oder zu lang", t.name)));
            }
        }
    }
    Ok(())
}

/// MIN_PORT..=65535.
pub fn validate_port(port: u16) -> Result<(), CoreError> {
    if port < MIN_PORT {
        return Err(CoreError::Invalid(format!("Port muss zwischen {MIN_PORT} und 65535 liegen")));
    }
    Ok(())
}

/// Text longer than MAX_RESULT_CHARS is replaced by an error outcome («Ergebnis zu gross»).
pub fn cap_outcome(outcome: ToolOutcome) -> ToolOutcome {
    if outcome.text.chars().count() > MAX_RESULT_CHARS {
        return ToolOutcome { text: "Ergebnis zu gross für MCP (gekürzt nicht möglich)".into(), is_error: true };
    }
    outcome
}

// ---- HTTP request head ------------------------------------------------------------------------

/// The parts of an HTTP request the checks need (header values as received). Deliberately no `Debug`
/// (holds the Authorization header).
pub struct RequestHead<'a> {
    pub method: &'a str,
    /// Request target as received (path plus optional query); the query is ignored.
    pub path: &'a str,
    pub host: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub authorization: Option<&'a str>,
    /// `MCP-Protocol-Version` header.
    pub protocol_version: Option<&'a str>,
    pub content_length: Option<usize>,
}

/// Rejection: HTTP status + short German message. The server answers with JSON `{"error": message}`
/// (401 additionally with `WWW-Authenticate: Bearer`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HttpReject {
    pub status: u16,
    pub message: &'static str,
}

fn reject(status: u16, message: &'static str) -> Result<(), HttpReject> {
    Err(HttpReject { status, message })
}

/// Checks in this order: path != MCP_PATH -> 404; Host missing or not loopback -> 403; Origin present and
/// not loopback -> 403; method != POST -> 405; bearer token mismatch -> 401; MCP-Protocol-Version present
/// and not supported -> 400; content length > MAX_REQUEST_BYTES -> 413.
pub fn check_request_head(head: &RequestHead<'_>, token: &str) -> Result<(), HttpReject> {
    let path = head.path.split('?').next().unwrap_or("");
    if path != MCP_PATH {
        return reject(404, "Nicht gefunden");
    }
    if !head.host.is_some_and(is_loopback_host_header) {
        return reject(403, "Host nicht erlaubt");
    }
    if head.origin.is_some_and(|o| !is_loopback_origin(o)) {
        return reject(403, "Origin nicht erlaubt");
    }
    if head.method != "POST" {
        return reject(405, "Methode nicht erlaubt");
    }
    if !token_matches(head.authorization, token) {
        return reject(401, "Nicht autorisiert");
    }
    if head.protocol_version.is_some_and(|v| !SUPPORTED_PROTOCOL_VERSIONS.contains(&v.trim())) {
        return reject(400, "MCP-Protokollversion nicht unterstützt");
    }
    if head.content_length.is_some_and(|n| n > MAX_REQUEST_BYTES) {
        return reject(413, "Anfrage zu gross");
    }
    Ok(())
}

fn is_loopback_hostname(host: &str) -> bool {
    if host.eq_ignore_ascii_case("localhost") {
        return true;
    }
    if host == "[::1]" {
        return true;
    }
    Ipv4Addr::from_str(host).is_ok_and(|ip| ip.is_loopback())
}

/// `127.0.0.1`, any `127.x.y.z`, `localhost`, `[::1]`, each with optional `:port`. Case-insensitive.
pub fn is_loopback_host_header(host: &str) -> bool {
    let host = host.trim();
    if host.is_empty() {
        return false;
    }
    let (name, port) = if host.starts_with('[') {
        match host.find(']') {
            Some(end) => {
                let rest = &host[end + 1..];
                match rest {
                    "" => (&host[..=end], None),
                    r if r.starts_with(':') => (&host[..=end], Some(&r[1..])),
                    _ => return false,
                }
            }
            None => return false,
        }
    } else {
        match host.split_once(':') {
            Some((n, p)) => (n, Some(p)),
            None => (host, None),
        }
    };
    if let Some(p) = port {
        if p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit()) {
            return false;
        }
    }
    is_loopback_hostname(&name.to_ascii_lowercase())
}

/// `http(s)://` + loopback host (see is_loopback_host_header) + optional port, nothing else. `null` is rejected.
pub fn is_loopback_origin(origin: &str) -> bool {
    let Ok(url) = Url::parse(origin.trim()) else { return false };
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    if !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() {
        return false;
    }
    if !matches!(url.path(), "" | "/") {
        return false;
    }
    match url.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// `Bearer <token>` (scheme case-insensitive, surrounding whitespace ignored), constant-time comparison.
/// An empty expected token never matches.
pub fn token_matches(authorization: Option<&str>, token: &str) -> bool {
    if token.is_empty() {
        return false;
    }
    let Some(auth) = authorization else { return false };
    let auth = auth.trim();
    let Some((scheme, rest)) = auth.split_once(char::is_whitespace) else { return false };
    if !scheme.eq_ignore_ascii_case("bearer") {
        return false;
    }
    constant_time_eq(rest.trim().as_bytes(), token.as_bytes())
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    let mut diff = (a.len() ^ b.len()) as u64;
    // Always iterate over the expected length so timing does not depend on where bytes differ.
    for (i, &y) in b.iter().enumerate() {
        let x = a.get(i).copied().unwrap_or(0);
        diff |= u64::from(x ^ y);
    }
    diff == 0
}

/// TOKEN_PREFIX + base64url (no padding) of 32 random bytes = 48 chars.
pub fn format_token(random: &[u8; 32]) -> String {
    format!("{TOKEN_PREFIX}{}", base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random))
}

/// Shape check of a stored token (prefix + 43 base64url chars).
pub fn is_valid_token(token: &str) -> bool {
    match token.strip_prefix(TOKEN_PREFIX) {
        Some(rest) => rest.len() == 43 && rest.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'),
        None => false,
    }
}

// ---- JSON-RPC / MCP ----------------------------------------------------------------------------

/// What the HTTP layer has to do with one POST body.
#[derive(Debug, Clone, PartialEq)]
pub enum Dispatch {
    /// Answer with this JSON-RPC message, HTTP 200, `Content-Type: application/json`.
    Reply(Value),
    /// Input the server cannot accept (parse error, invalid request object, null id, empty or too
    /// large batch): HTTP 400 with this JSON-RPC error body (Streamable HTTP transport).
    Invalid(Value),
    /// Notification or client response: HTTP 202 Accepted, empty body.
    Accepted,
    /// `notifications/cancelled` for request `request_id`: cancel the waiting call (if any), then
    /// HTTP 202 Accepted, empty body.
    Cancel { request_id: Value },
    /// `tools/call` of a registered tool: emit to the frontend, wait, then reply with
    /// `tool_result_response(&id, &outcome)`.
    CallTool { id: Value, name: String, kind: ToolKind, arguments: Value },
    /// JSON-RPC batch (protocol versions 2025-03-26 / 2024-11-05): one entry per element, never
    /// `Invalid` or `Batch` (invalid elements become `Reply` errors). The HTTP layer handles the
    /// elements in order and answers with the array of replies, or 202 Accepted when there is none.
    Batch(Vec<Dispatch>),
}

/// Max elements of one JSON-RPC batch.
pub const MAX_BATCH: usize = 32;

/// Handles one POST body:
/// - invalid JSON -> Invalid(error PARSE_ERROR, id null); empty or too large batch -> Invalid(INVALID_REQUEST);
/// - JSON array (batch) -> Batch(one entry per element, as below; Invalid elements become Reply);
/// - not an object / wrong `jsonrpc` / missing method / bad or null `id` -> Invalid(error INVALID_REQUEST);
/// - `notifications/cancelled` with a string/number `params.requestId` -> Cancel;
/// - other notifications (no `id`, e.g. `notifications/initialized`) or a response object -> Accepted;
/// - `initialize` -> Reply(initialize_result(params.protocolVersion)); `ping` -> Reply(result {});
/// - `tools/list` -> Reply(tools_list_result(tools)) (pagination cursor ignored, no nextCursor);
/// - `tools/call` -> CallTool when `params.name` is registered (arguments default `{}`, must be an
///   object), else Reply(error INVALID_PARAMS «Unknown tool: …»);
/// - anything else -> Reply(error METHOD_NOT_FOUND).
pub fn handle_message(body: &[u8], tools: &[ToolRegistration], server_version: &str) -> Dispatch {
    let msg: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return Dispatch::Invalid(jsonrpc_error(&Value::Null, PARSE_ERROR, "Parse error")),
    };
    match &msg {
        Value::Array(items) if items.is_empty() => {
            Dispatch::Invalid(jsonrpc_error(&Value::Null, INVALID_REQUEST, "Invalid Request"))
        }
        Value::Array(items) if items.len() > MAX_BATCH => {
            Dispatch::Invalid(jsonrpc_error(&Value::Null, INVALID_REQUEST, "Batch zu gross"))
        }
        Value::Array(items) => Dispatch::Batch(
            items
                .iter()
                .map(|m| match handle_value(m, tools, server_version) {
                    Dispatch::Invalid(v) => Dispatch::Reply(v),
                    d => d,
                })
                .collect(),
        ),
        single => handle_value(single, tools, server_version),
    }
}

/// One JSON-RPC message (an array here, i.e. a nested batch, is an invalid request).
fn handle_value(msg: &Value, tools: &[ToolRegistration], server_version: &str) -> Dispatch {
    let null = Value::Null;
    let invalid = |id: &Value, message: &str| Dispatch::Invalid(jsonrpc_error(id, INVALID_REQUEST, message));
    let Some(obj) = msg.as_object() else {
        return invalid(&null, "Invalid Request");
    };
    let id_value = obj.get("id");
    let reply_id = match id_value {
        Some(v @ (Value::String(_) | Value::Number(_))) => v.clone(),
        _ => null.clone(),
    };
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return invalid(&reply_id, "Invalid Request");
    }
    let method = match obj.get("method") {
        Some(Value::String(m)) => m.as_str(),
        Some(_) => return invalid(&reply_id, "Invalid Request"),
        None => {
            if obj.contains_key("result") || obj.contains_key("error") {
                return Dispatch::Accepted;
            }
            return invalid(&reply_id, "Invalid Request");
        }
    };
    let params = obj.get("params");
    let id = match id_value {
        None => {
            if method == "notifications/cancelled" {
                if let Some(rid @ (Value::String(_) | Value::Number(_))) = params.and_then(|p| p.get("requestId")) {
                    return Dispatch::Cancel { request_id: rid.clone() };
                }
            }
            return Dispatch::Accepted;
        }
        Some(v @ (Value::String(_) | Value::Number(_))) => v.clone(),
        // MCP: request ids MUST NOT be null.
        Some(Value::Null) => return invalid(&null, "Request id must not be null"),
        Some(_) => return invalid(&null, "Invalid Request"),
    };
    match method {
        "initialize" => {
            let requested = params.and_then(|p| p.get("protocolVersion")).and_then(Value::as_str);
            Dispatch::Reply(json!({ "jsonrpc": "2.0", "id": id, "result": initialize_result(requested, server_version) }))
        }
        "ping" => Dispatch::Reply(json!({ "jsonrpc": "2.0", "id": id, "result": {} })),
        "tools/list" => Dispatch::Reply(json!({ "jsonrpc": "2.0", "id": id, "result": tools_list_result(tools) })),
        "tools/call" => {
            let Some(name) = params.and_then(|p| p.get("name")).and_then(Value::as_str) else {
                return Dispatch::Reply(jsonrpc_error(&id, INVALID_PARAMS, "Missing tool name"));
            };
            let Some(tool) = tools.iter().find(|t| t.name == name) else {
                let short: String = name.chars().take(64).collect();
                return Dispatch::Reply(jsonrpc_error(&id, INVALID_PARAMS, &format!("Unknown tool: {short}")));
            };
            let arguments = match params.and_then(|p| p.get("arguments")) {
                None | Some(Value::Null) => json!({}),
                Some(a) if a.is_object() => a.clone(),
                Some(_) => return Dispatch::Reply(jsonrpc_error(&id, INVALID_PARAMS, "Arguments must be an object")),
            };
            Dispatch::CallTool { id, name: tool.name.clone(), kind: tool.kind, arguments }
        }
        _ => Dispatch::Reply(jsonrpc_error(&id, METHOD_NOT_FOUND, "Method not found")),
    }
}

/// The requested version when supported, else LATEST_PROTOCOL_VERSION.
pub fn negotiate_version(requested: Option<&str>) -> &'static str {
    requested
        .and_then(|r| SUPPORTED_PROTOCOL_VERSIONS.iter().find(|v| **v == r))
        .copied()
        .unwrap_or(LATEST_PROTOCOL_VERSION)
}

/// `{ protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: { name, title, version },
/// instructions: SERVER_INSTRUCTIONS }`.
pub fn initialize_result(requested_version: Option<&str>, server_version: &str) -> Value {
    json!({
        "protocolVersion": negotiate_version(requested_version),
        "capabilities": { "tools": { "listChanged": false } },
        "serverInfo": { "name": SERVER_NAME, "title": SERVER_TITLE, "version": server_version },
        "instructions": SERVER_INSTRUCTIONS,
    })
}

/// `{ tools: [{ name, title, description, inputSchema, annotations: { title, readOnlyHint: kind==Read,
/// destructiveHint: false, idempotentHint: kind==Read, openWorldHint: false } }] }`.
pub fn tools_list_result(tools: &[ToolRegistration]) -> Value {
    let list: Vec<Value> = tools
        .iter()
        .map(|t| {
            let read = t.kind == ToolKind::Read;
            json!({
                "name": t.name,
                "title": t.title,
                "description": t.description,
                "inputSchema": t.input_schema,
                "annotations": {
                    "title": t.title,
                    "readOnlyHint": read,
                    "destructiveHint": false,
                    "idempotentHint": read,
                    "openWorldHint": false,
                },
            })
        })
        .collect();
    json!({ "tools": list })
}

/// `{ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError } }`.
pub fn tool_result_response(id: &Value, outcome: &ToolOutcome) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": { "content": [{ "type": "text", "text": outcome.text }], "isError": outcome.is_error },
    })
}

/// `{ jsonrpc: "2.0", id, error: { code, message } }`.
pub fn jsonrpc_error(id: &Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

#[cfg(test)]
mod tests {
    use super::*;

    const TOKEN: &str = "coco_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP";

    fn tool(name: &str, kind: ToolKind) -> ToolRegistration {
        ToolRegistration {
            name: name.into(),
            title: "Titel".into(),
            description: "Beschreibung".into(),
            kind,
            input_schema: json!({"type":"object","properties":{}}),
        }
    }

    fn head<'a>() -> RequestHead<'a> {
        RequestHead {
            method: "POST",
            path: "/mcp",
            host: Some("127.0.0.1:41731"),
            origin: None,
            authorization: Some("Bearer coco_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP"),
            protocol_version: None,
            content_length: Some(10),
        }
    }

    fn status(h: &RequestHead<'_>) -> Option<u16> {
        check_request_head(h, TOKEN).err().map(|e| e.status)
    }

    #[test]
    fn tools_validation() {
        assert!(validate_tools(&[tool("list_camps", ToolKind::Read), tool("a1", ToolKind::Write)]).is_ok());
        assert!(validate_tools(&[]).is_ok());
        for bad in ["", "Abc", "1abc", "a-b", "a b", &"a".repeat(65)] {
            assert!(validate_tools(&[tool(bad, ToolKind::Read)]).is_err(), "{bad}");
        }
        assert!(validate_tools(&[tool(&"a".repeat(64), ToolKind::Read)]).is_ok());
        assert!(validate_tools(&[tool("a", ToolKind::Read), tool("a", ToolKind::Write)]).is_err());
        let many: Vec<_> = (0..=MAX_TOOLS).map(|i| tool(&format!("t{i}"), ToolKind::Read)).collect();
        assert!(validate_tools(&many).is_err());
        let mut t = tool("a", ToolKind::Read);
        t.input_schema = json!({"type":"string"});
        assert!(validate_tools(&[t.clone()]).is_err());
        t.input_schema = json!("x");
        assert!(validate_tools(&[t]).is_err());
        let mut t = tool("a", ToolKind::Read);
        t.title = " ".into();
        assert!(validate_tools(&[t]).is_err());
        let mut t = tool("a", ToolKind::Read);
        t.description = "x".repeat(2001);
        assert!(validate_tools(&[t]).is_err());
    }

    #[test]
    fn port_validation() {
        assert!(validate_port(1023).is_err());
        assert!(validate_port(0).is_err());
        assert!(validate_port(1024).is_ok());
        assert!(validate_port(65535).is_ok());
        assert_eq!(validate_port(80).unwrap_err().to_string(), "Ungültige Eingabe: Port muss zwischen 1024 und 65535 liegen");
    }

    #[test]
    fn cap() {
        let ok = ToolOutcome { text: "x".repeat(MAX_RESULT_CHARS), is_error: false };
        assert_eq!(cap_outcome(ok.clone()), ok);
        let big = cap_outcome(ToolOutcome { text: "x".repeat(MAX_RESULT_CHARS + 1), is_error: false });
        assert!(big.is_error);
        assert!(big.text.starts_with("Ergebnis zu gross"));
    }

    #[test]
    fn head_happy_path() {
        assert_eq!(status(&head()), None);
        let mut h = head();
        h.path = "/mcp?x=1";
        h.origin = Some("http://localhost:3000");
        h.protocol_version = Some("2025-06-18");
        assert_eq!(status(&h), None);
    }

    #[test]
    fn head_rejections() {
        let mut h = head();
        h.path = "/other";
        assert_eq!(status(&h), Some(404));
        h.path = "/mcp/";
        assert_eq!(status(&h), Some(404));

        let mut h = head();
        h.host = None;
        assert_eq!(status(&h), Some(403));
        h.host = Some("attacker.com");
        assert_eq!(status(&h), Some(403));
        h.host = Some("evil");
        assert_eq!(status(&h), Some(403));

        let mut h = head();
        h.origin = Some("http://evil.com");
        assert_eq!(status(&h), Some(403));
        h.origin = Some("null");
        assert_eq!(status(&h), Some(403));

        let mut h = head();
        h.method = "GET";
        assert_eq!(status(&h), Some(405));

        let mut h = head();
        h.authorization = None;
        assert_eq!(status(&h), Some(401));
        h.authorization = Some("Bearer wrong");
        assert_eq!(status(&h), Some(401));
        h.authorization = Some("Basic coco_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP");
        assert_eq!(status(&h), Some(401));
        h.authorization = Some("Bearer coco_abcdefghijklmnopqrstuvwxyz");
        assert_eq!(status(&h), Some(401));
        assert_eq!(check_request_head(&h, TOKEN).unwrap_err().message, "Nicht autorisiert");

        let mut h = head();
        h.protocol_version = Some("1999-01-01");
        assert_eq!(status(&h), Some(400));

        let mut h = head();
        h.content_length = Some(MAX_REQUEST_BYTES + 1);
        assert_eq!(status(&h), Some(413));
        h.content_length = Some(MAX_REQUEST_BYTES);
        assert_eq!(status(&h), None);
    }

    #[test]
    fn head_check_order() {
        // 404 beats everything, host beats method and token.
        let mut h = head();
        h.path = "/x";
        h.host = None;
        h.method = "GET";
        assert_eq!(status(&h), Some(404));
        h.path = "/mcp";
        assert_eq!(status(&h), Some(403));
        h.host = Some("localhost");
        assert_eq!(status(&h), Some(405));
        h.method = "POST";
        h.authorization = None;
        h.protocol_version = Some("bad");
        h.content_length = Some(usize::MAX);
        assert_eq!(status(&h), Some(401));
    }

    #[test]
    fn loopback_hosts() {
        for ok in ["localhost", "LOCALHOST:8080", "127.0.0.1", "127.0.0.1:41731", "127.5.6.7:1", "[::1]", "[::1]:41731"] {
            assert!(is_loopback_host_header(ok), "{ok}");
        }
        for bad in ["", "localhost.evil.com", "127.0.0.1.nip.io", "0.0.0.0", "attacker.com", "localhost:", "localhost:abc", "[::1]x", "[::2]", "128.0.0.1", "[::1"] {
            assert!(!is_loopback_host_header(bad), "{bad}");
        }
    }

    #[test]
    fn loopback_origins() {
        for ok in ["http://localhost", "http://localhost:3000", "https://127.0.0.1:8443", "http://[::1]:5173", "http://localhost/"] {
            assert!(is_loopback_origin(ok), "{ok}");
        }
        for bad in ["null", "", "http://evil.com", "http://localhost.evil.com", "ftp://localhost", "http://localhost/path", "http://u@localhost", "tauri://localhost", "http://0.0.0.0"] {
            assert!(!is_loopback_origin(bad), "{bad}");
        }
    }

    #[test]
    fn token_comparison() {
        assert!(token_matches(Some(&format!("Bearer {TOKEN}")), TOKEN));
        assert!(token_matches(Some(&format!("  bearer   {TOKEN}  ")), TOKEN));
        assert!(token_matches(Some(&format!("BEARER {TOKEN}")), TOKEN));
        assert!(!token_matches(None, TOKEN));
        assert!(!token_matches(Some(TOKEN), TOKEN));
        assert!(!token_matches(Some("Bearer"), TOKEN));
        assert!(!token_matches(Some(&format!("Basic {TOKEN}")), TOKEN));
        assert!(!token_matches(Some(&format!("Bearer {}", &TOKEN[..TOKEN.len() - 1])), TOKEN));
        assert!(!token_matches(Some(&format!("Bearer {TOKEN}x")), TOKEN));
        assert!(!token_matches(Some("Bearer "), ""));
        assert!(!token_matches(Some("Bearer x"), ""));
    }

    #[test]
    fn token_format() {
        let t = format_token(&[0xff; 32]);
        assert_eq!(t.len(), 48);
        assert!(t.starts_with("coco_"));
        assert!(is_valid_token(&t));
        assert!(is_valid_token(&format_token(&[0; 32])));
        assert!(!is_valid_token(""));
        assert!(!is_valid_token("coco_"));
        assert!(!is_valid_token(&t[..47]));
        assert!(!is_valid_token(&format!("{t}a")));
        assert!(!is_valid_token(&t.replacen("coco_", "xoxo_", 1)));
        assert!(!is_valid_token(&format!("coco_{}+", "a".repeat(42))));
        assert_ne!(format_token(&[1; 32]), format_token(&[2; 32]));
    }

    #[test]
    fn version_negotiation() {
        assert_eq!(negotiate_version(Some("2024-11-05")), "2024-11-05");
        assert_eq!(negotiate_version(Some("2025-03-26")), "2025-03-26");
        assert_eq!(negotiate_version(Some("2099-01-01")), LATEST_PROTOCOL_VERSION);
        assert_eq!(negotiate_version(None), LATEST_PROTOCOL_VERSION);
    }

    #[test]
    fn initialize_shape() {
        let v = initialize_result(Some("2025-03-26"), "1.2.3");
        assert_eq!(v["protocolVersion"], "2025-03-26");
        assert_eq!(v["capabilities"]["tools"]["listChanged"], false);
        assert_eq!(v["serverInfo"]["name"], "co-co");
        assert_eq!(v["serverInfo"]["title"], SERVER_TITLE);
        assert_eq!(v["serverInfo"]["version"], "1.2.3");
        assert_eq!(v["instructions"], SERVER_INSTRUCTIONS);
    }

    #[test]
    fn list_annotations() {
        let v = tools_list_result(&[tool("r", ToolKind::Read), tool("w", ToolKind::Write)]);
        let t = v["tools"].as_array().unwrap();
        assert_eq!(t.len(), 2);
        assert_eq!(t[0]["name"], "r");
        assert_eq!(t[0]["inputSchema"]["type"], "object");
        assert_eq!(t[0]["annotations"]["title"], "Titel");
        assert_eq!(t[0]["annotations"]["readOnlyHint"], true);
        assert_eq!(t[0]["annotations"]["idempotentHint"], true);
        assert_eq!(t[1]["annotations"]["readOnlyHint"], false);
        assert_eq!(t[1]["annotations"]["idempotentHint"], false);
        assert_eq!(t[1]["annotations"]["destructiveHint"], false);
        assert_eq!(t[1]["annotations"]["openWorldHint"], false);
    }

    #[test]
    fn response_builders() {
        let r = tool_result_response(&json!(7), &ToolOutcome { text: "hi".into(), is_error: true });
        assert_eq!(r, json!({"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"hi"}],"isError":true}}));
        let e = jsonrpc_error(&json!("a"), INVALID_PARAMS, "m");
        assert_eq!(e, json!({"jsonrpc":"2.0","id":"a","error":{"code":-32602,"message":"m"}}));
    }

    fn handle(body: &str, tools: &[ToolRegistration]) -> Dispatch {
        handle_message(body.as_bytes(), tools, "0.1.0")
    }

    fn err_code(d: &Dispatch) -> i64 {
        match d {
            Dispatch::Reply(v) => v["error"]["code"].as_i64().unwrap(),
            other => panic!("not a reply: {other:?}"),
        }
    }

    #[test]
    fn message_initialize_ping_list() {
        let d = handle(r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}"#, &[]);
        let Dispatch::Reply(v) = d else { panic!() };
        assert_eq!(v["jsonrpc"], "2.0");
        assert_eq!(v["id"], 1);
        assert_eq!(v["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(v["result"]["serverInfo"]["version"], "0.1.0");

        let Dispatch::Reply(v) = handle(r#"{"jsonrpc":"2.0","id":"x","method":"initialize"}"#, &[]) else { panic!() };
        assert_eq!(v["result"]["protocolVersion"], LATEST_PROTOCOL_VERSION);

        let Dispatch::Reply(v) = handle(r#"{"jsonrpc":"2.0","id":2,"method":"ping"}"#, &[]) else { panic!() };
        assert_eq!(v["result"], json!({}));

        let tools = [tool("a", ToolKind::Read)];
        let Dispatch::Reply(v) = handle(r#"{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{"cursor":"zz"}}"#, &tools) else { panic!() };
        assert_eq!(v["result"]["tools"][0]["name"], "a");
        assert!(v["result"].get("nextCursor").is_none());
    }

    #[test]
    fn message_tools_call() {
        let tools = [tool("a", ToolKind::Read), tool("w", ToolKind::Write)];
        let d = handle(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"w","arguments":{"x":1}}}"#, &tools);
        assert_eq!(d, Dispatch::CallTool { id: json!(5), name: "w".into(), kind: ToolKind::Write, arguments: json!({"x":1}) });
        let d = handle(r#"{"jsonrpc":"2.0","id":"s","method":"tools/call","params":{"name":"a"}}"#, &tools);
        assert_eq!(d, Dispatch::CallTool { id: json!("s"), name: "a".into(), kind: ToolKind::Read, arguments: json!({}) });

        let d = handle(r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope"}}"#, &tools);
        assert_eq!(err_code(&d), INVALID_PARAMS);
        let Dispatch::Reply(v) = d else { panic!() };
        assert_eq!(v["error"]["message"], "Unknown tool: nope");
        assert_eq!(v["id"], 5);

        let long = "z".repeat(200);
        let body = format!(r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"name":"{long}"}}}}"#);
        let Dispatch::Reply(v) = handle(&body, &tools) else { panic!() };
        assert_eq!(v["error"]["message"].as_str().unwrap().chars().count(), "Unknown tool: ".len() + 64);

        for body in [
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"a","arguments":[1]}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"a","arguments":"s"}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call"}"#,
            r#"{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":5}}"#,
        ] {
            assert_eq!(err_code(&handle(body, &tools)), INVALID_PARAMS, "{body}");
        }
    }

    fn invalid_code(d: &Dispatch) -> i64 {
        match d {
            Dispatch::Invalid(v) => v["error"]["code"].as_i64().unwrap(),
            other => panic!("not invalid: {other:?}"),
        }
    }

    #[test]
    fn message_edge_cases() {
        assert_eq!(handle(r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#, &[]), Dispatch::Accepted);
        assert_eq!(handle(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#, &[]), Dispatch::Accepted);
        assert_eq!(handle(r#"{"jsonrpc":"2.0","id":1,"error":{"code":1,"message":"x"}}"#, &[]), Dispatch::Accepted);

        let d = handle("{not json", &[]);
        assert_eq!(invalid_code(&d), PARSE_ERROR);
        let Dispatch::Invalid(v) = d else { panic!() };
        assert_eq!(v["id"], Value::Null);

        assert_eq!(invalid_code(&handle("5", &[])), INVALID_REQUEST);
        assert_eq!(invalid_code(&handle(r#"{"id":1,"method":"ping"}"#, &[])), INVALID_REQUEST);
        assert_eq!(invalid_code(&handle(r#"{"jsonrpc":"1.0","id":1,"method":"ping"}"#, &[])), INVALID_REQUEST);
        assert_eq!(invalid_code(&handle(r#"{"jsonrpc":"2.0","id":1,"method":5}"#, &[])), INVALID_REQUEST);
        assert_eq!(invalid_code(&handle(r#"{"jsonrpc":"2.0","id":1}"#, &[])), INVALID_REQUEST);
        assert_eq!(invalid_code(&handle(r#"{"jsonrpc":"2.0","id":[1],"method":"ping"}"#, &[])), INVALID_REQUEST);

        let d = handle(r#"{"jsonrpc":"2.0","id":9,"method":"resources/list"}"#, &[]);
        assert_eq!(err_code(&d), METHOD_NOT_FOUND);
        let Dispatch::Reply(v) = d else { panic!() };
        assert_eq!(v["id"], 9);

        // MCP: request ids must not be null.
        let d = handle(r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#, &[]);
        assert_eq!(invalid_code(&d), INVALID_REQUEST);
        let Dispatch::Invalid(v) = d else { panic!() };
        assert_eq!(v["id"], Value::Null);
    }

    #[test]
    fn message_cancelled() {
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":1,"reason":"timeout"}}"#, &[]),
            Dispatch::Cancel { request_id: json!(1) }
        );
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"a"}}"#, &[]),
            Dispatch::Cancel { request_id: json!("a") }
        );
        // Without a usable requestId it is an ordinary notification.
        assert_eq!(handle(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{}}"#, &[]), Dispatch::Accepted);
        assert_eq!(
            handle(r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":null}}"#, &[]),
            Dispatch::Accepted
        );
    }

    #[test]
    fn message_batches() {
        let tools = [tool("a", ToolKind::Read)];
        let d = handle(
            r#"[{"jsonrpc":"2.0","id":1,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},
                {"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"a"}},{"jsonrpc":"2.0","id":null,"method":"ping"},
                [1],{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":7}}]"#,
            &tools,
        );
        let Dispatch::Batch(items) = d else { panic!("{d:?}") };
        assert_eq!(items.len(), 6);
        assert!(matches!(&items[0], Dispatch::Reply(v) if v["id"] == 1 && v["result"] == json!({})));
        assert_eq!(items[1], Dispatch::Accepted);
        assert!(matches!(&items[2], Dispatch::CallTool { id, .. } if *id == json!(2)));
        assert_eq!(err_code(&items[3]), INVALID_REQUEST);
        assert_eq!(err_code(&items[4]), INVALID_REQUEST);
        assert_eq!(items[5], Dispatch::Cancel { request_id: json!(7) });

        // Only notifications / responses: no element needs a reply.
        let Dispatch::Batch(items) =
            handle(r#"[{"jsonrpc":"2.0","method":"notifications/initialized"},{"jsonrpc":"2.0","id":1,"result":{}}]"#, &[])
        else {
            panic!()
        };
        assert!(items.iter().all(|d| *d == Dispatch::Accepted));

        assert_eq!(invalid_code(&handle("[]", &[])), INVALID_REQUEST);
        let big = format!("[{}]", vec![r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#; MAX_BATCH + 1].join(","));
        assert_eq!(invalid_code(&handle(&big, &[])), INVALID_REQUEST);
    }

    #[test]
    fn serde_shapes() {
        let t = tool("a", ToolKind::Write);
        let v = serde_json::to_value(&t).unwrap();
        assert_eq!(v["inputSchema"]["type"], "object");
        assert_eq!(v["kind"], "write");
        assert!(v.get("input_schema").is_none());
        let back: ToolRegistration = serde_json::from_value(v).unwrap();
        assert_eq!(back, t);
        let o: ToolOutcome = serde_json::from_value(json!({"text":"x","isError":true})).unwrap();
        assert!(o.is_error);
        assert_eq!(serde_json::to_value(&o).unwrap(), json!({"text":"x","isError":true}));
        assert_eq!(serde_json::to_value(ToolKind::Read).unwrap(), json!("read"));
    }
}
