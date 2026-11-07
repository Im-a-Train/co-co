//! eCamp instance discovery: base URL validation, `environment.js` parsing,
//! cookie prefix fallback and API root `_links` parsing.

use std::collections::BTreeMap;
use std::sync::OnceLock;

use regex::Regex;
use url::Url;

use crate::error::CoreError;
use crate::types::InstanceInfo;

/// True for hosts on which plain http is acceptable (local development).
pub fn is_loopback_host(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Domain(d)) => d.eq_ignore_ascii_case("localhost") || d.to_ascii_lowercase().ends_with(".localhost"),
        Some(url::Host::Ipv4(ip)) => ip.is_loopback(),
        Some(url::Host::Ipv6(ip)) => ip.is_loopback(),
        None => false,
    }
}

/// Validates that a URL may be talked to: https, or http on loopback only;
/// no credentials in the URL; a host is present.
pub fn validate_remote_url(url: &Url) -> Result<(), CoreError> {
    match url.scheme() {
        "https" => {}
        "http" if is_loopback_host(url) => {}
        "http" => return Err(CoreError::InsecureScheme(url.origin().ascii_serialization())),
        other => return Err(CoreError::InvalidUrl(format!("Schema '{other}' wird nicht unterstützt"))),
    }
    if !matches!(url.host_str(), Some(h) if !h.is_empty()) {
        return Err(CoreError::InvalidUrl("Host fehlt".into()));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(CoreError::InvalidUrl("Zugangsdaten in der URL sind nicht erlaubt".into()));
    }
    Ok(())
}

/// Normalizes a user-entered instance URL (e.g. `app.ecamp3.ch/`,
/// `https://app.ecamp3.ch/camps?x`) to `https://app.ecamp3.ch` (scheme + host
/// [+ port] [+ path prefix], no trailing slash, no query/fragment).
///
/// A missing scheme defaults to https. Known SPA routes (`/login`,
/// `/loginCallback`, `/camps`) at the end are stripped.
pub fn normalize_base_url(input: &str) -> Result<Url, CoreError> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err(CoreError::InvalidUrl("leer".into()));
    }
    let with_scheme = if trimmed.contains("://") { trimmed.to_string() } else { format!("https://{trimmed}") };
    let mut url = Url::parse(&with_scheme).map_err(|e| CoreError::InvalidUrl(e.to_string()))?;
    validate_remote_url(&url)?;
    url.set_query(None);
    url.set_fragment(None);
    let mut path = url.path().trim_end_matches('/').to_string();
    for route in ["/login", "/loginCallback", "/camps"] {
        if let Some(stripped) = path.strip_suffix(route) {
            path = stripped.trim_end_matches('/').to_string();
            break;
        }
    }
    url.set_path(&path);
    Ok(url)
}

/// String form of a normalized base URL without trailing slash.
pub fn base_url_string(url: &Url) -> String {
    url.as_str().trim_end_matches('/').to_string()
}

/// URL of `{base}/{rel}` (rel without leading slash).
pub fn join_base(base: &Url, rel: &str) -> Result<Url, CoreError> {
    let s = format!("{}/{}", base_url_string(base), rel.trim_start_matches('/'));
    Url::parse(&s).map_err(|e| CoreError::InvalidUrl(e.to_string()))
}

/// Fallback cookie prefix when `environment.js` is unavailable: host with
/// `.` replaced by `_`, plus a trailing `_` (`app.ecamp3.ch` -> `app_ecamp3_ch_`).
pub fn fallback_cookie_prefix(host: &str) -> String {
    format!("{}_", host.trim_end_matches('.').replace('.', "_"))
}

/// Fallback API root: `{base}/api`.
pub fn fallback_api_root(base: &Url) -> String {
    format!("{}/api", base_url_string(base))
}

/// The parsed relevant parts of `{instance}/environment.js`.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EnvironmentConfig {
    pub api_root_url: Option<String>,
    pub cookie_prefix: Option<String>,
    pub feature_comments: Option<bool>,
    pub version: Option<String>,
    /// All scalar entries, for diagnostics.
    pub raw: BTreeMap<String, String>,
}

