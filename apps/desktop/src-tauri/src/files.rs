//! M3/M4 file access: allowed-path scope, native dialogs, document reading,
//! folder listing and watching. Paths from the frontend are always
//! canonicalised and checked against the scope before any read.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::Mutex;
use std::time::{Duration, Instant, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use coco_core::docs::{check_size, coalesce, ChangeKind, MAX_DOCUMENT_BYTES, MAX_TEXT_FILE_BYTES};
use coco_core::savefile::{ensure_extension, require_save_filter};
use coco_core::scope::{is_hidden_name, PathScope};
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::DialogExt;

use crate::error::{AppError, AppResult};
use crate::session::MAIN_LABEL;

pub const EVENT_DOCS_CHANGED: &str = "docs://changed";
pub const EVENT_DOCS_DROPPED: &str = "docs://dropped";
const SCOPE_FILE: &str = "allowed-paths.json";
const DEBOUNCE: Duration = Duration::from_millis(500);
const MAX_DEBOUNCE_WINDOW: Duration = Duration::from_secs(5);

/// Managed state: the persisted allowed-path scope plus the active watchers.
pub struct FileState {
    scope: Mutex<PathScope>,
    file: PathBuf,
    watchers: Mutex<HashMap<PathBuf, RecommendedWatcher>>,
}

impl FileState {
    pub fn load(data_dir: &Path) -> Self {
        let file = data_dir.join(SCOPE_FILE);
        let scope = std::fs::read_to_string(&file).map(|s| PathScope::from_json(&s)).unwrap_or_default();
        Self { scope: Mutex::new(scope), file, watchers: Mutex::new(HashMap::new()) }
    }

    fn persist(&self, scope: &PathScope) -> AppResult<()> {
        if let Some(dir) = self.file.parent() {
            std::fs::create_dir_all(dir).map_err(io_err)?;
        }
        let tmp = self.file.with_extension("json.tmp");
        std::fs::write(&tmp, scope.to_json()).map_err(io_err)?;
        std::fs::rename(&tmp, &self.file).map_err(io_err)
    }

    pub fn allow_file(&self, p: PathBuf) -> AppResult<()> {
        let mut s = self.scope.lock().unwrap();
        if s.add_file(p) {
            self.persist(&s)?;
        }
        Ok(())
    }

    pub fn allow_folder(&self, p: PathBuf) -> AppResult<()> {
        let mut s = self.scope.lock().unwrap();
        if s.add_folder(p) {
            self.persist(&s)?;
        }
        Ok(())
    }

    /// Adds a dropped path (file or folder) to the scope. Dropped folders are readable for this
    /// session only (watching a folder persists it explicitly).
    pub fn allow_path(&self, p: PathBuf) -> AppResult<()> {
        reject_unsafe_grant(&p)?;
        if p.is_dir() {
            self.scope.lock().unwrap().add_session_folder(p);
            Ok(())
        } else {
            self.allow_file(p)
        }
    }

    fn check(&self, p: &Path) -> AppResult<()> {
        if self.scope.lock().unwrap().contains(p) {
            Ok(())
        } else {
            Err(AppError::Unexpected("Pfad ist nicht freigegeben (Datei zuerst auswählen oder hineinziehen)".into()))
        }
    }
}

fn io_err(e: std::io::Error) -> AppError {
    AppError::Unexpected(format!("Dateizugriff fehlgeschlagen ({:?})", e.kind()))
}

/// Canonical, `\\?\`-free path. Fails for missing paths.
pub fn canonical(path: &str) -> AppResult<PathBuf> {
    dunce::canonicalize(path).map_err(|_| AppError::Unexpected("Pfad nicht gefunden".into()))
}

fn path_string(p: &Path) -> String {
    p.to_string_lossy().into_owned()
}

fn modified_ms(m: &std::fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Refuses UNC paths, drive roots and the user's home directory itself as access grants.
fn reject_unsafe_grant(p: &Path) -> AppResult<()> {
    let s = p.to_string_lossy();
    if s.starts_with(r"\\") || s.starts_with("//") {
        return Err(AppError::Unexpected("Netzwerkpfade sind nicht erlaubt".into()));
    }
    if p.parent().is_none() || p.components().count() <= 1 {
        return Err(AppError::Unexpected("Laufwerke und Wurzelverzeichnisse sind nicht erlaubt".into()));
    }
    if p.is_dir() {
        for var in ["USERPROFILE", "HOME"] {
            if let Ok(h) = std::env::var(var) {
                if let Ok(hc) = dunce::canonicalize(&h) {
                    if hc == p {
                        return Err(AppError::Unexpected("Der Benutzerordner selbst ist nicht erlaubt".into()));
                    }
                }
            }
        }
    }
    Ok(())
}

const DOCUMENT_EXTENSIONS: [&str; 6] = ["pdf", "docx", "gpx", "txt", "md", "markdown"];

fn is_document_path(p: &Path) -> bool {
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    DOCUMENT_EXTENSIONS.contains(&ext.as_str())
}

fn is_protected_component(p: &Path) -> bool {
    p.components().any(|c| {
        c.as_os_str().to_str().is_some_and(|n| n == ".ssh" || n == ".env" || n.eq_ignore_ascii_case("AppData"))
    })
}

fn is_hidden(path: &Path, meta: Option<&std::fs::Metadata>) -> bool {
    let name_hidden = path.file_name().and_then(|n| n.to_str()).is_some_and(is_hidden_name);
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.is_some_and(|m| m.file_attributes() & 0x2 != 0) {
            return true;
        }
    }
    #[cfg(not(windows))]
    let _ = meta;
    name_hidden
}

// ---------------------------------------------------------------- dialogs

pub async fn pick_files<R: Runtime>(
    app: &AppHandle<R>,
    state: &FileState,
    filters: Option<Vec<FileFilter>>,
) -> AppResult<Vec<String>> {
    let app2 = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || {
        let mut d = app2.dialog().file();
        for f in filters.iter().flatten() {
            let exts: Vec<&str> = f.extensions.iter().map(String::as_str).collect();
            d = d.add_filter(&f.name, &exts);
        }
        d.blocking_pick_files()
    })
    .await?;
    let mut out = Vec::new();
    for fp in picked.unwrap_or_default() {
        let Ok(p) = fp.into_path() else { continue };
        let Ok(c) = dunce::canonicalize(&p) else { continue };
        state.allow_file(c.clone())?;
        out.push(path_string(&c));
    }
    Ok(out)
}

