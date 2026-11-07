//! Live smoke tests against a real eCamp instance (default: production,
//! `https://app.ecamp3.ch`). They need network access, so they are `#[ignore]`d:
//!
//! ```sh
//! cargo test -p coco-core --test live_ecamp -- --ignored
//! COCO_LIVE_INSTANCE=https://dev.ecamp3.ch cargo test -p coco-core --test live_ecamp -- --ignored
//! ```
//!
//! No credentials are used. The HTTP transport is the system `curl` binary
//! (built into Windows 10+, macOS and most Linux distros), so these tests add
//! no Rust dependency and also run on machines where the full Tauri/reqwest
//! crate cannot be linked. Everything after the transport (environment.js
//! parsing, `_links` parsing, fallbacks, `InstanceInfo` assembly) is the same
//! coco-core code that `discover_instance` uses. The app crate has a matching
//! set of ignored tests (`src/live_tests.rs`) that go through reqwest and
//! the real command functions.

use std::collections::BTreeMap;
use std::process::Command;

use coco_core::instance::{
    build_instance_info, join_base, normalize_base_url, parse_environment_js, parse_root_links, resolve_href,
};
use url::Url;

fn instance() -> String {
    std::env::var("COCO_LIVE_INSTANCE").unwrap_or_else(|_| "https://app.ecamp3.ch".to_string())
}

/// Runs curl and returns (HTTP status, body). Fails the test on transport errors.
fn curl(args: &[&str], url: &str) -> (u16, String) {
    const MARK: &str = "\n__COCO_STATUS__:";
    let out = Command::new("curl")
        .args(["-sS", "--max-time", "30", "-A", "co-co-live-test"])
        .args(args)
        .args(["-w", &format!("{MARK}%{{http_code}}")])
        .arg(url)
        .output()
        .expect("curl konnte nicht gestartet werden (ist curl installiert?)");
    assert!(out.status.success(), "curl {url} fehlgeschlagen: {}", String::from_utf8_lossy(&out.stderr));
    let text = String::from_utf8(out.stdout).expect("UTF-8-Antwort");
    let (body, status) = text.rsplit_once(MARK).expect("Statusmarker fehlt");
    (status.trim().parse().expect("HTTP-Status"), body.to_string())
}

fn expected_prefix(base: &Url) -> String {
    format!("{}_", base.host_str().unwrap().replace('.', "_"))
}

#[test]
#[ignore = "live network test against eCamp"]
fn live_discover_instance() {
    let base = normalize_base_url(&instance()).expect("gültige Instanz-URL");

    // 1. environment.js
    let env_url = join_base(&base, "environment.js").unwrap();
    let (status, js) = curl(&["-H", "Accept: application/javascript, */*;q=0.5"], env_url.as_str());
    assert_eq!(status, 200, "environment.js HTTP-Status");
    let env = parse_environment_js(&js);
    assert!(!env.raw.is_empty(), "environment.js enthält keine Konfiguration");
    println!(
        "environment.js: API_ROOT_URL={:?} COOKIE_PREFIX={:?} FEATURE_COMMENTS={:?} VERSION={:?} ({} Einträge)",
        env.api_root_url,
        env.cookie_prefix,
        env.feature_comments,
        env.version,
        env.raw.len()
    );

    // 2. API root, resolved exactly like discover_instance does
    let pre = build_instance_info(&base, Some(&env), &BTreeMap::new()).unwrap();
    let (status, body) = curl(&["-H", "Accept: application/hal+json"], &pre.api_root);
    assert_eq!(status, 200, "API-Root HTTP-Status");
    let root: serde_json::Value = serde_json::from_str(&body).expect("API-Root ist JSON");
    let links = parse_root_links(&root);
    println!("API-Root-Links: {:?}", links.keys().collect::<Vec<_>>());
    let info = build_instance_info(&base, Some(&env), &links).unwrap();
    println!("InstanceInfo: {}", serde_json::to_string(&info).unwrap());

    // 3. Assertions
    let api_root = format!("{}/api", base.as_str().trim_end_matches('/'));
    assert_eq!(info.api_root, api_root);
    assert_eq!(info.cookie_prefix, expected_prefix(&base));
    if base.host_str() == Some("app.ecamp3.ch") {
        assert_eq!(info.cookie_prefix, "app_ecamp3_ch_");
        assert_eq!(info.api_root, "https://app.ecamp3.ch/api");
    }
    let api = Url::parse(&info.api_root).unwrap();
    for (rel, path) in [("login", "/api/authentication_token"), ("refreshToken", "/api/token/refresh"), ("camps", "/api/camps")] {
        let href = links.get(rel).unwrap_or_else(|| panic!("Link '{rel}' fehlt"));
        assert_eq!(resolve_href(&api, href).unwrap().path(), path, "Link '{rel}'");
    }
    assert!(info.oauth_providers.contains(&"pbsmidata".to_string()), "MiData-OAuth fehlt: {:?}", info.oauth_providers);
}

#[test]
#[ignore = "live network test against eCamp"]
fn live_password_login_with_invalid_account_is_401() {
    let base = normalize_base_url(&instance()).expect("gültige Instanz-URL");
    let login = join_base(&base, "api/authentication_token").unwrap();
    // An account that cannot exist (.invalid TLD, RFC 2606).
    let body = r#"{"identifier":"co-co-smoke-test@example.invalid","password":"definitely-not-a-password"}"#;
    let (status, resp) = curl(
        &[
            "-X",
            "POST",
            "-H",
            "Content-Type: application/json",
            "-H",
            "Accept: application/hal+json",
            "--data-binary",
            body,
        ],
        login.as_str(),
    );
    println!("HTTP {status}: {resp}");
    // The app maps exactly 401 (and 400) to AppError::InvalidCredentials.
    assert_eq!(status, 401, "ungültiger Login muss 401 liefern");
    let v: serde_json::Value = serde_json::from_str(&resp).expect("401-Antwort ist JSON");
    assert!(v.is_object(), "401-Antwort ist ein JSON-Objekt");
}
