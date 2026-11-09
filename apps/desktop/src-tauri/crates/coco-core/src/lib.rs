//! Pure logic of co-co, kept free of Tauri, reqwest and any OS bindings so it
//! can be unit-tested everywhere (including toolchains that cannot link Tauri).
//!
//! Security rule for everything in here: cookie VALUES and passwords never end
//! up in error messages, `Debug` output meant for logs, or serialized types.

pub mod ai;
pub mod comments;
pub mod cookies;
pub mod datakey;
pub mod docs;
pub mod error;
pub mod instance;
pub mod jwt;
pub mod login;
pub mod mcp;
pub mod midata;
pub mod nds;
pub mod origin;
pub mod persons;
pub mod refresh;
pub mod savefile;
pub mod scope;
pub mod types;

pub use error::CoreError;