pub async fn pick_folder<R: Runtime>(app: &AppHandle<R>, state: &FileState) -> AppResult<Option<String>> {
    let app2 = app.clone();
    let picked = tauri::async_runtime::spawn_blocking(move || app2.dialog().file().blocking_pick_folder()).await?;
    let Some(fp) = picked else { return Ok(None) };
    let c = canonical(&path_string(&fp.into_path().map_err(|_| AppError::Unexpected("Ungültiger Dateipfad".into()))?))?;
    state.allow_folder(c.clone())?;
    Ok(Some(path_string(&c)))
}

pub async fn save_text_file<R: Runtime>(
    app: &AppHandle<R>,
    default_name: String,
    content: String,
) -> AppResult<Option<String>> {
    let app2 = app.clone();
    let name = sanitize_file_name(&default_name);
    let (label, exts) = require_save_filter(&name)?;
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app2.dialog().file().add_filter(label, exts).set_file_name(name).blocking_save_file()
    })
    .await?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|_| AppError::Unexpected("Ungültiger Dateipfad".into()))?;
    let path = PathBuf::from(ensure_extension(&path_string(&path), exts));
    std::fs::write(&path, content.as_bytes()).map_err(io_err)?;
    Ok(Some(path_string(&path)))
}

pub async fn open_text_file<R: Runtime>(app: &AppHandle<R>) -> AppResult<Option<TextFile>> {
    let app2 = app.clone();
    let picked =
        tauri::async_runtime::spawn_blocking(move || app2.dialog().file().add_filter("JSON", &["json"]).blocking_pick_file())
            .await?;
    let Some(fp) = picked else { return Ok(None) };
    let path = fp.into_path().map_err(|_| AppError::Unexpected("Ungültiger Dateipfad".into()))?;
    let meta = std::fs::metadata(&path).map_err(io_err)?;
    check_size(meta.len(), MAX_TEXT_FILE_BYTES)?;
    let content = tauri::async_runtime::spawn_blocking(move || std::fs::read_to_string(&path).map(|c| (path, c)))
        .await?
        .map_err(|_| AppError::Unexpected("Datei ist kein gültiger UTF-8-Text".into()))?;
    let name = content.0.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(Some(TextFile { name, content: content.1 }))
}

