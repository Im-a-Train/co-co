//! Pure mapping of a suggested save-file name to its save-dialog filter.

use crate::CoreError;

/// Dialog filter (label, extensions) for the extension of `name`; `None` for unsupported extensions.
pub fn save_filter_for(name: &str) -> Option<(&'static str, &'static [&'static str])> {
    let (_, ext) = name.rsplit_once('.')?;
    match ext.to_ascii_lowercase().as_str() {
        "json" => Some(("JSON", &["json"])),
        "ics" => Some(("Kalender (ICS)", &["ics"])),
        "md" => Some(("Markdown", &["md"])),
        "txt" => Some(("Text", &["txt"])),
        _ => None,
    }
}

/// Like [`save_filter_for`] but with a German error for unsupported names.
pub fn require_save_filter(name: &str) -> Result<(&'static str, &'static [&'static str]), CoreError> {
    save_filter_for(name)
        .ok_or_else(|| CoreError::Invalid("Dateityp nicht unterstützt: erlaubt sind .json, .ics, .md und .txt".into()))
}

/// Makes sure `path` ends with one of `exts` (case-insensitive); appends the first one otherwise.
pub fn ensure_extension(path: &str, exts: &[&str]) -> String {
    let lower = path.to_ascii_lowercase();
    if exts.iter().any(|e| lower.ends_with(&format!(".{e}"))) {
        path.to_string()
    } else {
        format!("{path}.{}", exts.first().copied().unwrap_or("txt"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_known_extensions() {
        assert_eq!(save_filter_for("a.json"), Some(("JSON", &["json"][..])));
        assert_eq!(save_filter_for("co-co-fristen.ics"), Some(("Kalender (ICS)", &["ics"][..])));
        assert_eq!(save_filter_for("n.MD"), Some(("Markdown", &["md"][..])));
        assert_eq!(save_filter_for("n.txt"), Some(("Text", &["txt"][..])));
    }

    #[test]
    fn rejects_other_or_missing_extensions() {
        assert_eq!(save_filter_for("a.exe"), None);
        assert_eq!(save_filter_for("noext"), None);
        assert!(require_save_filter("a.exe").is_err());
    }

    #[test]
    fn appends_missing_extension() {
        assert_eq!(ensure_extension("C:/x/fristen", &["ics"]), "C:/x/fristen.ics");
        assert_eq!(ensure_extension("C:/x/fristen.ICS", &["ics"]), "C:/x/fristen.ICS");
    }
}
