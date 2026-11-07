//! Heuristics for the login webview: when has the user (probably) finished
//! logging in, and how to describe navigations without leaking secrets.

use url::Url;

/// True when `current` is a page of the eCamp frontend at `base` that is not
/// the login page itself, i.e. the SPA has moved on after login (e.g.
/// `/loginCallback`, `/camps`, `/`). OAuth intermediate pages on the API
/// (`/api/...`) and other hosts (MiData, Google, ...) do not count.
///
/// The caller must still verify that the JWT cookies are actually present.
pub fn is_post_login_url(current: &Url, base: &Url) -> bool {
    if current.origin() != base.origin() {
        return false;
    }
    let base_path = base.path().trim_end_matches('/');
    let Some(rest) = current.path().strip_prefix(base_path) else {
        return false;
    };
    if !(rest.is_empty() || rest.starts_with('/')) {
        return false;
    }
    let rest = rest.trim_end_matches('/');
    let first = rest.trim_start_matches('/').split('/').next().unwrap_or("");
    !matches!(
        first,
        "login" | "register" | "resetPassword" | "reset-password" | "api" | "auth"
    )
}

/// Hosts that serve the app's own (IPC-capable) frontend or the IPC endpoint.
const APP_HOSTS: [&str; 2] = ["tauri.localhost", "ipc.localhost"];
/// Origin of the Vite dev server (`build.devUrl` in tauri.conf.json).
const DEV_ORIGIN: &str = "http://localhost:1420";

/// Navigation policy for the remote login webview: `https` to any host
/// (eCamp, MiData, Google, ...), plain `http` only to the instance origin
/// itself when that is a loopback instance. Never the app's own origins
/// (`tauri://`, `tauri.localhost`, `ipc.localhost`, the dev server), so a
/// remote page can never reach a local, IPC-capable origin.
pub fn is_allowed_login_navigation(url: &Url, base: &Url) -> bool {
    let host = url.host_str().unwrap_or("").to_ascii_lowercase();
    if APP_HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}"))) {
        return false;
    }
    if url.origin().ascii_serialization() == DEV_ORIGIN {
        return false;
    }
    match url.scheme() {
        "https" => !host.is_empty(),
        "http" => url.origin() == base.origin() && crate::instance::is_loopback_host(base),
        _ => false,
    }
}

/// A log-safe description of a URL: scheme, host and path only. Query and
/// fragment are dropped because OAuth redirects carry `code`/`state` there.
pub fn redact_url(url: &Url) -> String {
    match url.host_str() {
        Some(host) => {
            let port = url.port().map(|p| format!(":{p}")).unwrap_or_default();
            format!("{}://{}{}{}", url.scheme(), host, port, url.path())
        }
        None => url.scheme().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn u(s: &str) -> Url {
        Url::parse(s).unwrap()
    }

    #[test]
    fn detects_post_login_pages() {
        let base = u("https://app.ecamp3.ch");
        assert!(is_post_login_url(&u("https://app.ecamp3.ch/loginCallback"), &base));
        assert!(is_post_login_url(&u("https://app.ecamp3.ch/camps"), &base));
        assert!(is_post_login_url(&u("https://app.ecamp3.ch/"), &base));
        assert!(is_post_login_url(&u("https://app.ecamp3.ch/profile?x=1"), &base));
    }

    #[test]
    fn login_and_intermediate_pages_do_not_count() {
        let base = u("https://app.ecamp3.ch");
        assert!(!is_post_login_url(&u("https://app.ecamp3.ch/login"), &base));
        assert!(!is_post_login_url(&u("https://app.ecamp3.ch/login/"), &base));
        assert!(!is_post_login_url(&u("https://app.ecamp3.ch/register"), &base));
        assert!(!is_post_login_url(&u("https://app.ecamp3.ch/api/auth/pbsmidata/callback?code=x"), &base));
        assert!(!is_post_login_url(&u("https://db.scout.ch/oauth/authorize?x"), &base));
        assert!(!is_post_login_url(&u("http://app.ecamp3.ch/camps"), &base));
        assert!(!is_post_login_url(&u("about:blank"), &base));
    }

    #[test]
    fn respects_base_path_prefix() {
        let base = u("https://host.ch/ecamp");
        assert!(is_post_login_url(&u("https://host.ch/ecamp/camps"), &base));
        assert!(is_post_login_url(&u("https://host.ch/ecamp"), &base));
        assert!(!is_post_login_url(&u("https://host.ch/ecamp/login"), &base));
        assert!(!is_post_login_url(&u("https://host.ch/other"), &base));
        assert!(!is_post_login_url(&u("https://host.ch/ecampx/camps"), &base));
    }

    #[test]
    fn login_navigation_policy() {
        let prod = u("https://app.ecamp3.ch");
        assert!(is_allowed_login_navigation(&u("https://app.ecamp3.ch/login"), &prod));
        assert!(is_allowed_login_navigation(&u("https://db.scout.ch/oauth/authorize?x"), &prod));
        assert!(is_allowed_login_navigation(&u("https://accounts.google.com/o/oauth2"), &prod));
        // plaintext and local app origins are blocked
        assert!(!is_allowed_login_navigation(&u("http://app.ecamp3.ch/login"), &prod));
        assert!(!is_allowed_login_navigation(&u("http://evil.example/"), &prod));
        assert!(!is_allowed_login_navigation(&u("http://tauri.localhost/"), &prod));
        assert!(!is_allowed_login_navigation(&u("https://tauri.localhost/"), &prod));
        assert!(!is_allowed_login_navigation(&u("http://ipc.localhost/api_get"), &prod));
        assert!(!is_allowed_login_navigation(&u("tauri://localhost/"), &prod));
        assert!(!is_allowed_login_navigation(&u("http://localhost:1420/"), &prod));
        assert!(!is_allowed_login_navigation(&u("http://localhost:3000/"), &prod));
        assert!(!is_allowed_login_navigation(&u("javascript:alert(1)"), &prod));
        assert!(!is_allowed_login_navigation(&u("data:text/html,x"), &prod));
        assert!(!is_allowed_login_navigation(&u("file:///C:/x.html"), &prod));
        // loopback dev instance: http only on its own origin, never the app dev server
        let local = u("http://localhost:3000");
        assert!(is_allowed_login_navigation(&u("http://localhost:3000/login"), &local));
        assert!(!is_allowed_login_navigation(&u("http://localhost:1420/"), &local));
        assert!(!is_allowed_login_navigation(&u("http://localhost:4000/"), &local));
        let dev_clash = u("http://localhost:1420");
        assert!(!is_allowed_login_navigation(&u("http://localhost:1420/login"), &dev_clash));
    }

    #[test]
    fn redacts_query_and_fragment() {
        assert_eq!(
            redact_url(&u("https://app.ecamp3.ch/api/auth/pbsmidata/callback?code=SECRET&state=S#frag")),
            "https://app.ecamp3.ch/api/auth/pbsmidata/callback"
        );
        assert_eq!(redact_url(&u("http://localhost:3000/login")), "http://localhost:3000/login");
        assert_eq!(redact_url(&u("about:blank")), "about");
    }
}
