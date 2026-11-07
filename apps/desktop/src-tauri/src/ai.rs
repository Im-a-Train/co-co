//! M5: Anthropic API key in the OS keychain and the `messages` call.
//! The key and prompt content are never logged or put into errors.

use std::time::Duration;

use coco_core::ai::{
    build_body, error_message, parse_response, validate_request, AiRequest, API_URL, API_VERSION, KEY_SERVICE, KEY_USER,
};
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
    let key = key.trim().to_string();
    if key.is_empty() || key.chars().any(|c| c.is_control() || c.is_whitespace()) {
        return Err(AppError::Unexpected("Ungültiger API-Schlüssel".into()));
    }
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
