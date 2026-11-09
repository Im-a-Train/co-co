//! M5: Anthropic API key in the OS keychain and the `messages` call.
//! ADR 0012: OpenAI-compatible Chat Completions (incl. local LLMs) with an optional key bound to its origin.
//! Keys and prompt content are never logged or put into errors.

use std::time::Duration;

use coco_core::ai::{
    build_body, build_openai_body, decode_bound_key, encode_bound_key, error_message, normalize_openai_base_url,
    openai_endpoint, openai_error_message, openai_timeout_secs, origin_of, parse_openai_models, parse_openai_response,
    parse_response, uses_max_completion_tokens, validate_api_key, validate_request, AiProvider, AiRequest, API_URL,
    API_VERSION, KEY_SERVICE, KEY_USER, OPENAI_KEY_USER,
};
use url::Url;
use serde::Serialize;

use crate::error::{AppError, AppResult};
use crate::session::read_body_capped;

const MAX_AI_BODY: usize = 4 * 1024 * 1024;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub text: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
}

fn entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEY_SERVICE, KEY_USER).map_err(keyring_err)
}

fn keyring_err(e: keyring::Error) -> AppError {
    // keyring errors do not contain the secret
    AppError::Unexpected(format!("Schlüsselbund nicht verfügbar: {e}"))
}

fn get_key() -> AppResult<Option<String>> {
    match entry()?.get_password() {
        Ok(k) => Ok(Some(k)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(keyring_err(e)),
    }
}

pub async fn set_key(key: String) -> AppResult<()> {
    let key = coco_core::ai::validate_api_key(&key)?;
    tauri::async_runtime::spawn_blocking(move || entry()?.set_password(&key).map_err(keyring_err)).await?
}

pub async fn has_key() -> AppResult<bool> {
    Ok(tauri::async_runtime::spawn_blocking(get_key).await??.is_some())
}

pub async fn clear_key() -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(|| match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_err(e)),
    })
    .await?
}

pub async fn complete(request: AiRequest) -> AppResult<AiResponse> {
    validate_request(&request)?;
    match request.provider {
        AiProvider::Anthropic => complete_anthropic(request).await,
        AiProvider::Openai => complete_openai(request).await,
    }
}

async fn complete_anthropic(request: AiRequest) -> AppResult<AiResponse> {
    let key = tauri::async_runtime::spawn_blocking(get_key)
        .await??
        .ok_or_else(|| AppError::Unexpected("Kein API-Schlüssel hinterlegt".into()))?;

    // Own client: no eCamp cookie jar, https only.
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(120))
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let resp = client
        .post(API_URL)
        .header("x-api-key", key)
        .header("anthropic-version", API_VERSION)
        .header("content-type", "application/json")
        .body(build_body(&request).to_string())
        .send()
        .await?;
    let status = resp.status();
    let bytes = read_body_capped(resp, MAX_AI_BODY).await?;
    if !status.is_success() {
        let detail = error_message(&bytes).map(|m| format!(": {m}")).unwrap_or_default();
        return Err(AppError::Unexpected(match status.as_u16() {
            401 | 403 => "KI-Dienst lehnt den API-Schlüssel ab".to_string(),
            429 => format!("KI-Dienst: zu viele Anfragen{detail}"),
            s => format!("KI-Dienst antwortete mit HTTP {s}{detail}"),
        }));
    }
    let v: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| AppError::Unexpected("KI-Antwort nicht lesbar".into()))?;
    let (text, input_tokens, output_tokens) = parse_response(&v)?;
    eprintln!("ai_complete: model={} in={input_tokens} out={output_tokens}", request.model);
    Ok(AiResponse { text, input_tokens, output_tokens })
}

// ---- ADR 0012: OpenAI-compatible provider ------------------------------------------------------

const MAX_MODELS_BODY: usize = 2 * 1024 * 1024;

fn openai_entry() -> AppResult<keyring::Entry> {
    keyring::Entry::new(KEY_SERVICE, OPENAI_KEY_USER).map_err(keyring_err)
}

/// The stored key, only when it was entered for exactly `origin`.
fn get_openai_key_for(origin: &str) -> AppResult<Option<String>> {
    let stored = match openai_entry()?.get_password() {
        Ok(k) => k,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(e) => return Err(keyring_err(e)),
    };
    Ok(decode_bound_key(&stored).filter(|(o, _)| o == origin).map(|(_, k)| k))
}

fn is_loopback(base: &Url) -> bool {
    coco_core::instance::is_loopback_host(base)
}

fn openai_client(base: &Url, timeout_secs: u64) -> AppResult<reqwest::Client> {
    let loopback = is_loopback(base);
    let mut b = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(timeout_secs))
        .https_only(!loopback)
        .redirect(reqwest::redirect::Policy::none());
    if loopback {
        b = b.no_proxy();
    }
    Ok(b.build()?)
}

fn send_err(e: reqwest::Error, loopback: bool) -> AppError {
    if loopback && e.is_connect() {
        AppError::Unexpected("Lokaler KI-Server nicht erreichbar – läuft Ollama/LM Studio?".into())
    } else {
        e.into()
    }
}

