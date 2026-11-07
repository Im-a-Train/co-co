//! Types shared with the frontend (serialized camelCase, see apps/desktop/src/lib/tauri.ts).

use serde::{Deserialize, Serialize};

use crate::jwt::JwtClaims;

/// Result of `discover_instance`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstanceInfo {
    /// Normalized frontend base URL without trailing slash, e.g. `https://app.ecamp3.ch`.
    pub base_url: String,
    /// API root without trailing slash, e.g. `https://app.ecamp3.ch/api`.
    pub api_root: String,
    /// Cookie name prefix, e.g. `app_ecamp3_ch_`.
    pub cookie_prefix: String,
    pub feature_comments: bool,
    pub version: Option<String>,
    /// OAuth providers advertised by the API root (`oauthPbsmidata` -> `pbsmidata`).
    pub oauth_providers: Vec<String>,
}

/// How the session was obtained.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuthMethod {
    Webview,
    Password,
}

/// Public view of the current session. Contains cookie NAMES only, never values.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub base_url: String,
    pub api_root: String,
    pub method: AuthMethod,
    pub user_iri: Option<String>,
    /// JWT expiry, seconds since epoch.
    pub exp: Option<i64>,
    pub roles: Vec<String>,
    pub cookie_names: Vec<String>,
    /// Seconds since epoch.
    pub obtained_at: i64,
}

impl SessionInfo {
    pub fn new(
        instance: &InstanceInfo,
        method: AuthMethod,
        claims: &JwtClaims,
        mut cookie_names: Vec<String>,
        obtained_at: i64,
    ) -> Self {
        cookie_names.sort();
        cookie_names.dedup();
        Self {
            base_url: instance.base_url.clone(),
            api_root: instance.api_root.clone(),
            method,
            user_iri: claims.user.clone(),
            exp: claims.exp,
            roles: claims.roles.clone(),
            cookie_names,
            obtained_at,
        }
    }
}

/// Payload of the `auth://log` event (diagnostics for the spike protocol).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthLog {
    pub step: String,
    pub ok: bool,
    pub detail: Option<String>,
}

impl AuthLog {
    pub fn ok(step: impl Into<String>, detail: impl Into<Option<String>>) -> Self {
        Self { step: step.into(), ok: true, detail: detail.into() }
    }
    pub fn fail(step: impl Into<String>, detail: impl Into<Option<String>>) -> Self {
        Self { step: step.into(), ok: false, detail: detail.into() }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn instance() -> InstanceInfo {
        InstanceInfo {
            base_url: "https://app.ecamp3.ch".into(),
            api_root: "https://app.ecamp3.ch/api".into(),
            cookie_prefix: "app_ecamp3_ch_".into(),
            feature_comments: true,
            version: Some("2f065a3".into()),
            oauth_providers: vec!["pbsmidata".into()],
        }
    }

    #[test]
    fn instance_info_serializes_camel_case() {
        let v = serde_json::to_value(instance()).unwrap();
        assert_eq!(
            v,
            json!({
                "baseUrl": "https://app.ecamp3.ch",
                "apiRoot": "https://app.ecamp3.ch/api",
                "cookiePrefix": "app_ecamp3_ch_",
                "featureComments": true,
                "version": "2f065a3",
                "oauthProviders": ["pbsmidata"]
            })
        );
    }

    #[test]
    fn session_info_serializes_camel_case_and_lowercase_method() {
        let claims = JwtClaims {
            exp: Some(1_800_000_000),
            user: Some("/api/users/abc".into()),
            roles: vec!["ROLE_USER".into()],
        };
        let s = SessionInfo::new(
            &instance(),
            AuthMethod::Webview,
            &claims,
            vec!["b".into(), "a".into(), "b".into()],
            1_700_000_000,
        );
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(
            v,
            json!({
                "baseUrl": "https://app.ecamp3.ch",
                "apiRoot": "https://app.ecamp3.ch/api",
                "method": "webview",
                "userIri": "/api/users/abc",
                "exp": 1_800_000_000i64,
                "roles": ["ROLE_USER"],
                "cookieNames": ["a", "b"],
                "obtainedAt": 1_700_000_000i64
            })
        );
        let p = serde_json::to_value(AuthMethod::Password).unwrap();
        assert_eq!(p, json!("password"));
    }

    #[test]
    fn auth_log_shape() {
        let v = serde_json::to_value(AuthLog::ok("cookies", Some("x".to_string()))).unwrap();
        assert_eq!(v, json!({"step": "cookies", "ok": true, "detail": "x"}));
        let v = serde_json::to_value(AuthLog::fail("login-window-closed", None)).unwrap();
        assert_eq!(v, json!({"step": "login-window-closed", "ok": false, "detail": null}));
    }
}
