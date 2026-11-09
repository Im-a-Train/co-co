//! ADR 0012: local MCP server (Model Context Protocol, "Streamable HTTP" transport, JSON responses only).
//!
//! - `tiny_http` server on `127.0.0.1:<port>` in its own thread; every request is handled on a short-lived
//!   worker thread (tool calls block while the frontend works). Off by default; started/stopped by the
//!   frontend (`mcp_start` / `mcp_stop`), which only does so while AI + MCP are enabled in the settings.
//! - Request heads are checked with `coco_core::mcp::check_request_head` (loopback Host/Origin, POST /mcp,
//!   bearer token, protocol version, size) and bodies dispatched with `coco_core::mcp::handle_message`.
//! - `tools/call` -> event `mcp://tool-call` (main window only) -> frontend runs the tool -> `mcp_tool_result`
//!   -> waiting worker gets the outcome via a channel (timeouts: READ_TIMEOUT_SECS / WRITE_TIMEOUT_SECS).
//!   For write tools the main window is brought to the front (confirmation dialog). The event carries the
//!   deadline (`deadlineMs`); when the call ends without a frontend answer (client `notifications/cancelled`,
//!   timeout, server stop) Rust emits `mcp://tool-cancel` so the frontend drops the call and its dialog.
//! - JSON-RPC batches (older protocol versions) are handled element by element, in order.
//! - Bearer token in the OS keychain (service `coco_core::ai::KEY_SERVICE`, user `coco_core::mcp::TOKEN_KEY_USER`),
//!   cached in memory. Never logged, never in errors or events; only `mcp_get_token` / `mcp_regenerate_token`
//!   return it (ADR 0012 exception: the coach pastes it into the client config).
//! - Activity log: last LOG_CAPACITY calls in memory (tool, kind, ok, duration, short error), never payloads.

use std::collections::{HashMap, VecDeque};
use std::io::Read;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex, MutexGuard, RwLock};
use std::thread::JoinHandle;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use coco_core::mcp::{
    cap_outcome, check_request_head, format_token, handle_message, is_valid_token, jsonrpc_error, tool_result_response,
    validate_port, validate_tools, Dispatch, RequestHead, ToolKind, ToolOutcome, ToolRegistration, INVALID_REQUEST,
    LOG_CAPACITY, MAX_IN_FLIGHT, MAX_REQUEST_BYTES, MCP_PATH, READ_TIMEOUT_SECS, TOKEN_KEY_USER, WRITE_TIMEOUT_SECS,
};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Runtime, State, Webview};

use crate::error::{AppError, AppResult};
use crate::session::{ensure_main, MAIN_LABEL};

/// Event to "main": payload `ToolCallEvent`.
pub const EVENT_MCP_TOOL_CALL: &str = "mcp://tool-call";
/// Event to "main": payload `McpStatus` (after start/stop/failure and after every finished call).
pub const EVENT_MCP_STATUS: &str = "mcp://status";
/// Event to "main": payload `ToolCancelEvent`. The call was answered without the frontend (client cancelled,
/// timeout, server stopped): drop its confirmation dialog and do not run it.
pub const EVENT_MCP_TOOL_CANCEL: &str = "mcp://tool-cancel";

/// Answer text when the client cancelled the call (`notifications/cancelled`).
const CANCELLED_TEXT: &str = "Vom MCP-Client abgebrochen";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpLogEntry {
    /// Epoch milliseconds.
    pub at_ms: u64,
    pub tool: Option<String>,
    pub kind: Option<ToolKind>,
    pub ok: bool,
    pub duration_ms: u64,
    /// Short German reason ("Nicht autorisiert", "Zeitüberschreitung", "Abgelehnt", …). Never payload data.
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub running: bool,
    pub port: Option<u16>,
    /// `http://127.0.0.1:<port>/mcp` while running.
    pub url: Option<String>,
    pub error: Option<String>,
    pub tool_count: usize,
    /// Newest first.
    pub log: Vec<McpLogEntry>,
}

/// Payload of `mcp://tool-call` (mirrors McpToolCallEvent in src/domain/mcp/types.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallEvent {
    pub call_id: String,
    pub name: String,
    pub kind: ToolKind,
    pub arguments: Value,
    /// Epoch milliseconds when Rust stops waiting and answers the client with a timeout.
    pub deadline_ms: u64,
}

