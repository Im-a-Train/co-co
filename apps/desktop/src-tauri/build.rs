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
    let mut attrs =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS));

    // `cargo test` binaries do not get the Windows application manifest that tauri-build embeds
    // into the app binary. Without the Common-Controls v6 dependency the lib unit-test exe fails
    // to start with STATUS_ENTRYPOINT_NOT_FOUND (0xc0000139, missing `TaskDialogIndirect`).
    // On a native Windows MSVC build we therefore let the linker embed the manifest into EVERY
    // binary (app + tests) and tell tauri-build to skip its own copy (avoids a duplicate
    // RT_MANIFEST resource). Cross-builds from Linux (cargo-xwin / lld-link) keep tauri-build's
    // default manifest; tests are not run there.
    if native_windows_msvc() {
        attrs = attrs.windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest());
        let manifest = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("windows-app-manifest.xml");
        println!("cargo:rerun-if-changed={}", manifest.display());
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTINPUT:{}", manifest.display());
    }

    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}

fn native_windows_msvc() -> bool {
    let target_windows = std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows");
    let target_msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
    let host_windows = std::env::var("HOST").map(|h| h.contains("windows")).unwrap_or(false);
    target_windows && target_msvc && host_windows
}