fn env_entry_regex() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        // KEY: 'single' | "double" | `template` | true | false | null | number
        Regex::new(
            r#"(?m)["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*:\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`([^`]*)`|(true|false|null)\b|(-?\d+(?:\.\d+)?))"#,
        )
        .expect("valid regex")
    })
}

/// Parses `window.environment = { API_ROOT_URL: '...', COOKIE_PREFIX: '...', ... }`.
/// Tolerant of quoting style, quoted keys, trailing commas and comments.
pub fn parse_environment_js(js: &str) -> EnvironmentConfig {
    // Only look at the object literal if we can find it; otherwise the whole text.
    let body = match (js.find('{'), js.rfind('}')) {
        (Some(a), Some(b)) if b > a => &js[a + 1..b],
        _ => js,
    };
    let mut raw = BTreeMap::new();
    for cap in env_entry_regex().captures_iter(body) {
        let key = cap[1].to_string();
        let value = cap
            .get(2)
            .or_else(|| cap.get(3))
            .or_else(|| cap.get(4))
            .map(|m| unescape_js(m.as_str()))
            .or_else(|| cap.get(5).map(|m| m.as_str().to_string()))
            .or_else(|| cap.get(6).map(|m| m.as_str().to_string()))
            .unwrap_or_default();
        raw.entry(key).or_insert(value);
    }
    let non_empty = |k: &str| raw.get(k).filter(|v| !v.is_empty() && v.as_str() != "null").cloned();
    EnvironmentConfig {
        api_root_url: non_empty("API_ROOT_URL"),
        // an explicitly empty prefix is legitimate (COOKIE_PREFIX='' in upstream defaults)
        cookie_prefix: raw.get("COOKIE_PREFIX").filter(|v| v.as_str() != "null").cloned(),
        feature_comments: raw.get("FEATURE_COMMENTS").map(|v| v == "true" || v == "1"),
        version: non_empty("VERSION"),
        raw,
    }
}