/// Payload of `mcp://tool-cancel` (mirrors McpToolCancelEvent in src/domain/mcp/types.ts).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCancelEvent {
    pub call_id: String,
}

/// A call waiting for the frontend.
struct PendingCall {
    tx: Sender<ToolOutcome>,
    /// JSON-RPC id of the client request (for `notifications/cancelled`).
    request_id: Value,
}

/// Lock helper: a poisoned mutex (panic in another thread) must never take the server down.
fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// What the server needs from the app. Implemented for `AppHandle`; tests use a fake without Tauri.
trait Host: Send + Sync + 'static {
    /// Delivers a tool call to the main window. False when it could not be delivered.
    fn emit_tool_call(&self, event: &ToolCallEvent) -> bool;
    /// Tells the main window that a call ended without its answer (drop dialog, do not run).
    fn emit_tool_cancel(&self, call_id: &str);
    /// Brings the main window to the front (write tools need a confirmation).
    fn focus_main(&self);
    fn status_changed(&self, status: &McpStatus);
}

impl<R: Runtime> Host for AppHandle<R> {
    fn emit_tool_call(&self, event: &ToolCallEvent) -> bool {
        self.emit_to(MAIN_LABEL, EVENT_MCP_TOOL_CALL, event).is_ok()
    }
    fn emit_tool_cancel(&self, call_id: &str) {
        let _ = self.emit_to(MAIN_LABEL, EVENT_MCP_TOOL_CANCEL, ToolCancelEvent { call_id: call_id.to_string() });
    }
    fn focus_main(&self) {
        if let Some(w) = self.get_webview_window(MAIN_LABEL) {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
    fn status_changed(&self, status: &McpStatus) {
        let _ = self.emit_to(MAIN_LABEL, EVENT_MCP_STATUS, status);
    }
}

/// A running server. Stopping = `server.unblock()` + join the accept thread.
struct Running {
    port: u16,
    server: Arc<tiny_http::Server>,
    thread: Option<JoinHandle<()>>,
}

/// Shared between the commands and the server threads. Deliberately no `Debug` (holds the token).
struct Shared {
    running: Mutex<Option<Running>>,
    tools: RwLock<Vec<ToolRegistration>>,
    /// callId -> waiting worker.
    pending: Mutex<HashMap<String, PendingCall>>,
    log: Mutex<VecDeque<McpLogEntry>>,
    /// In-memory copy of the keychain token (None until first read/created).
    token: Mutex<Option<String>>,
    last_error: Mutex<Option<String>>,
    next_call_id: AtomicU64,
}

impl Shared {
    fn new() -> Self {
        Self {
            running: Mutex::new(None),
            tools: RwLock::new(Vec::new()),
            pending: Mutex::new(HashMap::new()),
            log: Mutex::new(VecDeque::new()),
            token: Mutex::new(None),
            last_error: Mutex::new(None),
            next_call_id: AtomicU64::new(1),
        }
    }

    fn status(&self) -> McpStatus {
        let (running, port) = match lock(&self.running).as_ref() {
            Some(r) => (true, Some(r.port)),
            None => (false, None),
        };
        McpStatus {
            running,
            port,
            url: port.map(|p| format!("http://127.0.0.1:{p}{MCP_PATH}")),
            error: lock(&self.last_error).clone(),
            tool_count: self.tools.read().unwrap_or_else(|e| e.into_inner()).len(),
            log: lock(&self.log).iter().cloned().collect(),
        }
    }

    /// Newest first, capped at LOG_CAPACITY.
    fn push_log(&self, entry: McpLogEntry) {
        let mut log = lock(&self.log);
        log.push_front(entry);
        log.truncate(LOG_CAPACITY);
    }

    fn current_token(&self) -> Option<String> {
        lock(&self.token).clone()
    }

    /// Blocking (keychain). Reads, or creates and stores, the token.
    fn ensure_token(&self) -> AppResult<String> {
        if let Some(t) = self.current_token() {
            return Ok(t);
        }
        let entry = token_entry()?;
        let stored = match entry.get_password() {
            Ok(t) => Some(t),
            Err(keyring::Error::NoEntry) => None,
            Err(e) => return Err(keyring_err(e)),
        };
        let token = match stored.filter(|t| is_valid_token(t)) {
            Some(t) => t,
            None => {
                let t = new_token()?;
                entry.set_password(&t).map_err(keyring_err)?;
                t
            }
        };
        *lock(&self.token) = Some(token.clone());
        Ok(token)
    }

    fn regenerate_token(&self) -> AppResult<String> {
        let t = new_token()?;
        token_entry()?.set_password(&t).map_err(keyring_err)?;
        *lock(&self.token) = Some(t.clone());
        Ok(t)
    }

    /// Answers the waiting worker; unknown / late ids are ignored.
    fn deliver(&self, call_id: &str, outcome: ToolOutcome) {
        let call = lock(&self.pending).remove(call_id);
        if let Some(call) = call {
            let _ = call.tx.send(outcome);
        }
    }

    /// `notifications/cancelled`: answers the waiting call with CANCELLED_TEXT and tells the frontend.
    /// The server is stateless (no MCP sessions), so request ids of different clients may collide: only a
    /// unique match is cancelled; otherwise the call runs into its normal timeout. Returns the cancelled callId.
    fn cancel_request(&self, host: &dyn Host, request_id: &Value) -> Option<String> {
        let call = {
            let mut pending = lock(&self.pending);
            let mut matches = pending.iter().filter(|(_, c)| c.request_id == *request_id).map(|(id, _)| id.clone());
            let (Some(call_id), None) = (matches.next(), matches.next()) else {
                return None;
            };
            pending.remove(&call_id).map(|c| (call_id, c))
        };
        let (call_id, call) = call?;
        let _ = call.tx.send(err_outcome(CANCELLED_TEXT));
        host.emit_tool_cancel(&call_id);
        Some(call_id)
    }

    fn drain_pending(&self, host: &dyn Host, message: &str) {
        let all: Vec<_> = lock(&self.pending).drain().collect();
        for (call_id, call) in all {
            let _ = call.tx.send(err_outcome(message));
            host.emit_tool_cancel(&call_id);
        }
    }
}

fn token_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(coco_core::ai::KEY_SERVICE, TOKEN_KEY_USER).map_err(keyring_err)
}

fn keyring_err(e: keyring::Error) -> AppError {
    // keyring errors do not contain the secret
    AppError::Unexpected(format!("Schlüsselbund nicht verfügbar: {e}"))
}

fn new_token() -> AppResult<String> {
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|_| AppError::Unexpected("Zufallszahlen nicht verfügbar".into()))?;
    Ok(format_token(&random))
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn err_outcome(text: &str) -> ToolOutcome {
    ToolOutcome { text: text.into(), is_error: true }
}

// ---- server core (no Tauri) ----------------------------------------------------------------------

/// Starts (or restarts on another port) the server. Blocking. `port` 0 picks a free port (tests).
fn start_server(shared: &Arc<Shared>, host: &Arc<dyn Host>, port: u16) -> AppResult<McpStatus> {
    if port != 0 {
        validate_port(port)?;
    }
    if lock(&shared.running).as_ref().is_some_and(|r| r.port == port) {
        return Ok(shared.status());
    }
    stop_server(shared, host);
    shared.ensure_token()?;
    let server = match tiny_http::Server::http(("127.0.0.1", port)) {
        Ok(s) => Arc::new(s),
        Err(_) => {
            let msg = format!("Port {port} ist bereits belegt oder nicht verfügbar");
            *lock(&shared.last_error) = Some(msg.clone());
            host.status_changed(&shared.status());
            return Err(AppError::Unexpected(msg));
        }
    };
    let actual_port = server.server_addr().to_ip().map(|a| a.port()).unwrap_or(port);
    let accept_server = server.clone();
    let (s2, h2) = (shared.clone(), host.clone());
    let thread = std::thread::Builder::new()
        .name("mcp-accept".into())
        .spawn(move || {
            while let Ok(request) = accept_server.recv() {
                let (s3, h3) = (s2.clone(), h2.clone());
                let _ = std::thread::Builder::new().name("mcp-worker".into()).spawn(move || {
                    handle_request(&s3, h3.as_ref(), request);
                });
            }
        })
        .map_err(|e| AppError::Unexpected(format!("MCP-Server konnte nicht gestartet werden: {e}")))?;
    *lock(&shared.last_error) = None;
    *lock(&shared.running) = Some(Running { port: actual_port, server, thread: Some(thread) });
    let status = shared.status();
    host.status_changed(&status);
    Ok(status)
}

/// Idempotent, blocking.
fn stop_server(shared: &Arc<Shared>, host: &Arc<dyn Host>) -> McpStatus {
    let running = lock(&shared.running).take();
    if let Some(mut r) = running {
        r.server.unblock();
        if let Some(t) = r.thread.take() {
            let _ = t.join();
        }
    }
    shared.drain_pending(host.as_ref(), "MCP-Server wurde gestoppt");
    *lock(&shared.last_error) = None;
    let status = shared.status();
    host.status_changed(&status);
    status
}

fn json_response(status: u16, body: &Value) -> tiny_http::Response<std::io::Cursor<Vec<u8>>> {
    let mut r = tiny_http::Response::from_string(body.to_string()).with_status_code(status);
    if let Ok(h) = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]) {
        r = r.with_header(h);
    }
    r
}

