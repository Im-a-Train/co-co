//! Data key helpers (ADR 0009): random 32-byte key, base64 transport form and a versioned
//! AES-256-GCM envelope `{"v":1,"iv":"<b64 12 bytes>","ct":"<b64 ciphertext+tag>"}`.
//! Errors never contain key material or plaintext.

use aes_gcm::aead::{rand_core::RngCore, Aead, OsRng, Payload};
use aes_gcm::{Aes256Gcm, Key, KeyInit, Nonce};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::CoreError;

/// OS keychain entry holding the base64 data key (same service as the AI key in `ai.rs`).
pub const KEY_SERVICE: &str = "ch.imatrain.coco";
pub const KEY_USER: &str = "data-key";
pub const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 12;
/// AAD for `allowed-paths.json` so the ciphertext cannot be swapped into another file.
pub const AAD_ALLOWED_PATHS: &[u8] = b"co-co:allowed-paths:v1";

#[derive(Debug, Serialize, Deserialize)]
struct Envelope {
    v: u32,
    iv: String,
    ct: String,
}

fn bad(msg: &str) -> CoreError {
    CoreError::Invalid(msg.into())
}

pub fn generate_key() -> [u8; KEY_LEN] {
    let mut k = [0u8; KEY_LEN];
    OsRng.fill_bytes(&mut k);
    k
}

pub fn encode_key(key: &[u8; KEY_LEN]) -> String {
    STANDARD.encode(key)
}

pub fn decode_key(s: &str) -> Result<[u8; KEY_LEN], CoreError> {
    let bytes = STANDARD.decode(s.trim()).map_err(|_| bad("Datenschlüssel ungültig"))?;
    bytes.try_into().map_err(|_| bad("Datenschlüssel hat falsche Länge"))
}

/// True if `text` looks like one of our envelopes (versus legacy plaintext JSON).
pub fn is_envelope(text: &str) -> bool {
    serde_json::from_str::<Envelope>(text).is_ok()
}

pub fn seal(key: &[u8; KEY_LEN], aad: &[u8], plaintext: &[u8]) -> Result<String, CoreError> {
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    let mut iv = [0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut iv);
    let ct = cipher
        .encrypt(Nonce::from_slice(&iv), Payload { msg: plaintext, aad })
        .map_err(|_| bad("Verschlüsselung fehlgeschlagen"))?;
    serde_json::to_string(&Envelope { v: 1, iv: STANDARD.encode(iv), ct: STANDARD.encode(ct) })
        .map_err(|_| bad("Verschlüsselung fehlgeschlagen"))
}

pub fn open(key: &[u8; KEY_LEN], aad: &[u8], text: &str) -> Result<Vec<u8>, CoreError> {
    let env: Envelope = serde_json::from_str(text).map_err(|_| bad("Umschlag ungültig"))?;
    if env.v != 1 {
        return Err(bad("Umschlag-Version nicht unterstützt"));
    }
    let iv = STANDARD.decode(&env.iv).map_err(|_| bad("Umschlag ungültig"))?;
    if iv.len() != NONCE_LEN {
        return Err(bad("Umschlag ungültig"));
    }
    let ct = STANDARD.decode(&env.ct).map_err(|_| bad("Umschlag ungültig"))?;
    let cipher = Aes256Gcm::new(Key::<Aes256Gcm>::from_slice(key));
    cipher
        .decrypt(Nonce::from_slice(&iv), Payload { msg: &ct, aad })
        .map_err(|_| bad("Entschlüsselung fehlgeschlagen"))
}

/// Path of the one authenticated GET used to verify the eCamp session on unlock:
/// `/api/users/<id>` built from the session's user IRI (`/api/users/<id>` or a full URL ending so).
/// Only a plain id (`[A-Za-z0-9_-]`, max 64) is accepted; anything else is rejected.
pub fn session_verify_path(user_iri: &str) -> Result<String, CoreError> {
    let id = user_iri.trim().rsplit_once("/api/users/").map(|(_, id)| id).ok_or_else(|| bad("Benutzer unbekannt"))?;
    let ok = !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if !ok {
        return Err(bad("Benutzer unbekannt"));
    }
    Ok(format!("/api/users/{id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verify_path_building() {
        assert_eq!(session_verify_path("/api/users/abc-1_X").unwrap(), "/api/users/abc-1_X");
        assert_eq!(session_verify_path("https://dev.ecamp3.ch/api/users/u1").unwrap(), "/api/users/u1");
        for input in ["", "/api/users/", "/api/users/a/b", "/api/users/..", "/api/users/a?x=1", "/api/camps/1", "u1"] {
            assert!(session_verify_path(input).is_err(), "{input}");
        }
    }

    #[test]
    fn key_roundtrip_and_validation() {
        let k = generate_key();
        assert_ne!(k, [0u8; KEY_LEN]);
        assert_ne!(k, generate_key());
        assert_eq!(decode_key(&encode_key(&k)).unwrap(), k);
        assert!(decode_key("!!!").is_err());
        assert!(decode_key(&STANDARD.encode([1u8; 16])).is_err());
    }

    #[test]
    fn seal_open_roundtrip() {
        let k = generate_key();
        let env = seal(&k, AAD_ALLOWED_PATHS, b"{\"files\":[]}").unwrap();
        assert!(is_envelope(&env));
        assert!(!env.contains("files"));
        assert_eq!(open(&k, AAD_ALLOWED_PATHS, &env).unwrap(), b"{\"files\":[]}");
        // fresh IV each time
        assert_ne!(env, seal(&k, AAD_ALLOWED_PATHS, b"{\"files\":[]}").unwrap());
    }

    #[test]
    fn legacy_plaintext_is_not_an_envelope() {
        assert!(!is_envelope("{\"files\":[],\"folders\":[]}"));
        assert!(!is_envelope("garbage"));
    }

    #[test]
    fn wrong_key_aad_and_tamper_fail() {
        let k = generate_key();
        let env = seal(&k, AAD_ALLOWED_PATHS, b"secret").unwrap();
        assert!(open(&generate_key(), AAD_ALLOWED_PATHS, &env).is_err());
        assert!(open(&k, b"other", &env).is_err());

        let mut v: serde_json::Value = serde_json::from_str(&env).unwrap();
        let mut ct = STANDARD.decode(v["ct"].as_str().unwrap()).unwrap();
        ct[0] ^= 1;
        v["ct"] = STANDARD.encode(ct).into();
        assert!(open(&k, AAD_ALLOWED_PATHS, &v.to_string()).is_err());

        let mut v: serde_json::Value = serde_json::from_str(&env).unwrap();
        v["v"] = 2.into();
        assert!(open(&k, AAD_ALLOWED_PATHS, &v.to_string()).is_err());
        let mut v: serde_json::Value = serde_json::from_str(&env).unwrap();
        v["iv"] = STANDARD.encode([0u8; 5]).into();
        assert!(open(&k, AAD_ALLOWED_PATHS, &v.to_string()).is_err());
    }
}
