//! Selection of the eCamp auth cookies and helpers to move them into a
//! reqwest cookie jar.
//!
//! eCamp (lexik JWT + gesdinet refresh) uses three cookies:
//! `{prefix}jwt_hp` (header.payload, readable by JS), `{prefix}jwt_s`
//! (signature, HttpOnly) and `{prefix}refresh_token` (HttpOnly, single-use).

use std::fmt;

use url::Url;

pub const JWT_HP: &str = "jwt_hp";
pub const JWT_S: &str = "jwt_s";
pub const REFRESH_TOKEN: &str = "refresh_token";

/// A cookie name/value pair. `Debug` redacts the value so it can never leak
/// through `{:?}` logging.
#[derive(Clone, PartialEq, Eq)]
pub struct RawCookie {
    pub name: String,
    pub value: String,
}

impl RawCookie {
    pub fn new(name: impl Into<String>, value: impl Into<String>) -> Self {
        Self { name: name.into(), value: value.into() }
    }
}

impl fmt::Debug for RawCookie {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RawCookie")
            .field("name", &self.name)
            .field("value", &"<redacted>")
            .finish()
    }
}

/// The auth cookies found in a cookie store.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct AuthCookies {
    pub jwt_hp: Option<RawCookie>,
    pub jwt_s: Option<RawCookie>,
    pub refresh_token: Option<RawCookie>,
}

impl AuthCookies {
    /// Both JWT halves are present (minimum for authenticated API calls).
    pub fn has_jwt(&self) -> bool {
        self.jwt_hp.is_some() && self.jwt_s.is_some()
    }

    /// Present cookies in a stable order.
    pub fn all(&self) -> Vec<&RawCookie> {
        [&self.jwt_hp, &self.jwt_s, &self.refresh_token]
            .into_iter()
            .flatten()
            .collect()
    }

    /// Names of the present cookies (never values).
    pub fn names(&self) -> Vec<String> {
        self.all().into_iter().map(|c| c.name.clone()).collect()
    }
}

/// Picks one cookie for `suffix`. Exact `{prefix}{suffix}` wins; otherwise any
/// cookie whose name ends with `suffix` (shortest name first, for determinism).
/// Empty values are ignored (a cleared cookie is not a credential).
fn pick<'a>(cookies: &'a [RawCookie], prefix: Option<&str>, suffix: &str) -> Option<&'a RawCookie> {
    let candidates = cookies.iter().filter(|c| !c.value.is_empty());
    if let Some(prefix) = prefix.filter(|p| !p.is_empty()) {
        let exact = format!("{prefix}{suffix}");
        if let Some(c) = cookies.iter().filter(|c| !c.value.is_empty()).find(|c| c.name == exact) {
            return Some(c);
        }
    }
    candidates
        .filter(|c| c.name.ends_with(suffix))
        .min_by(|a, b| a.name.len().cmp(&b.name.len()).then_with(|| a.name.cmp(&b.name)))
}

/// Selects the eCamp auth cookies, by exact prefix first and by suffix as a
/// fallback (when the prefix is unknown or misconfigured).
pub fn select_auth_cookies(cookies: &[RawCookie], prefix: Option<&str>) -> AuthCookies {
    AuthCookies {
        jwt_hp: pick(cookies, prefix, JWT_HP).cloned(),
        jwt_s: pick(cookies, prefix, JWT_S).cloned(),
        refresh_token: pick(cookies, prefix, REFRESH_TOKEN).cloned(),
    }
}

/// Merges cookie lists, keeping the first occurrence of each name.
pub fn dedupe_by_name(lists: impl IntoIterator<Item = Vec<RawCookie>>) -> Vec<RawCookie> {
    let mut out: Vec<RawCookie> = Vec::new();
    for list in lists {
        for c in list {
            if !out.iter().any(|o| o.name == c.name) {
                out.push(c);
            }
        }
    }
    out
}

/// Parses a `Cookie:` request header (`a=1; b=2`) as produced by
/// `reqwest::cookie::CookieStore::cookies`.
pub fn parse_cookie_header(header: &str) -> Vec<RawCookie> {
    header
        .split(';')
        .filter_map(|kv| {
            let kv = kv.trim();
            let (name, value) = kv.split_once('=')?;
            let name = name.trim();
            if name.is_empty() {
                return None;
            }
            Some(RawCookie::new(name, value.trim()))
        })
        .collect()
}