/// Keeps only characters that are safe in a suggested file name.
fn sanitize_file_name(name: &str) -> String {
    let s: String = name.chars().map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') || c.is_control() { '_' } else { c }).collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        "export.json".into()
    } else {
        s
    }
}

// -------------------------------------------------------------- documents

#[derive(Debug, Deserialize)]
pub struct FileFilter {
    pub name: String,
    pub extensions: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentBytes {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub modified_ms: u64,
    pub bytes_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
    pub modified_ms: u64,
}

#[derive(Debug, Serialize)]
pub struct TextFile {
    pub name: String,
    pub content: String,
}

pub async fn read_document(state: &FileState, path: &str) -> AppResult<DocumentBytes> {
    let p = canonical(path)?;
    state.check(&p)?;
    if !is_document_path(&p) {
        return Err(AppError::Unexpected("Dateityp nicht unterstützt".into()));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&p).map_err(io_err)?;
        if is_hidden(&p, Some(&meta)) || is_protected_component(&p) {
            return Err(AppError::Unexpected("Versteckte oder geschützte Dateien sind nicht erlaubt".into()));
        }
        if !meta.is_file() {
            return Err(AppError::Unexpected("Das ist keine Datei".into()));
        }
        check_size(meta.len(), MAX_DOCUMENT_BYTES)?;
        let bytes = std::fs::read(&p).map_err(io_err)?;
        // Re-check after reading (the file may have grown in the meantime).
        check_size(bytes.len() as u64, MAX_DOCUMENT_BYTES)?;
        Ok(DocumentBytes {
            path: path_string(&p),
            name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
            size: bytes.len() as u64,
            modified_ms: modified_ms(&meta),
            bytes_base64: STANDARD.encode(&bytes),
        })
    })
    .await?
}

pub async fn list_folder(state: &FileState, path: &str) -> AppResult<Vec<FolderEntry>> {
    let p = canonical(path)?;
    state.check(&p)?;
    tauri::async_runtime::spawn_blocking(move || {
        if !p.is_dir() {
            return Err(AppError::Unexpected("Das ist kein Ordner".into()));
        }
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&p).map_err(io_err)?.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            let ep = entry.path();
            if is_hidden(&ep, Some(&meta)) {
                continue;
            }
            out.push(FolderEntry {
                path: path_string(&ep),
                name: entry.file_name().to_string_lossy().into_owned(),
                is_dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                modified_ms: modified_ms(&meta),
            });
        }
        out.sort_by_key(|e| e.name.to_lowercase());
        Ok(out)
    })
    .await?
}

// --------------------------------------------------------------- watching

#[derive(Debug, Clone, Serialize)]
struct DocsChanged {
    folder: String,
    path: String,
    kind: &'static str,
}

pub fn watch_folder<R: Runtime>(app: &AppHandle<R>, state: &FileState, path: &str) -> AppResult<()> {
    let folder = canonical(path)?;
    state.check(&folder)?;
    if !folder.is_dir() {
        return Err(AppError::Unexpected("Das ist kein Ordner".into()));
    }
    // Persist (promotes a session-only folder again); idempotent.
    state.allow_folder(folder.clone())?;
    let mut watchers = state.watchers.lock().unwrap();
    if watchers.contains_key(&folder) {
        return Ok(());
    }
    let w = start_watcher(app.clone(), folder.clone())?;
    watchers.insert(folder, w);
    Ok(())
}

pub fn unwatch_folder(state: &FileState, path: &str) -> AppResult<()> {
    let folder = canonical(path).unwrap_or_else(|_| PathBuf::from(path));
    // Dropping the watcher closes the channel, which ends the debounce thread.
    state.watchers.lock().unwrap().remove(&folder);
    let mut s = state.scope.lock().unwrap();
    s.demote_folder(&folder);
    state.persist(&s)
}

fn map_kind(kind: &EventKind, path: &Path) -> Option<ChangeKind> {
    use notify::event::ModifyKind;
    match kind {
        EventKind::Create(_) => Some(ChangeKind::Create),
        EventKind::Remove(_) => Some(ChangeKind::Remove),
        // A rename is a create (new name exists) or a remove (old name is gone).
        EventKind::Modify(ModifyKind::Name(_)) => {
            Some(if path.exists() { ChangeKind::Create } else { ChangeKind::Remove })
        }
        EventKind::Modify(_) => Some(ChangeKind::Modify),
        _ => None,
    }
}