fn header_value(request: &tiny_http::Request, name: &str) -> Option<String> {
    request.headers().iter().find(|h| h.field.as_str().as_str().eq_ignore_ascii_case(name)).map(|h| h.value.as_str().to_string())
}

fn handle_request(shared: &Shared, host: &dyn Host, mut request: tiny_http::Request) {
    let started = Instant::now();
    let method = request.method().as_str().to_string();
    let path = request.url().to_string();
    let host_h = header_value(&request, "Host");
    let origin = header_value(&request, "Origin");
    let auth = header_value(&request, "Authorization");
    let proto = header_value(&request, "MCP-Protocol-Version");
    let head = RequestHead {
        method: &method,
        path: &path,
        host: host_h.as_deref(),
        origin: origin.as_deref(),
        authorization: auth.as_deref(),
        protocol_version: proto.as_deref(),
        content_length: request.body_length(),
    };
    let token = shared.current_token().unwrap_or_default();
    if let Err(rej) = check_request_head(&head, &token) {
        if rej.status == 401 {
            shared.push_log(McpLogEntry {
                at_ms: now_ms(),
                tool: None,
                kind: None,
                ok: false,
                duration_ms: started.elapsed().as_millis() as u64,
                error: Some("Nicht autorisiert".into()),
            });
            host.status_changed(&shared.status());
        }
        let mut resp = json_response(rej.status, &json!({ "error": rej.message }));
        if rej.status == 401 {
            if let Ok(h) = tiny_http::Header::from_bytes(&b"WWW-Authenticate"[..], &b"Bearer"[..]) {
                resp = resp.with_header(h);
            }
        }
        let _ = request.respond(resp);
        return;
    }

    let mut body = Vec::new();
    let read = request.as_reader().take(MAX_REQUEST_BYTES as u64 + 1).read_to_end(&mut body);
    if read.is_err() {
        let _ = request.respond(json_response(400, &json!({ "error": "Anfrage nicht lesbar" })));
        return;
    }
    if body.len() > MAX_REQUEST_BYTES {
        let _ = request.respond(json_response(413, &json!({ "error": "Anfrage zu gross" })));
        return;
    }

    let tools = shared.tools.read().unwrap_or_else(|e| e.into_inner()).clone();
    match handle_message(&body, &tools, env!("CARGO_PKG_VERSION")) {
        Dispatch::Invalid(v) => {
            let _ = request.respond(json_response(400, &v));
        }
        Dispatch::Batch(items) => {
            let replies: Vec<Value> = items.into_iter().filter_map(|d| process(shared, host, d, started)).collect();
            if replies.is_empty() {
                let _ = request.respond(tiny_http::Response::empty(202));
            } else {
                let _ = request.respond(json_response(200, &Value::Array(replies)));
            }
        }
        single => match process(shared, host, single, started) {
            Some(v) => {
                let _ = request.respond(json_response(200, &v));
            }
            None => {
                let _ = request.respond(tiny_http::Response::empty(202));
            }
        },
    }
}

