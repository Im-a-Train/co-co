//! Pure logic of co-co, kept free of Tauri, reqwest and any OS bindings so it
//! can be unit-tested everywhere (including toolchains that cannot link Tauri).
//!
//! Security rule for everything in here: cookie VALUES and passwords never end
//! up in error messages, `Debug` output meant for logs, or serialized types.

pub mod cookies;
pub mod error;
pub mod instance;
pub mod jwt;
pub mod login;
pub mod origin;
pub mod refresh;
pub mod types;

pub use error::CoreError;