fn start_watcher<R: Runtime>(app: AppHandle<R>, folder: PathBuf) -> AppResult<RecommendedWatcher> {
    let (tx, rx) = mpsc::channel::<notify::Result<notify::Event>>();
    let mut watcher =
        notify::recommended_watcher(move |e| {
            let _ = tx.send(e);
        })
        .map_err(|e| AppError::Unexpected(format!("Ordner-Überwachung fehlgeschlagen: {e}")))?;
    watcher
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|e| AppError::Unexpected(format!("Ordner-Überwachung fehlgeschlagen: {e}")))?;

    std::thread::spawn(move || {
        let mut pending: HashMap<PathBuf, ChangeKind> = HashMap::new();
        let add = |pending: &mut HashMap<PathBuf, ChangeKind>, ev: notify::Result<notify::Event>| {
            let Ok(ev) = ev else { return };
            for p in ev.paths {
                let Some(kind) = map_kind(&ev.kind, &p) else { continue };
                if is_hidden(&p, None) || (kind == ChangeKind::Modify && p.is_dir()) {
                    continue;
                }
                match pending.get(&p).copied() {
                    Some(prev) => match coalesce(prev, kind) {
                        Some(k) => {
                            pending.insert(p, k);
                        }
                        None => {
                            pending.remove(&p);
                        }
                    },
                    None => {
                        pending.insert(p, kind);
                    }
                }
            }
        };
        let flush = |pending: &mut HashMap<PathBuf, ChangeKind>| {
            for (p, k) in pending.drain() {
                let payload = DocsChanged { folder: path_string(&folder), path: path_string(&p), kind: k.as_str() };
                let _ = app.emit_to(MAIN_LABEL, EVENT_DOCS_CHANGED, payload);
            }
        };
        loop {
            let Ok(first) = rx.recv() else { return };
            add(&mut pending, first);
            let started = Instant::now();
            loop {
                let left = MAX_DEBOUNCE_WINDOW.saturating_sub(started.elapsed()).min(DEBOUNCE);
                match rx.recv_timeout(left) {
                    Ok(ev) => add(&mut pending, ev),
                    Err(RecvTimeoutError::Timeout) => break,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
                if started.elapsed() >= MAX_DEBOUNCE_WINDOW {
                    break;
                }
            }
            flush(&mut pending);
        }
    });
    Ok(watcher)
}

// -------------------------------------------------------------- drag-drop

/// Handles a native drop on the main window: scope first, then notify the UI.
pub fn handle_drop<R: Runtime>(app: &AppHandle<R>, paths: &[PathBuf]) {
    let state = app.state::<FileState>();
    let mut out = Vec::new();
    for p in paths {
        let Ok(c) = dunce::canonicalize(p) else { continue };
        if state.allow_path(c.clone()).is_ok() {
            out.push(path_string(&c));
        }
    }
    if !out.is_empty() {
        let _ = app.emit_to(MAIN_LABEL, EVENT_DOCS_DROPPED, serde_json::json!({ "paths": out }));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("coco-files-test-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        dunce::canonicalize(d).unwrap()
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_file_name("a/b:c.json"), "a_b_c.json");
        assert_eq!(sanitize_file_name("  "), "export.json");
    }

    #[test]
    fn scope_persists_and_checks() {
        let d = tmp("scope");
        let allowed = d.join("docs");
        std::fs::create_dir_all(&allowed).unwrap();
        let allowed = dunce::canonicalize(allowed).unwrap();
        let st = FileState::load(&d);
        st.allow_folder(allowed.clone()).unwrap();
        assert!(st.check(&allowed.join("x.pdf")).is_ok());
        assert!(st.check(&d.join("other.pdf")).is_err());
        let st2 = FileState::load(&d);
        assert!(st2.check(&allowed.join("x.pdf")).is_ok());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn dotdot_cannot_escape() {
        let d = tmp("dotdot");
        let allowed = d.join("docs");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::write(d.join("secret.txt"), "x").unwrap();
        let allowed = dunce::canonicalize(allowed).unwrap();
        let st = FileState::load(&d);
        st.allow_folder(allowed.clone()).unwrap();
        let sneaky = format!("{}/../secret.txt", allowed.display());
        let c = canonical(&sneaky).unwrap();
        assert!(st.check(&c).is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn hidden_detection() {
        assert!(is_hidden(Path::new("/a/.hidden"), None));
        assert!(!is_hidden(Path::new("/a/visible.txt"), None));
    }
}