/// Handles one (non-batch) dispatch. Returns the JSON-RPC reply, or None for "202 Accepted".
fn process(shared: &Shared, host: &dyn Host, d: Dispatch, started: Instant) -> Option<Value> {
    match d {
        Dispatch::Reply(v) | Dispatch::Invalid(v) => Some(v),
        Dispatch::Accepted => None,
        Dispatch::Cancel { request_id } => {
            shared.cancel_request(host, &request_id);
            None
        }
        Dispatch::CallTool { id, name, kind, arguments } => {
            let (outcome, reason) = run_tool(shared, host, &id, &name, kind, arguments);
            let outcome = cap_outcome(outcome);
            shared.push_log(McpLogEntry {
                at_ms: now_ms(),
                tool: Some(name.clone()),
                kind: Some(kind),
                ok: !outcome.is_error,
                duration_ms: started.elapsed().as_millis() as u64,
                error: if outcome.is_error { Some(reason.unwrap_or("Fehler").to_string()) } else { None },
            });
            eprintln!("mcp: tool={name} ok={} ms={}", !outcome.is_error, started.elapsed().as_millis());
            host.status_changed(&shared.status());
            Some(tool_result_response(&id, &outcome))
        }
        // handle_message never nests batches.
        Dispatch::Batch(_) => Some(jsonrpc_error(&Value::Null, INVALID_REQUEST, "Invalid Request")),
    }
}

