//! URL/origin validation for `api_get`: the frontend may only make the Rust
//! side (which holds the auth cookies) talk to the current session's eCamp API.

use url::{Origin, Url};

use crate::error::CoreError;

/// Resolves a path passed to `api_get` into an absolute URL below the API root.
///
/// Accepted forms:
/// - absolute path starting with the API root path, e.g. `/api/camps?x=1`
/// - path relative to the API root, e.g. `camps` or `camps/abc`
/// - absolute URL whose origin is in `allowed` and whose path is below the API root
///   (HAL links are normally absolute paths, but some deployments return full URLs)
///
/// Rejected: other hosts/schemes, protocol-relative `//host`, backslashes,
/// control characters, and anything that normalizes outside the API root path
/// (e.g. `/api/../admin`).
pub fn resolve_api_path(path: &str, api_root: &Url, allowed: &[Origin]) -> Result<Url, CoreError> {
    let path = path.trim();
    if path.is_empty() {
        return Err(CoreError::PathNotAllowed("leerer Pfad".into()));
    }
    if path.chars().any(|c| c.is_control() || c == '\\') {
        return Err(CoreError::PathNotAllowed("ungültige Zeichen im Pfad".into()));
    }
    if path.starts_with("//") {
        return Err(CoreError::ForeignOrigin("protokoll-relative URL".into()));
    }
    if contains_dot_segment(path) {
        return Err(CoreError::PathNotAllowed("'.'/'..'-Segmente sind nicht erlaubt".into()));
    }

    let api_path = api_root.path().trim_end_matches('/').to_string();
    let has_scheme = Url::parse(path).is_ok();

    let url = if has_scheme {
        let u = Url::parse(path).map_err(|e| CoreError::InvalidUrl(e.to_string()))?;
        if !allowed.contains(&u.origin()) {
            return Err(CoreError::ForeignOrigin(u.origin().ascii_serialization()));
        }
        u
    } else if path.starts_with('/') {
        api_root.join(path).map_err(|e| CoreError::InvalidUrl(e.to_string()))?
    } else {
        let base = format!("{}/", api_root.as_str().trim_end_matches('/'));
        Url::parse(&base)
            .and_then(|b| b.join(path))
            .map_err(|e| CoreError::InvalidUrl(e.to_string()))?
    };

    if url.origin() != api_root.origin() && !allowed.contains(&url.origin()) {
        return Err(CoreError::ForeignOrigin(url.origin().ascii_serialization()));
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(CoreError::InvalidUrl("Zugangsdaten in der URL sind nicht erlaubt".into()));
    }
    let p = url.path();
    let below_root = api_path.is_empty() || p == api_path || p.starts_with(&format!("{api_path}/"));
    if !below_root {
        return Err(CoreError::PathNotAllowed(format!("{p} liegt nicht unter {api_path}")));
    }
    Ok(url)
}

fn contains_dot_segment(path: &str) -> bool {
    let without_query = path.split(['?', '#']).next().unwrap_or("");
    without_query.split('/').any(|seg| {
        let lower = seg.to_ascii_lowercase();
        seg == "." || seg == ".." || lower == "%2e" || lower == "%2e%2e" || lower == ".%2e" || lower == "%2e."
    })
}

