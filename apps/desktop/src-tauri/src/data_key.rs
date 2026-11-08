//! ADR 0009: the data key for encryption at rest lives in the OS keychain
//! (service `ch.imatrain.coco`, user `data-key`, base64 of 32 random bytes).
//!
//! `unlock_data_store` hands it to the UI only while the eCamp session is verified (one
//! authenticated GET). Rust keeps no copy here; `FileState` holds its own copy until lock/logout.
//! The key is never logged and never part of an error message.

use coco_core::datakey::{decode_key, encode_key, generate_key, session_verify_path, KEY_LEN, KEY_SERVICE, KEY_USER};
use serde::Serialize;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult};

#[derive(Debug, Serialize)]
pub struct UnlockResult {
    pub key: String,
    pub created: bool,
}

fn keyring_err(e: keyring::Error) -> AppError {
    AppError::Unexpected(format!("Schlüsselbund nicht verfügbar: {e}"))
}

/// Reads the data key from the keychain, creating it on first use. `bool` = newly created.
pub fn get_or_create() -> AppResult<(Zeroizing<[u8; KEY_LEN]>, bool)> {
    let entry = keyring::Entry::new(KEY_SERVICE, KEY_USER).map_err(keyring_err)?;
    match entry.get_password() {
        Ok(s) => {
            let s = Zeroizing::new(s);
            let key = decode_key(&s)
                .map_err(|_| AppError::Unexpected("Datenschlüssel im Schlüsselbund ist beschädigt".into()))?;
            Ok((Zeroizing::new(key), false))
        }
        Err(keyring::Error::NoEntry) => {
            let key = Zeroizing::new(generate_key());
            let enc = Zeroizing::new(encode_key(&key));
            entry.set_password(&enc).map_err(keyring_err)?;
            Ok((key, true))
        }
        Err(e) => Err(keyring_err(e)),
    }
}

/// Session gate + key hand-out. verification is an authenticated `GET /api/users/<id>` (401 triggers the normal
/// refresh-and-retry in `api::api_get`); without a logged-in session it fails with `NotLoggedIn`.
pub async fn unlock<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    state: &crate::session::AppState,
    files: &crate::files::FileState,
) -> AppResult<UnlockResult> {
    let session = state.current().await.ok_or(AppError::NotLoggedIn)?;
    let user_iri = session.info.user_iri.clone().ok_or(AppError::NotLoggedIn)?;
    let path = session_verify_path(&user_iri).map_err(|_| AppError::NotLoggedIn)?;
    // `api_get` validates the path against the session's API root and refreshes on 401 once.
    crate::api::api_get(app, state, &path).await.map_err(|e| match e {
        AppError::NotLoggedIn | AppError::Status { status: 401 | 403, .. } => AppError::NotLoggedIn,
        _ => AppError::Unexpected("eCamp-Sitzung konnte nicht geprüft werden".into()),
    })?;
    let (key, created) = tauri::async_runtime::spawn_blocking(get_or_create).await??;
    files.unlock(&key);
    Ok(UnlockResult { key: encode_key(&key), created })
}

pub fn lock<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use tauri::Manager;
    if let Some(files) = app.try_state::<crate::files::FileState>() {
        files.lock();
    }
}