/// Emits the call to the frontend and waits. Returns the outcome and a short log reason for errors.
fn run_tool(
    shared: &Shared,
    host: &dyn Host,
    request_id: &Value,
    name: &str,
    kind: ToolKind,
    arguments: Value,
) -> (ToolOutcome, Option<&'static str>) {
    let call_id = shared.next_call_id.fetch_add(1, Ordering::Relaxed).to_string();
    let (tx, rx) = mpsc::channel();
    {
        let mut pending = lock(&shared.pending);
        if pending.len() >= MAX_IN_FLIGHT {
            return (err_outcome("co-co ist beschäftigt, bitte erneut versuchen"), Some("Beschäftigt"));
        }
        pending.insert(call_id.clone(), PendingCall { tx, request_id: request_id.clone() });
    }
    let secs = if kind == ToolKind::Write { WRITE_TIMEOUT_SECS } else { READ_TIMEOUT_SECS };
    let event = ToolCallEvent {
        call_id: call_id.clone(),
        name: name.to_string(),
        kind,
        arguments,
        deadline_ms: now_ms() + secs * 1000,
    };
    if !host.emit_tool_call(&event) {
        lock(&shared.pending).remove(&call_id);
        return (err_outcome("co-co-Fenster nicht verfügbar"), Some("Fehler"));
    }
    if kind == ToolKind::Write {
        host.focus_main();
    }
    let r = rx.recv_timeout(Duration::from_secs(secs));
    let timed_out = matches!(r, Err(mpsc::RecvTimeoutError::Timeout));
    let result = classify(shared, &call_id, r);
    if timed_out {
        // The frontend normally gives up first (deadline in the event); make sure it never runs the call late.
        host.emit_tool_cancel(&call_id);
    }
    result
}

fn classify(
    shared: &Shared,
    call_id: &str,
    r: Result<ToolOutcome, mpsc::RecvTimeoutError>,
) -> (ToolOutcome, Option<&'static str>) {
    match r {
        Ok(o) => {
            let reason = if !o.is_error {
                None
            } else if o.text.starts_with("Vom Coach") {
                Some("Abgelehnt")
            } else if o.text.starts_with(CANCELLED_TEXT) {
                Some("Abgebrochen")
            } else if o.text.starts_with("Zeitüberschreitung") {
                Some("Zeitüberschreitung")
            } else {
                Some("Fehler")
            };
            (o, reason)
        }
        Err(mpsc::RecvTimeoutError::Timeout) => {
            lock(&shared.pending).remove(call_id);
            (err_outcome("Zeitüberschreitung: co-co hat nicht rechtzeitig geantwortet"), Some("Zeitüberschreitung"))
        }
        Err(mpsc::RecvTimeoutError::Disconnected) => (err_outcome("MCP-Server wurde gestoppt"), Some("Fehler")),
    }
}

// ---- commands (main window only) -----------------------------------------------------------------

