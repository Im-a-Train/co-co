/// App commands are declared in an app ACL manifest so Tauri enforces the
/// capability check for them too (without a manifest, commands invoked from a
/// local-origin page skip the ACL). Only `main-capability` grants them.
const COMMANDS: &[&str] = &[
    "discover_instance",
    "open_login_window",
    "password_login",
    "session_status",
    "refresh_session",
    "api_get",
    "logout",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
