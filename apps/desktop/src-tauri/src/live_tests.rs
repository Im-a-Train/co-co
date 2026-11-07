//! Live smoke tests of the real command logic (reqwest transport) against an
//! eCamp instance (default production). Network access required, so ignored:
//!
//! ```sh
//! cargo test -p co-co live_ -- --ignored
//! COCO_LIVE_INSTANCE=https://dev.ecamp3.ch cargo test -p co-co live_ -- --ignored
//! ```
//!
//! They use Tauri's mock runtime, so no window opens. No credentials are used.
//! Machines that cannot link the Tauri crate (Windows gnu toolchain without
//! dlltool) can run the curl-based twins in `crates/coco-core/tests/live_ecamp.rs`.

use crate::error::AppError;
use crate::session::AppState;

fn instance() -> String {
    std::env::var("COCO_LIVE_INSTANCE").unwrap_or_else(|_| "https://app.ecamp3.ch".to_string())
}

#[test]
#[ignore = "live network test against eCamp"]
fn live_discover_instance() {
    let app = tauri::test::mock_app();
    let state = AppState::new().unwrap();
    let base = instance();
    let inst = tauri::async_runtime::block_on(crate::instance::discover(app.handle(), &state, &base)).unwrap();
    let info = &inst.info;
    println!("InstanceInfo: {}", serde_json::to_string(info).unwrap());

    let host = inst.base.host_str().unwrap().to_string();
    assert_eq!(info.api_root, format!("{}/api", info.base_url));
    assert_eq!(info.cookie_prefix, format!("{}_", host.replace('.', "_")));
    if host == "app.ecamp3.ch" {
        assert_eq!(info.api_root, "https://app.ecamp3.ch/api");
        assert_eq!(info.cookie_prefix, "app_ecamp3_ch_");
    }
    assert!(info.oauth_providers.iter().any(|p| p == "pbsmidata"), "{:?}", info.oauth_providers);
    assert_eq!(inst.login_url.path(), "/api/authentication_token");
    assert_eq!(inst.refresh_url.path(), "/api/token/refresh");
}

#[test]
#[ignore = "live network test against eCamp"]
fn live_password_login_with_invalid_account_is_clean_error() {
    let app = tauri::test::mock_app();
    let state = AppState::new().unwrap();
    let res = tauri::async_runtime::block_on(crate::auth::password_login(
        app.handle(),
        &state,
        &instance(),
        "co-co-smoke-test@example.invalid",
        "definitely-not-a-password",
    ));
    match res {
        Err(AppError::InvalidCredentials) => {}
        other => panic!("erwartet InvalidCredentials, erhalten: {other:?}"),
    }
    assert!(tauri::async_runtime::block_on(state.current()).is_none(), "keine Sitzung nach Fehlschlag");
}