/// Managed Tauri state (`app.manage(McpState::new())` in lib.rs).
pub struct McpState {
    shared: Arc<Shared>,
}

impl McpState {
    pub fn new() -> Self {
        Self { shared: Arc::new(Shared::new()) }
    }
}

impl Default for McpState {
    fn default() -> Self {
        Self::new()
    }
}

#[tauri::command]
pub async fn mcp_status<R: Runtime>(webview: Webview<R>, state: State<'_, McpState>) -> AppResult<McpStatus> {
    ensure_main(&webview)?;
    Ok(state.shared.status())
}

/// Starts the server on 127.0.0.1:`port` (restarts when running on another port; no-op on the same port).
/// Creates the token when none exists. Port in use -> German error, also kept in `McpStatus.error`.
#[tauri::command]
pub async fn mcp_start<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, McpState>,
    port: u16,
) -> AppResult<McpStatus> {
    ensure_main(&webview)?;
    let shared = state.shared.clone();
    let host: Arc<dyn Host> = Arc::new(app);
    tauri::async_runtime::spawn_blocking(move || start_server(&shared, &host, port)).await?
}

/// Idempotent. Answers pending calls with an error outcome.
#[tauri::command]
pub async fn mcp_stop<R: Runtime>(
    app: AppHandle<R>,
    webview: Webview<R>,
    state: State<'_, McpState>,
) -> AppResult<McpStatus> {
    ensure_main(&webview)?;
    let shared = state.shared.clone();
    let host: Arc<dyn Host> = Arc::new(app);
    Ok(tauri::async_runtime::spawn_blocking(move || stop_server(&shared, &host)).await?)
}

/// Replaces the registered (= enabled) tools after `coco_core::mcp::validate_tools`.
#[tauri::command]
pub async fn mcp_set_tools<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, McpState>,
    tools: Vec<ToolRegistration>,
) -> AppResult<()> {
    ensure_main(&webview)?;
    validate_tools(&tools)?;
    *state.shared.tools.write().unwrap_or_else(|e| e.into_inner()) = tools;
    Ok(())
}

/// Delivers the frontend's answer to the waiting worker. Unknown / late callIds are ignored (Ok).
#[tauri::command]
pub async fn mcp_tool_result<R: Runtime>(
    webview: Webview<R>,
    state: State<'_, McpState>,
    call_id: String,
    outcome: ToolOutcome,
) -> AppResult<()> {
    ensure_main(&webview)?;
    state.shared.deliver(&call_id, outcome);
    Ok(())
}

/// Returns the token (creates and stores one when missing).
#[tauri::command]
pub async fn mcp_get_token<R: Runtime>(webview: Webview<R>, state: State<'_, McpState>) -> AppResult<String> {
    ensure_main(&webview)?;
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || shared.ensure_token()).await?
}

