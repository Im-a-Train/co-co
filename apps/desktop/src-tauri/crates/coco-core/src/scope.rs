//! Allowed-path scope for document access. Paths must already be canonical
//! (the caller canonicalises, so symlinks and `..` cannot escape).

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PathScope {
    #[serde(default)]
    files: BTreeSet<PathBuf>,
    #[serde(default)]
    folders: BTreeSet<PathBuf>,
    /// Readable for this session only (e.g. after `unwatch_folder`); not persisted.
    #[serde(skip)]
    session_folders: BTreeSet<PathBuf>,
}

impl PathScope {
    pub fn add_file(&mut self, p: PathBuf) -> bool {
        self.files.insert(p)
    }
    pub fn add_folder(&mut self, p: PathBuf) -> bool {
        self.session_folders.remove(&p);
        self.folders.insert(p)
    }
    /// Readable for this session only; never persisted. A persisted entry stays persisted.
    pub fn add_session_folder(&mut self, p: PathBuf) -> bool {
        if self.folders.contains(&p) {
            return false;
        }
        self.session_folders.insert(p)
    }
    /// Keeps the folder readable but drops it from the persisted set.
    pub fn demote_folder(&mut self, p: &Path) {
        if self.folders.remove(p) {
            self.session_folders.insert(p.to_path_buf());
        }
    }
    pub fn contains(&self, p: &Path) -> bool {
        self.files.contains(p) || self.folders.iter().chain(self.session_folders.iter()).any(|f| p.starts_with(f))
    }
    pub fn persisted_folders(&self) -> Vec<PathBuf> {
        self.folders.iter().cloned().collect()
    }
    pub fn to_json(&self) -> String {
        serde_json::to_string_pretty(self).unwrap_or_else(|_| "{}".into())
    }
    /// Lenient: broken JSON yields an empty scope.
    pub fn from_json(s: &str) -> Self {
        serde_json::from_str(s).unwrap_or_default()
    }
}

/// Dot-files are hidden everywhere; the Windows hidden attribute is checked by the caller.
pub fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scope_rules() {
        let mut s = PathScope::default();
        s.add_file(PathBuf::from("/a/b.pdf"));
        s.add_folder(PathBuf::from("/docs"));
        assert!(s.contains(Path::new("/a/b.pdf")));
        assert!(!s.contains(Path::new("/a/c.pdf")));
        assert!(s.contains(Path::new("/docs")));
        assert!(s.contains(Path::new("/docs/x/y.txt")));
        assert!(!s.contains(Path::new("/docs2/y.txt")));
        assert!(!s.contains(Path::new("/")));
    }

    #[test]
    fn demote_keeps_session_access_but_not_persisted() {
        let mut s = PathScope::default();
        s.add_folder(PathBuf::from("/docs"));
        s.demote_folder(Path::new("/docs"));
        assert!(s.contains(Path::new("/docs/a.txt")));
        let back = PathScope::from_json(&s.to_json());
        assert!(!back.contains(Path::new("/docs/a.txt")));
    }

    #[test]
    fn json_roundtrip_and_garbage() {
        let mut s = PathScope::default();
        s.add_file(PathBuf::from("/x.gpx"));
        s.add_folder(PathBuf::from("/f"));
        assert_eq!(PathScope::from_json(&s.to_json()), s);
        assert_eq!(PathScope::from_json("nope"), PathScope::default());
    }

    #[test]
    fn hidden() {
        assert!(is_hidden_name(".git"));
        assert!(!is_hidden_name("a.pdf"));
    }
}