fn unescape_js(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.next() {
                Some('n') => out.push('\n'),
                Some('t') => out.push('\t'),
                Some(other) => out.push(other),
                None => {}
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Strips RFC 6570 template parts: `/api/camps{/id}{?isPrototype}` -> `/api/camps`.
pub fn strip_uri_template(href: &str) -> String {
    let mut out = String::with_capacity(href.len());
    let mut depth = 0usize;
    for ch in href.chars() {
        match ch {
            '{' => depth += 1,
            '}' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

/// Extracts `_links` (rel -> href, templates stripped) from a HAL API root document.
pub fn parse_root_links(root: &serde_json::Value) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    if let Some(links) = root.get("_links").and_then(|l| l.as_object()) {
        for (rel, link) in links {
            let href = match link {
                serde_json::Value::Object(o) => o.get("href").and_then(|h| h.as_str()),
                serde_json::Value::Array(a) => a.first().and_then(|o| o.get("href")).and_then(|h| h.as_str()),
                _ => None,
            };
            if let Some(href) = href {
                out.insert(rel.clone(), strip_uri_template(href));
            }
        }
    }
    out
}

/// OAuth providers from root link rels (`oauthPbsmidata` -> `pbsmidata`), sorted.
pub fn oauth_providers(links: &BTreeMap<String, String>) -> Vec<String> {
    let mut v: Vec<String> = links
        .keys()
        .filter_map(|rel| rel.strip_prefix("oauth"))
        .filter(|rest| !rest.is_empty())
        .map(|rest| rest.to_ascii_lowercase())
        .collect();
    v.sort();
    v.dedup();
    v
}

/// Resolves a link href (absolute path or absolute URL) against the API root.
pub fn resolve_href(api_root: &Url, href: &str) -> Result<Url, CoreError> {
    api_root.join(href).map_err(|e| CoreError::InvalidUrl(e.to_string()))
}

/// Assembles [`InstanceInfo`] from what discovery found, applying fallbacks.
pub fn build_instance_info(
    base: &Url,
    env: Option<&EnvironmentConfig>,
    links: &BTreeMap<String, String>,
) -> Result<InstanceInfo, CoreError> {
    let api_root = match env.and_then(|e| e.api_root_url.as_deref()) {
        Some(api) => {
            let api_url = base.join(api).map_err(|e| CoreError::InvalidUrl(e.to_string()))?;
            validate_remote_url(&api_url)?;
            // The auth cookies are host-only on the instance host; an API root on
            // another origin would make us send them (and the refresh token) there.
            if api_url.origin() != base.origin() {
                return Err(CoreError::ForeignOrigin(format!(
                    "API_ROOT_URL {} liegt nicht auf {}",
                    api_url.origin().ascii_serialization(),
                    base.origin().ascii_serialization()
                )));
            }
            api_url.as_str().trim_end_matches('/').to_string()
        }
        None => fallback_api_root(base),
    };
    let cookie_prefix = env
        .and_then(|e| e.cookie_prefix.clone())
        .unwrap_or_else(|| fallback_cookie_prefix(base.host_str().unwrap_or_default()));
    Ok(InstanceInfo {
        base_url: base_url_string(base),
        api_root,
        cookie_prefix,
        feature_comments: env.and_then(|e| e.feature_comments).unwrap_or(false),
        version: env.and_then(|e| e.version.clone()),
        oauth_providers: oauth_providers(links),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ENV_JS: &str = r#"window.environment = {
  API_ROOT_URL: 'https://app.ecamp3.ch/api',
  COOKIE_PREFIX: 'app_ecamp3_ch_',
  PRINT_URL: 'https://app.ecamp3.ch/print',
  SENTRY_FRONTEND_DSN: null,
  DEPLOYMENT_ENVIRONMENT: "app.ecamp3.ch",
  FEATURE_DEVELOPER: false,
  FEATURE_COMMENTS: true,
  FEATURE_HITOBITO: false,
  LOGIN_INFO_TEXT_KEY: 'global.loginInfo',
  RECAPTCHA_SITE_KEY: '6Lc', // comment
  "VERSION": '2f065a3',
  TIMEOUT: 30,
}
"#;

    #[test]
    fn parses_environment_js() {
        let e = parse_environment_js(ENV_JS);
        assert_eq!(e.api_root_url.as_deref(), Some("https://app.ecamp3.ch/api"));
        assert_eq!(e.cookie_prefix.as_deref(), Some("app_ecamp3_ch_"));
        assert_eq!(e.feature_comments, Some(true));
        assert_eq!(e.version.as_deref(), Some("2f065a3"));
        assert_eq!(e.raw.get("FEATURE_HITOBITO").map(String::as_str), Some("false"));
        assert_eq!(e.raw.get("DEPLOYMENT_ENVIRONMENT").map(String::as_str), Some("app.ecamp3.ch"));
        assert_eq!(e.raw.get("TIMEOUT").map(String::as_str), Some("30"));
        assert_eq!(e.raw.get("SENTRY_FRONTEND_DSN").map(String::as_str), Some("null"));
    }

    #[test]
    fn parses_url_values_containing_colons_correctly() {
        // the "https:" inside a value must not be read as a key
        let e = parse_environment_js("window.environment={API_ROOT_URL:'https://x.ch/api',COOKIE_PREFIX:''}");
        assert_eq!(e.api_root_url.as_deref(), Some("https://x.ch/api"));
        assert_eq!(e.cookie_prefix.as_deref(), Some(""));
        assert_eq!(e.feature_comments, None);
        assert!(!e.raw.contains_key("https"));
    }

    #[test]
    fn parses_escapes_and_template_strings() {
        let e = parse_environment_js(r#"window.environment = { VERSION: 'it\'s', COOKIE_PREFIX: `p_` }"#);
        assert_eq!(e.version.as_deref(), Some("it's"));
        assert_eq!(e.cookie_prefix.as_deref(), Some("p_"));
    }

    #[test]
    fn garbage_environment_is_empty() {
        assert_eq!(parse_environment_js("<html>404</html>"), EnvironmentConfig::default());
        assert_eq!(parse_environment_js(""), EnvironmentConfig::default());
    }

    #[test]
    fn cookie_prefix_fallback() {
        assert_eq!(fallback_cookie_prefix("app.ecamp3.ch"), "app_ecamp3_ch_");
        assert_eq!(fallback_cookie_prefix("dev.ecamp3.ch"), "dev_ecamp3_ch_");
        assert_eq!(fallback_cookie_prefix("localhost"), "localhost_");
        assert_eq!(fallback_cookie_prefix("app.ecamp3.ch."), "app_ecamp3_ch_");
    }

    #[test]
    fn normalizes_base_urls() {
        let n = |s: &str| normalize_base_url(s).map(|u| base_url_string(&u));
        assert_eq!(n("https://app.ecamp3.ch").unwrap(), "https://app.ecamp3.ch");
        assert_eq!(n(" https://app.ecamp3.ch/ ").unwrap(), "https://app.ecamp3.ch");
        assert_eq!(n("app.ecamp3.ch").unwrap(), "https://app.ecamp3.ch");
        assert_eq!(n("https://APP.ecamp3.ch/login?x=1#f").unwrap(), "https://app.ecamp3.ch");
        assert_eq!(n("https://app.ecamp3.ch/camps/").unwrap(), "https://app.ecamp3.ch");
        assert_eq!(n("https://host.ch/ecamp/").unwrap(), "https://host.ch/ecamp");
        assert_eq!(n("http://localhost:3000").unwrap(), "http://localhost:3000");
        assert_eq!(n("http://127.0.0.1:3000/").unwrap(), "http://127.0.0.1:3000");
        assert_eq!(n("http://[::1]:3000").unwrap(), "http://[::1]:3000");
    }

    #[test]
    fn rejects_insecure_or_invalid_base_urls() {
        assert!(matches!(normalize_base_url("http://app.ecamp3.ch"), Err(CoreError::InsecureScheme(_))));
        assert!(matches!(normalize_base_url("http://localhost.evil.com"), Err(CoreError::InsecureScheme(_))));
        assert!(normalize_base_url("").is_err());
        assert!(normalize_base_url("ftp://app.ecamp3.ch").is_err());
        assert!(normalize_base_url("file:///etc/passwd").is_err());
        assert!(normalize_base_url("javascript:alert(1)").is_err());
        assert!(normalize_base_url("https://user:pw@app.ecamp3.ch").is_err());
        assert!(normalize_base_url("https://").is_err());
    }

    #[test]
    fn loopback_detection() {
        let u = |s: &str| Url::parse(s).unwrap();
        assert!(is_loopback_host(&u("http://localhost:1")));
        assert!(is_loopback_host(&u("http://app.localhost")));
        assert!(is_loopback_host(&u("http://127.0.0.5")));
        assert!(!is_loopback_host(&u("http://10.0.0.1")));
        assert!(!is_loopback_host(&u("http://localhost.example.com")));
    }

    #[test]
    fn strips_templates() {
        assert_eq!(strip_uri_template("/api/camps{/id}{?isPrototype,campCollaborator}"), "/api/camps");
        assert_eq!(strip_uri_template("/api/auth/pbsmidata{?callback}"), "/api/auth/pbsmidata");
        assert_eq!(strip_uri_template("/api/token/refresh"), "/api/token/refresh");
    }

    fn root() -> serde_json::Value {
        json!({
            "_links": {
                "self": {"href": "/api"},
                "login": {"href": "/api/authentication_token"},
                "refreshToken": {"href": "/api/token/refresh"},
                "oauthPbsmidata": {"href": "/api/auth/pbsmidata{?callback}", "templated": true},
                "oauthGoogle": {"href": "/api/auth/google{?callback}", "templated": true},
                "oauthCevidb": {"href": "/api/auth/cevidb{?callback}", "templated": true},
                "oauthJubladb": {"href": "/api/auth/jubladb{?callback}", "templated": true},
                "camps": {"href": "/api/camps{/id}{?isPrototype,campCollaborator}", "templated": true},
                "items": [{"href": "/api/a"}, {"href": "/api/b"}]
            }
        })
    }

    #[test]
    fn parses_root_links_and_providers() {
        let links = parse_root_links(&root());
        assert_eq!(links["login"], "/api/authentication_token");
        assert_eq!(links["refreshToken"], "/api/token/refresh");
        assert_eq!(links["camps"], "/api/camps");
        assert_eq!(links["oauthPbsmidata"], "/api/auth/pbsmidata");
        assert_eq!(links["items"], "/api/a");
        assert_eq!(oauth_providers(&links), vec!["cevidb", "google", "jubladb", "pbsmidata"]);
        assert!(parse_root_links(&json!({})).is_empty());
        assert!(parse_root_links(&json!({"_links": []})).is_empty());
    }

    #[test]
    fn resolves_hrefs() {
        let api = Url::parse("https://app.ecamp3.ch/api").unwrap();
        assert_eq!(resolve_href(&api, "/api/token/refresh").unwrap().as_str(), "https://app.ecamp3.ch/api/token/refresh");
        assert_eq!(resolve_href(&api, "https://other.ch/x").unwrap().as_str(), "https://other.ch/x");
    }

    #[test]
    fn builds_instance_info_from_env() {
        let base = normalize_base_url("https://app.ecamp3.ch").unwrap();
        let env = parse_environment_js(ENV_JS);
        let info = build_instance_info(&base, Some(&env), &parse_root_links(&root())).unwrap();
        assert_eq!(info.base_url, "https://app.ecamp3.ch");
        assert_eq!(info.api_root, "https://app.ecamp3.ch/api");
        assert_eq!(info.cookie_prefix, "app_ecamp3_ch_");
        assert!(info.feature_comments);
        assert_eq!(info.version.as_deref(), Some("2f065a3"));
        assert_eq!(info.oauth_providers.len(), 4);
    }

    #[test]
    fn builds_instance_info_with_fallbacks() {
        let base = normalize_base_url("https://dev.ecamp3.ch/").unwrap();
        let info = build_instance_info(&base, None, &BTreeMap::new()).unwrap();
        assert_eq!(info.api_root, "https://dev.ecamp3.ch/api");
        assert_eq!(info.cookie_prefix, "dev_ecamp3_ch_");
        assert!(!info.feature_comments);
        assert_eq!(info.version, None);
        assert!(info.oauth_providers.is_empty());
        // relative API_ROOT_URL is resolved against the base
        let env = parse_environment_js("window.environment={API_ROOT_URL:'/api/'}");
        let info = build_instance_info(&base, Some(&env), &BTreeMap::new()).unwrap();
        assert_eq!(info.api_root, "https://dev.ecamp3.ch/api");
    }

    #[test]
    fn rejects_api_root_on_foreign_origin() {
        let base = Url::parse("https://app.ecamp3.ch").unwrap();
        for api in ["https://evil.example/api", "//evil.example/api", "https://app.ecamp3.ch:8443/api", "https://api.ecamp3.ch/api"] {
            let env = EnvironmentConfig { api_root_url: Some(api.into()), ..Default::default() };
            let err = build_instance_info(&base, Some(&env), &BTreeMap::new()).unwrap_err();
            assert!(matches!(err, CoreError::ForeignOrigin(_)), "{api} -> {err:?}");
        }
        // relative and same-origin absolute roots are fine
        for api in ["/api", "https://app.ecamp3.ch/api/"] {
            let env = EnvironmentConfig { api_root_url: Some(api.into()), ..Default::default() };
            let info = build_instance_info(&base, Some(&env), &BTreeMap::new()).unwrap();
            assert_eq!(info.api_root, "https://app.ecamp3.ch/api");
        }
    }

    #[test]
    fn rejects_insecure_api_root_from_env() {
        let base = normalize_base_url("https://app.ecamp3.ch").unwrap();
        let env = parse_environment_js("window.environment={API_ROOT_URL:'http://evil.example/api'}");
        assert!(build_instance_info(&base, Some(&env), &BTreeMap::new()).is_err());
    }

    #[test]
    fn join_base_works_with_path_prefix() {
        let base = normalize_base_url("https://host.ch/ecamp").unwrap();
        assert_eq!(join_base(&base, "/environment.js").unwrap().as_str(), "https://host.ch/ecamp/environment.js");
        let base = normalize_base_url("https://app.ecamp3.ch").unwrap();
        assert_eq!(join_base(&base, "login").unwrap().as_str(), "https://app.ecamp3.ch/login");
    }
}