/// Replaces the token in the keychain and in memory; a running server uses it immediately.
#[tauri::command]
pub async fn mcp_regenerate_token<R: Runtime>(webview: Webview<R>, state: State<'_, McpState>) -> AppResult<String> {
    ensure_main(&webview)?;
    let shared = state.shared.clone();
    tauri::async_runtime::spawn_blocking(move || shared.regenerate_token()).await?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::net::TcpStream;

    struct TestHost {
        shared: Arc<Shared>,
    }
    impl Host for TestHost {
        fn emit_tool_call(&self, event: &ToolCallEvent) -> bool {
            let shared = self.shared.clone();
            let id = event.call_id.clone();
            let name = event.name.clone();
            std::thread::spawn(move || {
                shared.deliver(&id, ToolOutcome { text: format!("ran {name}"), is_error: false });
            });
            true
        }
        fn emit_tool_cancel(&self, _: &str) {}
        fn focus_main(&self) {}
        fn status_changed(&self, _: &McpStatus) {}
    }

    /// Never answers; records cancel events.
    #[derive(Default)]
    struct SilentHost {
        cancelled: Mutex<Vec<String>>,
    }
    impl Host for SilentHost {
        fn emit_tool_call(&self, _: &ToolCallEvent) -> bool {
            true
        }
        fn emit_tool_cancel(&self, call_id: &str) {
            lock(&self.cancelled).push(call_id.to_string());
        }
        fn focus_main(&self) {}
        fn status_changed(&self, _: &McpStatus) {}
    }

    fn pending_call(s: &Shared, call_id: &str, request_id: Value) -> mpsc::Receiver<ToolOutcome> {
        let (tx, rx) = mpsc::channel();
        lock(&s.pending).insert(call_id.into(), PendingCall { tx, request_id });
        rx
    }

    #[test]
    fn cancel_request_answers_and_notifies_frontend() {
        let s = Shared::new();
        let host = SilentHost::default();
        let rx = pending_call(&s, "c1", json!(5));
        let _other = pending_call(&s, "c2", json!("x"));
        assert_eq!(s.cancel_request(&host, &json!(99)), None);
        assert_eq!(s.cancel_request(&host, &json!(5)), Some("c1".into()));
        let o = rx.try_recv().unwrap();
        assert!(o.is_error && o.text.starts_with(CANCELLED_TEXT));
        assert_eq!(*lock(&host.cancelled), vec!["c1".to_string()]);
        assert!(!lock(&s.pending).contains_key("c1"));
        assert!(lock(&s.pending).contains_key("c2"));
        // Ambiguous request id (two clients): nothing is cancelled.
        let _a = pending_call(&s, "c3", json!(1));
        let _b = pending_call(&s, "c4", json!(1));
        assert_eq!(s.cancel_request(&host, &json!(1)), None);
        assert_eq!(lock(&s.pending).len(), 3);
    }

    #[test]
    fn drain_notifies_frontend() {
        let s = Shared::new();
        let host = SilentHost::default();
        let rx = pending_call(&s, "c1", json!(1));
        s.drain_pending(&host, "MCP-Server wurde gestoppt");
        assert!(rx.try_recv().unwrap().is_error);
        assert_eq!(*lock(&host.cancelled), vec!["c1".to_string()]);
    }

    fn entry(n: u64) -> McpLogEntry {
        McpLogEntry { at_ms: n, tool: None, kind: None, ok: true, duration_ms: 0, error: None }
    }

    #[test]
    fn log_is_newest_first_and_capped() {
        let s = Shared::new();
        for i in 0..(LOG_CAPACITY as u64 + 5) {
            s.push_log(entry(i));
        }
        let st = s.status();
        assert_eq!(st.log.len(), LOG_CAPACITY);
        assert_eq!(st.log[0].at_ms, LOG_CAPACITY as u64 + 4);
        assert_eq!(st.log.last().unwrap().at_ms, 5);
        assert!(!st.running);
        assert!(st.url.is_none());
    }

    #[test]
    fn json_shapes_are_camel_case() {
        let ev = ToolCallEvent {
            call_id: "1".into(),
            name: "x".into(),
            kind: ToolKind::Write,
            arguments: json!({}),
            deadline_ms: 42,
        };
        let v = serde_json::to_value(&ev).unwrap();
        assert_eq!(v["callId"], "1");
        assert_eq!(v["kind"], "write");
        assert_eq!(v["deadlineMs"], 42);
        let v = serde_json::to_value(ToolCancelEvent { call_id: "7".into() }).unwrap();
        assert_eq!(v, json!({ "callId": "7" }));
        let v = serde_json::to_value(Shared::new().status()).unwrap();
        assert!(v.get("toolCount").is_some());
        assert_eq!(v["running"], false);
        let v = serde_json::to_value(entry(1)).unwrap();
        assert!(v.get("atMs").is_some() && v.get("durationMs").is_some());
    }

    #[test]
    fn classify_maps_reasons() {
        let s = Shared::new();
        let (_, r) = classify(&s, "1", Ok(err_outcome("Vom Coach abgelehnt")));
        assert_eq!(r, Some("Abgelehnt"));
        let (_, r) = classify(&s, "1", Err(mpsc::RecvTimeoutError::Timeout));
        assert_eq!(r, Some("Zeitüberschreitung"));
        let (_, r) = classify(&s, "1", Ok(err_outcome(CANCELLED_TEXT)));
        assert_eq!(r, Some("Abgebrochen"));
        let (_, r) = classify(&s, "1", Ok(err_outcome("Zeitüberschreitung: keine Bestätigung")));
        assert_eq!(r, Some("Zeitüberschreitung"));
    }

    fn http(port: u16, host: &str, auth: Option<&str>, body: &str) -> (u16, String) {
        let mut s = TcpStream::connect(("127.0.0.1", port)).unwrap();
        s.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut req =
            format!("POST /mcp HTTP/1.1\r\nHost: {host}\r\nContent-Type: application/json\r\nConnection: close\r\n");
        if let Some(a) = auth {
            req.push_str(&format!("Authorization: Bearer {a}\r\n"));
        }
        req.push_str(&format!("Content-Length: {}\r\n\r\n{body}", body.len()));
        s.write_all(req.as_bytes()).unwrap();
        let mut out = String::new();
        let _ = s.read_to_string(&mut out);
        let status = out.split_whitespace().nth(1).and_then(|c| c.parse().ok()).unwrap_or(0);
        let body = out.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
        (status, body)
    }

    #[test]
    fn http_roundtrip() {
        let shared = Arc::new(Shared::new());
        let token = format_token(&[7u8; 32]);
        *lock(&shared.token) = Some(token.clone());
        *shared.tools.write().unwrap() = vec![ToolRegistration {
            name: "list_camps".into(),
            title: "Camps".into(),
            description: "d".into(),
            kind: ToolKind::Read,
            input_schema: json!({"type":"object"}),
        }];
        let host: Arc<dyn Host> = Arc::new(TestHost { shared: shared.clone() });
        let status = start_server(&shared, &host, 0).unwrap();
        let port = status.port.unwrap();
        assert!(status.running);

        let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}"#;
        let h = format!("127.0.0.1:{port}");
        assert_eq!(http(port, &h, None, init).0, 401);
        assert_eq!(http(port, &h, Some("coco_wrong"), init).0, 401);
        assert_eq!(http(port, "evil.example.com", Some(&token), init).0, 403);

        let (st, body) = http(port, &h, Some(&token), init);
        assert_eq!(st, 200);
        assert!(body.contains("2025-06-18"), "{body}");

        let (st, body) = http(port, &h, Some(&token), r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#);
        assert_eq!(st, 200);
        assert!(body.contains("list_camps"), "{body}");

        let call = r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_camps","arguments":{}}}"#;
        let (st, body) = http(port, &h, Some(&token), call);
        assert_eq!(st, 200);
        assert!(body.contains("ran list_camps"), "{body}");

        let (st, _) = http(port, &h, Some(&token), r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#);
        assert_eq!(st, 202);

        // Input the server cannot accept -> HTTP 400 with a JSON-RPC error body.
        let (st, body) = http(port, &h, Some(&token), "{not json");
        assert_eq!(st, 400);
        assert!(body.contains("-32700"), "{body}");
        assert_eq!(http(port, &h, Some(&token), r#"{"jsonrpc":"2.0","id":null,"method":"ping"}"#).0, 400);

        // Batches: replies as an array; notification-only batches -> 202.
        let batch = r#"[{"jsonrpc":"2.0","id":4,"method":"ping"},{"jsonrpc":"2.0","method":"notifications/initialized"},
            {"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"list_camps"}}]"#;
        let (st, body) = http(port, &h, Some(&token), batch);
        assert_eq!(st, 200);
        let v: Value = serde_json::from_str(&body).unwrap();
        let arr = v.as_array().unwrap();
        assert_eq!(arr.len(), 2);
        assert_eq!(arr[0]["id"], 4);
        assert_eq!(arr[1]["id"], 5);
        assert!(body.contains("ran list_camps"), "{body}");
        let (st, _) = http(port, &h, Some(&token), r#"[{"jsonrpc":"2.0","method":"notifications/initialized"}]"#);
        assert_eq!(st, 202);
        let cancel = r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":123}}"#;
        assert_eq!(http(port, &h, Some(&token), cancel).0, 202);

        let log = shared.status().log;
        assert!(log.iter().any(|e| e.tool.as_deref() == Some("list_camps") && e.ok));
        assert!(log.iter().any(|e| e.error.as_deref() == Some("Nicht autorisiert")));

        let stopped = stop_server(&shared, &host);
        assert!(!stopped.running);
        assert!(TcpStream::connect(("127.0.0.1", port)).is_err());
    }
}
