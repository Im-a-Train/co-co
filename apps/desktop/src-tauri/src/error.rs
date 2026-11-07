//! Error type returned by all Tauri commands. Serialized as a plain string
//! (the frontend shows it as-is). Messages never contain cookie values or passwords.

use coco_core::CoreError;
use serde::{Serialize, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error(transparent)]
    Core(#[from] CoreError),
    #[error("Netzwerkfehler: {0}")]
    Http(String),
    #[error("Nicht angemeldet")]
    NotLoggedIn,
    #[error("Anmeldung fehlgeschlagen: E-Mail/Benutzername oder Passwort falsch")]
    InvalidCredentials,
    #[error("eCamp antwortete mit HTTP {status}{}", detail.as_deref().map(|d| format!(": {d}")).unwrap_or_default())]
    Status { status: u16, detail: Option<String> },
    #[error("Token-Erneuerung fehlgeschlagen: {0}")]
    Refresh(String),
    #[error("Keine eCamp-Anmeldecookies gefunden ({0})")]
    MissingCookies(String),
    #[error("Dieser Befehl ist nur im Hauptfenster erlaubt")]
    Forbidden,
    #[error("Fenster-/Webview-Fehler: {0}")]
    Tauri(String),
    #[error("Unerwartete Antwort: {0}")]
    Unexpected(String),
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        // `without_url` keeps query strings (and anything else in the URL) out of messages.
        let kind = if e.is_timeout() {
            "Zeitüberschreitung"
        } else if e.is_connect() {
            "Verbindung fehlgeschlagen"
        } else if e.is_decode() {
            "Antwort nicht lesbar"
        } else if e.is_redirect() {
            "Weiterleitung nicht erlaubt"
        } else {
            "Anfrage fehlgeschlagen"
        };
        AppError::Http(format!("{kind} ({})", e.without_url()))
    }
}

impl From<tauri::Error> for AppError {
    fn from(e: tauri::Error) -> Self {
        AppError::Tauri(e.to_string())
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_string() {
        let v = serde_json::to_value(AppError::NotLoggedIn).unwrap();
        assert_eq!(v, serde_json::json!("Nicht angemeldet"));
        let v = serde_json::to_value(AppError::Status { status: 404, detail: Some("Not Found".into()) }).unwrap();
        assert_eq!(v, serde_json::json!("eCamp antwortete mit HTTP 404: Not Found"));
        let v = serde_json::to_value(AppError::Status { status: 500, detail: None }).unwrap();
        assert_eq!(v, serde_json::json!("eCamp antwortete mit HTTP 500"));
    }

    #[test]
    fn core_errors_pass_through() {
        let e: AppError = CoreError::PathNotAllowed("/x".into()).into();
        assert_eq!(e.to_string(), "Pfad nicht erlaubt: /x");
    }
}
