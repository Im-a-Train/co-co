//! Pure decisions of the in-app updater (ADR 0017): portable detection, release URL, notes truncation,
//! version validation and the "automatic check" policy. No I/O, no Tauri.

use serde::{Deserialize, Serialize};

/// Max characters of release notes handed to the UI.
pub const MAX_NOTES_CHARS: usize = 2000;
/// Repository that hosts the releases.
pub const RELEASES_BASE: &str = "https://github.com/Im-a-Train/co-co/releases";
/// File the NSIS installer writes next to the main exe; a portable exe has none.
pub const UNINSTALLER_NAME: &str = "uninstall.exe";

/// Result of an update check, as handed to the UI (camelCase).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateInfo {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub date: Option<String>,
    /// True when the update can be installed in place (NSIS install, not portable).
    pub can_install: bool,
    pub portable: bool,
    pub release_url: String,
}

/// An NSIS install keeps `uninstall.exe` next to the main exe. `dir_listing` are the file names of that dir.
pub fn is_portable<S: AsRef<str>>(dir_listing: &[S]) -> bool {
    !dir_listing.iter().any(|n| n.as_ref().eq_ignore_ascii_case(UNINSTALLER_NAME))
}

/// Accepts plain SemVer (optionally with pre-release), nothing else: the value ends up in a URL.
pub fn is_valid_version(v: &str) -> bool {
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let parts: Vec<&str> = core.split('.').collect();
    let num = |s: &str| {
        !s.is_empty() && s.len() <= 9 && s.bytes().all(|b| b.is_ascii_digit()) && (s == "0" || !s.starts_with('0'))
    };
    if parts.len() != 3 || !parts.iter().all(|p| num(p)) {
        return false;
    }
    match pre {
        None => true,
        Some(p) => {
            !p.is_empty()
                && p.len() <= 40
                && p.split('.').all(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-'))
        }
    }
}

/// Release page of `version`; falls back to the releases overview for an invalid version.
pub fn release_url(version: &str) -> String {
    if is_valid_version(version) {
        format!("{RELEASES_BASE}/tag/v{version}")
    } else {
        RELEASES_BASE.to_string()
    }
}

/// Trims, drops control characters except newlines and cuts to `MAX_NOTES_CHARS` (adds an ellipsis).
pub fn truncate_notes(notes: &str) -> String {
    let cleaned: String = notes.chars().filter(|c| *c == '\n' || !c.is_control()).collect();
    let cleaned = cleaned.trim();
    if cleaned.chars().count() <= MAX_NOTES_CHARS {
        return cleaned.to_string();
    }
    let mut out: String = cleaned.chars().take(MAX_NOTES_CHARS - 1).collect();
    out.push('…');
    out
}

/// Unstamped dev builds carry exactly `MAJOR.MINOR.PATCH` (CI stamps `-alpha.N`); debug builds never auto-check.
pub fn auto_check_allowed(version: &str, debug_build: bool) -> bool {
    !debug_build && is_valid_version(version) && version.contains('-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_detection() {
        assert!(!is_portable(&["co-co.exe", "uninstall.exe"]));
        assert!(!is_portable(&["CO-CO.EXE", "Uninstall.exe"]));
        assert!(is_portable(&["co-co.exe"]));
        assert!(is_portable::<&str>(&[]));
    }

    #[test]
    fn version_validation() {
        for ok in ["0.1.0", "0.1.0-alpha.15", "1.2.3-rc.1", "10.0.0"] {
            assert!(is_valid_version(ok), "{ok}");
        }
        for bad in ["", "0.1", "01.1.0", "0.1.0-", "0.1.0-a b", "0.1.0/../x", "v0.1.0", "0.1.0+build", "0.1.0-a..b", "a.b.c"] {
            assert!(!is_valid_version(bad), "{bad}");
        }
    }

    #[test]
    fn release_url_building() {
        assert_eq!(release_url("0.1.0-alpha.9"), "https://github.com/Im-a-Train/co-co/releases/tag/v0.1.0-alpha.9");
        assert_eq!(release_url("../evil"), RELEASES_BASE);
    }

    #[test]
    fn notes_truncation() {
        assert_eq!(truncate_notes("  hi\u{0007} there\nline  "), "hi there\nline");
        let long = "x".repeat(MAX_NOTES_CHARS + 50);
        let t = truncate_notes(&long);
        assert_eq!(t.chars().count(), MAX_NOTES_CHARS);
        assert!(t.ends_with('…'));
        let exact = "y".repeat(MAX_NOTES_CHARS);
        assert_eq!(truncate_notes(&exact), exact);
    }

    #[test]
    fn auto_check_policy() {
        assert!(auto_check_allowed("0.1.0-alpha.3", false));
        assert!(!auto_check_allowed("0.1.0", false));
        assert!(!auto_check_allowed("0.1.0-alpha.3", true));
        assert!(!auto_check_allowed("garbage", false));
    }

    #[test]
    fn info_serializes_camel_case() {
        let i = AppUpdateInfo {
            current_version: "0.1.0-alpha.1".into(),
            available: false,
            version: None,
            notes: None,
            date: None,
            can_install: false,
            portable: true,
            release_url: release_url("0.1.0-alpha.1"),
        };
        let v = serde_json::to_value(&i).unwrap();
        assert_eq!(v["currentVersion"], "0.1.0-alpha.1");
        assert_eq!(v["canInstall"], false);
        assert_eq!(v["releaseUrl"], "https://github.com/Im-a-Train/co-co/releases/tag/v0.1.0-alpha.1");
    }
}
