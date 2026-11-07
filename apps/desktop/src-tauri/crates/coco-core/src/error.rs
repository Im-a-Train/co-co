use thiserror::Error;

/// Errors of the pure core. Messages never contain cookie values or passwords.
#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum CoreError {
    #[error("Ungültige URL: {0}")]
    InvalidUrl(String),
    #[error("Unsicheres Schema: nur https ist erlaubt (http nur für localhost): {0}")]
    InsecureScheme(String),
    #[error("Pfad nicht erlaubt: {0}")]
    PathNotAllowed(String),
    #[error("Fremder Host nicht erlaubt: {0}")]
    ForeignOrigin(String),
    #[error("JWT-Cookie ungültig: {0}")]
    InvalidJwt(String),
}