/// The origins an authenticated session may talk to: the instance base URL
/// and the API root (usually identical).
pub fn session_origins(base_url: &Url, api_root: &Url) -> Vec<Origin> {
    let mut v = vec![base_url.origin()];
    if !v.contains(&api_root.origin()) {
        v.push(api_root.origin());
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn api() -> Url {
        Url::parse("https://app.ecamp3.ch/api").unwrap()
    }

    fn allowed() -> Vec<Origin> {
        session_origins(&Url::parse("https://app.ecamp3.ch").unwrap(), &api())
    }

    fn ok(p: &str) -> String {
        resolve_api_path(p, &api(), &allowed()).unwrap().to_string()
    }

    fn err(p: &str) -> CoreError {
        resolve_api_path(p, &api(), &allowed()).unwrap_err()
    }

    #[test]
    fn accepts_api_paths() {
        assert_eq!(ok("/api/camps"), "https://app.ecamp3.ch/api/camps");
        assert_eq!(ok("/api"), "https://app.ecamp3.ch/api");
        assert_eq!(ok("/api/"), "https://app.ecamp3.ch/api/");
        assert_eq!(
            ok("/api/activities?camp=/api/camps/abc"),
            "https://app.ecamp3.ch/api/activities?camp=/api/camps/abc"
        );
        assert_eq!(ok("/api/users/1a2b"), "https://app.ecamp3.ch/api/users/1a2b");
    }

    #[test]
    fn accepts_paths_relative_to_api_root() {
        assert_eq!(ok("camps"), "https://app.ecamp3.ch/api/camps");
        assert_eq!(ok("camps/abc?x=1"), "https://app.ecamp3.ch/api/camps/abc?x=1");
    }

    #[test]
    fn accepts_absolute_urls_on_session_origin() {
        assert_eq!(ok("https://app.ecamp3.ch/api/camps"), "https://app.ecamp3.ch/api/camps");
    }

    #[test]
    fn rejects_foreign_hosts() {
        assert!(matches!(err("https://evil.example/api/camps"), CoreError::ForeignOrigin(_)));
        assert!(matches!(err("http://app.ecamp3.ch/api/camps"), CoreError::ForeignOrigin(_)));
        assert!(matches!(err("https://app.ecamp3.ch:8443/api/camps"), CoreError::ForeignOrigin(_)));
        assert!(matches!(err("https://dev.ecamp3.ch/api/camps"), CoreError::ForeignOrigin(_)));
        assert!(matches!(err("//evil.example/api"), CoreError::ForeignOrigin(_)));
        assert!(!err("file:///C:/x").to_string().is_empty());
        assert!(resolve_api_path("javascript:alert(1)", &api(), &allowed()).is_err());
    }

    #[test]
    fn rejects_userinfo_tricks() {
        assert!(resolve_api_path("https://app.ecamp3.ch@evil.example/api", &api(), &allowed()).is_err());
        assert!(resolve_api_path("https://user@app.ecamp3.ch/api", &api(), &allowed()).is_err());
    }

    #[test]
    fn rejects_paths_outside_api_root() {
        assert!(matches!(err("/login"), CoreError::PathNotAllowed(_)));
        assert!(matches!(err("/apix/camps"), CoreError::PathNotAllowed(_)));
        assert!(matches!(err("/api/../admin"), CoreError::PathNotAllowed(_)));
        assert!(matches!(err("/api/%2e%2e/admin"), CoreError::PathNotAllowed(_)));
        assert!(matches!(err("../admin"), CoreError::PathNotAllowed(_)));
        assert!(matches!(err("https://app.ecamp3.ch/print"), CoreError::PathNotAllowed(_)));
    }

    #[test]
    fn rejects_bad_characters() {
        assert!(err("").to_string().contains("leer"));
        assert!(matches!(err("/api\\..\\x"), CoreError::PathNotAllowed(_)));
        assert!(matches!(err("/api/camps\r\nX: y"), CoreError::PathNotAllowed(_)));
    }

    #[test]
    fn query_with_dots_is_fine() {
        assert_eq!(ok("/api/camps?x=../y"), "https://app.ecamp3.ch/api/camps?x=../y");
    }

    #[test]
    fn api_root_on_separate_host() {
        let api = Url::parse("https://api.example.ch/").unwrap();
        let allowed = session_origins(&Url::parse("https://example.ch").unwrap(), &api);
        assert_eq!(allowed.len(), 2);
        assert_eq!(
            resolve_api_path("/camps", &api, &allowed).unwrap().as_str(),
            "https://api.example.ch/camps"
        );
        assert!(resolve_api_path("https://evil.ch/camps", &api, &allowed).is_err());
    }

    #[test]
    fn session_origins_dedupes() {
        assert_eq!(allowed().len(), 1);
    }
}
