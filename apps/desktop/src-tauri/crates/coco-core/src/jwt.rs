//! Decoding of the eCamp `{prefix}jwt_hp` cookie ("header.payload" of the JWT).
//!
//! Only the payload fields `exp`, `user` and `roles` are extracted. The
//! signature lives in the HttpOnly `{prefix}jwt_s` cookie and is never decoded.

use base64::engine::general_purpose::{STANDARD_NO_PAD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde::{Deserialize, Serialize};

use crate::error::CoreError;

/// The subset of JWT claims co-co cares about.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct JwtClaims {
    /// Expiry, seconds since epoch.
    pub exp: Option<i64>,
    /// User IRI, e.g. `/api/users/1a2b3c4d`.
    pub user: Option<String>,
    pub roles: Vec<String>,
}

impl JwtClaims {
    /// True when `exp` is known and lies at or before `now` (seconds).
    pub fn is_expired(&self, now: i64) -> bool {
        matches!(self.exp, Some(exp) if exp <= now)
    }
}

/// Decodes the payload of a `jwt_hp` cookie value (`header.payload`). A full
/// three-part JWT is accepted as well (the signature part is ignored).
///
/// Error messages never echo the cookie value.
pub fn decode_jwt_hp(value: &str) -> Result<JwtClaims, CoreError> {
    let value = value.trim().trim_matches('"');
    let mut parts = value.split('.');
    let _header = parts.next().filter(|h| !h.is_empty());
    let payload = parts
        .next()
        .filter(|p| !p.is_empty())
        .ok_or_else(|| CoreError::InvalidJwt("kein Payload-Teil gefunden".into()))?;
    let bytes = decode_b64(payload)?;
    let json: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| CoreError::InvalidJwt("Payload ist kein JSON".into()))?;
    let obj = json
        .as_object()
        .ok_or_else(|| CoreError::InvalidJwt("Payload ist kein JSON-Objekt".into()))?;

    let exp = obj.get("exp").and_then(|v| {
        v.as_i64()
            .or_else(|| v.as_f64().filter(|f| f.is_finite()).map(|f| f as i64))
            .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    });
    let user = obj
        .get("user")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        // lexik's default user identity claim is `username`; eCamp uses `user`.
        .or_else(|| {
            obj.get("username")
                .and_then(|v| v.as_str())
                .filter(|s| s.starts_with('/'))
                .map(str::to_string)
        });
    let roles = obj
        .get("roles")
        .and_then(|v| v.as_array())
        .map(|a| a.iter().filter_map(|r| r.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    Ok(JwtClaims { exp, user, roles })
}

/// Base64 decode tolerating both alphabets and optional padding.
fn decode_b64(input: &str) -> Result<Vec<u8>, CoreError> {
    let trimmed = input.trim_end_matches('=');
    URL_SAFE_NO_PAD
        .decode(trimmed)
        .or_else(|_| STANDARD_NO_PAD.decode(trimmed))
        .map_err(|_| CoreError::InvalidJwt("Payload ist kein gültiges Base64".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};

    fn hp(payload: &str) -> String {
        let header = URL_SAFE_NO_PAD.encode(r#"{"typ":"JWT","alg":"RS256"}"#);
        format!("{header}.{}", URL_SAFE_NO_PAD.encode(payload))
    }

    #[test]
    fn decodes_ecamp_payload() {
        let v = hp(r#"{"iat":1700000000,"exp":1700043200,"roles":["ROLE_USER","ROLE_ADMIN"],"user":"/api/users/1a2b3c4d"}"#);
        let c = decode_jwt_hp(&v).unwrap();
        assert_eq!(c.exp, Some(1_700_043_200));
        assert_eq!(c.user.as_deref(), Some("/api/users/1a2b3c4d"));
        assert_eq!(c.roles, vec!["ROLE_USER", "ROLE_ADMIN"]);
    }

    #[test]
    fn accepts_full_jwt_and_ignores_signature() {
        let v = format!("{}.c2lnbmF0dXJl", hp(r#"{"exp":5,"user":"/api/users/x","roles":[]}"#));
        let c = decode_jwt_hp(&v).unwrap();
        assert_eq!(c.exp, Some(5));
        assert!(c.roles.is_empty());
    }

    #[test]
    fn tolerates_padding_and_standard_alphabet() {
        // payload chosen so standard base64 contains '+' / '/' and padding
        let payload = r#"{"exp":1,"user":"/api/users/??>>","roles":["ROLE_USER"]}"#;
        let std = STANDARD.encode(payload);
        assert!(std.ends_with('=') || std.contains('+') || std.contains('/'));
        let c = decode_jwt_hp(&format!("eyJ0eXAiOiJKV1QifQ.{std}")).unwrap();
        assert_eq!(c.user.as_deref(), Some("/api/users/??>>"));
        // url-safe with padding
        let url_padded = base64::engine::general_purpose::URL_SAFE.encode(payload);
        let c = decode_jwt_hp(&format!("h.{url_padded}")).unwrap();
        assert_eq!(c.exp, Some(1));
    }

    #[test]
    fn tolerates_quoted_value_and_whitespace() {
        let v = format!("  \"{}\" ", hp(r#"{"exp":42}"#));
        assert_eq!(decode_jwt_hp(&v).unwrap().exp, Some(42));
    }

    #[test]
    fn missing_fields_are_none_or_empty() {
        let c = decode_jwt_hp(&hp("{}")).unwrap();
        assert_eq!(c, JwtClaims::default());
    }

    #[test]
    fn falls_back_to_username_iri() {
        let c = decode_jwt_hp(&hp(r#"{"username":"/api/users/u1"}"#)).unwrap();
        assert_eq!(c.user.as_deref(), Some("/api/users/u1"));
        let c = decode_jwt_hp(&hp(r#"{"username":"someone@example.com"}"#)).unwrap();
        assert_eq!(c.user, None);
    }

    #[test]
    fn exp_as_float_or_string() {
        assert_eq!(decode_jwt_hp(&hp(r#"{"exp":12.9}"#)).unwrap().exp, Some(12));
        assert_eq!(decode_jwt_hp(&hp(r#"{"exp":"77"}"#)).unwrap().exp, Some(77));
    }

    #[test]
    fn rejects_garbage_without_echoing_value() {
        let secret = "SECRETVALUE";
        for bad in [secret, "", ".", "abc.!!!!", &format!("h.{}", URL_SAFE_NO_PAD.encode("[1,2]"))] {
            let err = decode_jwt_hp(bad).unwrap_err();
            assert!(!err.to_string().contains(secret));
        }
        let err = decode_jwt_hp(&format!("h.{}", URL_SAFE_NO_PAD.encode("not json"))).unwrap_err();
        assert!(matches!(err, CoreError::InvalidJwt(_)));
    }

    #[test]
    fn expiry_check() {
        let c = JwtClaims { exp: Some(100), ..Default::default() };
        assert!(c.is_expired(100));
        assert!(c.is_expired(101));
        assert!(!c.is_expired(99));
        assert!(!JwtClaims::default().is_expired(i64::MAX));
    }
}
