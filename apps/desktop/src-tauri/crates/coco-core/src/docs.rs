//! Pure helpers for document access and folder watching.

use crate::CoreError;

pub const MAX_DOCUMENT_BYTES: u64 = 25 * 1024 * 1024;
pub const MAX_TEXT_FILE_BYTES: u64 = 100 * 1024 * 1024;

pub fn check_size(size: u64, max: u64) -> Result<(), CoreError> {
    if size > max {
        Err(CoreError::Invalid(format!("Datei ist zu gross (maximal {} MB)", max / 1024 / 1024)))
    } else {
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    Create,
    Modify,
    Remove,
}

impl ChangeKind {
    pub fn as_str(self) -> &'static str {
        match self {
            ChangeKind::Create => "create",
            ChangeKind::Modify => "modify",
            ChangeKind::Remove => "remove",
        }
    }
}

/// Merges two successive events of one path within a debounce window.
/// `None` = the changes cancel out (created and removed again).
pub fn coalesce(prev: ChangeKind, next: ChangeKind) -> Option<ChangeKind> {
    use ChangeKind::*;
    match (prev, next) {
        (Create, Modify) => Some(Create),
        (Create, Remove) => None,
        (Remove, Create) => Some(Modify),
        (Modify, Remove) => Some(Remove),
        (_, n) => Some(n),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ChangeKind::*;

    #[test]
    fn size_cap() {
        assert!(check_size(MAX_DOCUMENT_BYTES, MAX_DOCUMENT_BYTES).is_ok());
        assert!(check_size(MAX_DOCUMENT_BYTES + 1, MAX_DOCUMENT_BYTES).is_err());
    }

    #[test]
    fn coalescing() {
        assert_eq!(coalesce(Create, Modify), Some(Create));
        assert_eq!(coalesce(Create, Remove), None);
        assert_eq!(coalesce(Remove, Create), Some(Modify));
        assert_eq!(coalesce(Modify, Modify), Some(Modify));
        assert_eq!(coalesce(Modify, Remove), Some(Remove));
        assert_eq!(Create.as_str(), "create");
    }
}