/// Builds a `Set-Cookie`-style string to feed `reqwest::cookie::Jar::add_cookie_str`
/// for `url`. Host-only (no Domain attribute), `Path=/`, and `Secure` when the
/// URL is https so the jar only ever sends it over TLS.
pub fn jar_cookie_string(cookie: &RawCookie, url: &Url) -> String {
    let mut s = format!("{}={}; Path=/; HttpOnly", cookie.name, cookie.value);
    if url.scheme() == "https" {
        s.push_str("; Secure");
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(n: &str, v: &str) -> RawCookie {
        RawCookie::new(n, v)
    }

    #[test]
    fn debug_redacts_value() {
        let s = format!("{:?}", c("app_jwt_s", "TOPSECRET"));
        assert!(s.contains("app_jwt_s"));
        assert!(!s.contains("TOPSECRET"));
        let all = select_auth_cookies(&[c("x_jwt_s", "TOPSECRET")], None);
        assert!(!format!("{all:?}").contains("TOPSECRET"));
    }

    #[test]
    fn selects_by_exact_prefix() {
        let cookies = vec![
            c("other_jwt_hp", "o1"),
            c("app_ecamp3_ch_jwt_hp", "hp"),
            c("app_ecamp3_ch_jwt_s", "s"),
            c("app_ecamp3_ch_refresh_token", "r"),
            c("_ga", "x"),
        ];
        let a = select_auth_cookies(&cookies, Some("app_ecamp3_ch_"));
        assert_eq!(a.jwt_hp.unwrap().value, "hp");
        assert_eq!(a.jwt_s.unwrap().value, "s");
        assert_eq!(a.refresh_token.unwrap().value, "r");
    }

    #[test]
    fn falls_back_to_suffix_when_prefix_unknown_or_wrong() {
        let cookies = vec![
            c("dev_ecamp3_ch_jwt_hp", "hp"),
            c("dev_ecamp3_ch_jwt_s", "s"),
            c("dev_ecamp3_ch_refresh_token", "r"),
        ];
        for prefix in [None, Some(""), Some("app_ecamp3_ch_")] {
            let a = select_auth_cookies(&cookies, prefix);
            assert!(a.has_jwt());
            assert_eq!(a.refresh_token.as_ref().unwrap().value, "r");
            assert_eq!(
                a.names(),
                vec!["dev_ecamp3_ch_jwt_hp", "dev_ecamp3_ch_jwt_s", "dev_ecamp3_ch_refresh_token"]
            );
        }
    }

    #[test]
    fn unprefixed_cookies_match() {
        let a = select_auth_cookies(&[c("jwt_hp", "1"), c("jwt_s", "2")], Some(""));
        assert!(a.has_jwt());
        assert!(a.refresh_token.is_none());
    }

    #[test]
    fn jwt_s_does_not_match_jwt_hp_and_vice_versa() {
        let a = select_auth_cookies(&[c("p_jwt_hp", "1")], None);
        assert!(a.jwt_hp.is_some());
        assert!(a.jwt_s.is_none());
        let a = select_auth_cookies(&[c("p_jwt_s", "1")], None);
        assert!(a.jwt_hp.is_none());
        assert!(!a.has_jwt());
    }

    #[test]
    fn suffix_fallback_is_deterministic_and_skips_empty_values() {
        let cookies = vec![c("long_prefix_jwt_hp", "a"), c("p_jwt_hp", "b"), c("q_jwt_hp", "c"), c("x_jwt_s", "")];
        let a = select_auth_cookies(&cookies, None);
        assert_eq!(a.jwt_hp.unwrap().name, "p_jwt_hp");
        assert!(a.jwt_s.is_none(), "empty value must be ignored");
        // exact prefix with empty value falls back to suffix
        let a = select_auth_cookies(&[c("app_jwt_s", ""), c("b_jwt_s", "v")], Some("app_"));
        assert_eq!(a.jwt_s.unwrap().name, "b_jwt_s");
    }

    #[test]
    fn empty_input() {
        let a = select_auth_cookies(&[], Some("x_"));
        assert_eq!(a, AuthCookies::default());
        assert!(a.names().is_empty());
    }

    #[test]
    fn dedupe_keeps_first() {
        let merged = dedupe_by_name(vec![vec![c("a", "1"), c("b", "2")], vec![c("a", "9"), c("c", "3")]]);
        assert_eq!(merged, vec![c("a", "1"), c("b", "2"), c("c", "3")]);
    }

    #[test]
    fn parses_cookie_header() {
        let v = parse_cookie_header("a=1; b=x=y;c=; =bad; noeq");
        assert_eq!(v, vec![c("a", "1"), c("b", "x=y"), c("c", "")]);
        assert!(parse_cookie_header("").is_empty());
    }

    #[test]
    fn jar_string_attributes() {
        let https = Url::parse("https://app.ecamp3.ch/api").unwrap();
        assert_eq!(
            jar_cookie_string(&c("p_jwt_s", "sig"), &https),
            "p_jwt_s=sig; Path=/; HttpOnly; Secure"
        );
        let http = Url::parse("http://localhost:3000/").unwrap();
        assert_eq!(jar_cookie_string(&c("p_jwt_s", "sig"), &http), "p_jwt_s=sig; Path=/; HttpOnly");
    }
}