/// `has_key` = a key for exactly this origin was sent. Without one, a 401/403 means "key required",
/// not "key rejected" (no key stored, or the stored key belongs to another address).
fn openai_status_error(status: u16, bytes: &[u8], loopback: bool, has_key: bool) -> AppError {
    let detail = openai_error_message(bytes).map(|m| format!(": {m}")).unwrap_or_default();
    AppError::Unexpected(match status {
        401 | 403 if !has_key && loopback => {
            "Der lokale KI-Server verlangt einen API-Schlüssel – für diese Adresse ist keiner gespeichert".to_string()
        }
        401 | 403 if !has_key => {
            "Der KI-Dienst verlangt einen API-Schlüssel – für diese Adresse ist keiner gespeichert".to_string()
        }
        401 | 403 => "KI-Dienst lehnt den API-Schlüssel ab".to_string(),
        404 => "Modell oder Endpunkt nicht gefunden (Basis-URL und Modell prüfen)".to_string(),
        429 => format!("KI-Dienst: zu viele Anfragen{detail}"),
        s => format!("KI-Dienst antwortete mit HTTP {s}{detail}"),
    })
}

/// Stores `key` bound to the origin of `base_url` (keychain user `coco_core::ai::OPENAI_KEY_USER`).
pub async fn openai_set_key(base_url: String, key: String) -> AppResult<()> {
    let key = validate_api_key(&key)?;
    let base = normalize_openai_base_url(&base_url)?;
    let value = encode_bound_key(&origin_of(&base), &key);
    tauri::async_runtime::spawn_blocking(move || openai_entry()?.set_password(&value).map_err(keyring_err)).await?
}

/// True only when a key is stored for exactly the origin of `base_url`.
pub async fn openai_has_key(base_url: String) -> AppResult<bool> {
    let Ok(base) = normalize_openai_base_url(&base_url) else {
        return Ok(false);
    };
    let origin = origin_of(&base);
    Ok(tauri::async_runtime::spawn_blocking(move || get_openai_key_for(&origin)).await??.is_some())
}

/// Idempotent.
pub async fn openai_clear_key() -> AppResult<()> {
    tauri::async_runtime::spawn_blocking(|| match openai_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(keyring_err(e)),
    })
    .await?
}

/// `GET {base}/models` (bearer key only if bound to this origin) -> sorted model ids.
pub async fn openai_models(base_url: String) -> AppResult<Vec<String>> {
    let base = normalize_openai_base_url(&base_url)?;
    let loopback = is_loopback(&base);
    let origin = origin_of(&base);
    let key = tauri::async_runtime::spawn_blocking(move || get_openai_key_for(&origin)).await??;
    let client = openai_client(&base, 15)?;
    let mut rb = client.get(openai_endpoint(&base, "models")).header("accept", "application/json");
    if let Some(k) = &key {
        rb = rb.header("authorization", format!("Bearer {k}"));
    }
    let resp = rb.send().await.map_err(|e| send_err(e, loopback))?;
    let status = resp.status();
    let bytes = read_body_capped(resp, MAX_MODELS_BODY).await?;
    if !status.is_success() {
        return Err(openai_status_error(status.as_u16(), &bytes, loopback, key.is_some()));
    }
    let v: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| AppError::Unexpected("Antwort des KI-Servers nicht lesbar".into()))?;
    Ok(parse_openai_models(&v))
}

/// `POST {base}/chat/completions`; request already validated.
async fn complete_openai(request: AiRequest) -> AppResult<AiResponse> {
    let base_str = request
        .base_url
        .clone()
        .ok_or_else(|| AppError::Unexpected("Keine Basis-URL für den KI-Server angegeben".into()))?;
    let base = normalize_openai_base_url(&base_str)?;
    let loopback = is_loopback(&base);
    let origin = origin_of(&base);
    let key = tauri::async_runtime::spawn_blocking(move || get_openai_key_for(&origin)).await??;
    let client = openai_client(&base, openai_timeout_secs(&base))?;
    let body = build_openai_body(&request, uses_max_completion_tokens(&base));
    let mut rb = client
        .post(openai_endpoint(&base, "chat/completions"))
        .header("content-type", "application/json")
        .body(body.to_string());
    if let Some(k) = &key {
        rb = rb.header("authorization", format!("Bearer {k}"));
    }
    let resp = rb.send().await.map_err(|e| send_err(e, loopback))?;
    let status = resp.status();
    let bytes = read_body_capped(resp, MAX_AI_BODY).await?;
    if !status.is_success() {
        return Err(openai_status_error(status.as_u16(), &bytes, loopback, key.is_some()));
    }
    let v: serde_json::Value =
        serde_json::from_slice(&bytes).map_err(|_| AppError::Unexpected("KI-Antwort nicht lesbar".into()))?;
    let (text, input_tokens, output_tokens) = parse_openai_response(&v)?;
    eprintln!("ai_complete: provider=openai model={} in={input_tokens} out={output_tokens}", request.model);
    Ok(AiResponse { text, input_tokens, output_tokens })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_error_without_key_says_key_required() {
        let msg = |loopback, has_key| openai_status_error(401, b"{}", loopback, has_key).to_string();
        // Remote endpoint without a key for this origin: "required", not "rejected".
        assert!(msg(false, false).contains("verlangt einen API-Schlüssel"), "{}", msg(false, false));
        assert!(msg(true, false).contains("lokale KI-Server verlangt"));
        assert!(msg(false, true).ends_with("KI-Dienst lehnt den API-Schlüssel ab"));
        assert!(openai_status_error(403, b"", false, false).to_string().contains("verlangt einen API-Schlüssel"));
    }
}
