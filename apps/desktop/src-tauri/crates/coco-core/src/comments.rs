//! Validation for the only eCamp write access: comments.

use regex::Regex;
use serde_json::{json, Map, Value};
use std::sync::OnceLock;

use crate::CoreError;

pub const MAX_COMMENT_CHARS: usize = 1024;
pub const COMMENTS_PATH: &str = "/api/comments";

fn re(cell: &'static OnceLock<Regex>, pat: &str) -> &'static Regex {
    cell.get_or_init(|| Regex::new(pat).expect("static regex"))
}

fn is_iri(kind: &str, s: &str) -> bool {
    static CAMP: OnceLock<Regex> = OnceLock::new();
    static ACT: OnceLock<Regex> = OnceLock::new();
    static COM: OnceLock<Regex> = OnceLock::new();
    match kind {
        "camps" => re(&CAMP, r"^/api/camps/[A-Za-z0-9]+$").is_match(s),
        "activities" => re(&ACT, r"^/api/activities/[A-Za-z0-9]+$").is_match(s),
        "comments" => re(&COM, r"^/api/comments/[A-Za-z0-9]+$").is_match(s),
        _ => false,
    }
}

/// Only escaped text with `<br>` line breaks is accepted: any other `<` is rejected.
fn check_html_safe(text: &str) -> Result<(), CoreError> {
    let stripped = text.replace("<br>", "").replace("<br/>", "").replace("<br />", "");
    if stripped.contains('<') || stripped.contains('>') {
        return Err(CoreError::Invalid("Der Kommentar darf kein HTML enthalten (nur Zeilenumbrüche)".into()));
    }
    Ok(())
}

fn check_text(text: &str) -> Result<(), CoreError> {
    if text.trim().is_empty() {
        return Err(CoreError::Invalid("Der Kommentartext ist leer".into()));
    }
    if text.chars().count() > MAX_COMMENT_CHARS {
        return Err(CoreError::Invalid(format!("Der Kommentar ist länger als {MAX_COMMENT_CHARS} Zeichen")));
    }
    Ok(())
}

/// Validates the arguments of `api_post_comment` and builds the JSON body.
pub fn build_post_body(camp_iri: &str, activity_iri: &str, text_html: &str) -> Result<Value, CoreError> {
    if !is_iri("camps", camp_iri) {
        return Err(CoreError::Invalid("Ungültige Lager-IRI".into()));
    }
    if !is_iri("activities", activity_iri) {
        return Err(CoreError::Invalid("Ungültige Aktivitäts-IRI".into()));
    }
    check_text(text_html)?;
    check_html_safe(text_html)?;
    Ok(json!({ "camp": camp_iri, "activity": activity_iri, "textHtml": text_html }))
}

/// Validates `api_patch_comment` arguments. Returns the path and the patch.
pub fn build_patch(comment_iri: &str, patch: &Value) -> Result<(String, Value), CoreError> {
    if !is_iri("comments", comment_iri) {
        return Err(CoreError::Invalid("Ungültige Kommentar-IRI".into()));
    }
    let obj: &Map<String, Value> =
        patch.as_object().ok_or_else(|| CoreError::Invalid("Der Patch muss ein Objekt sein".into()))?;
    if obj.is_empty() {
        return Err(CoreError::Invalid("Der Patch ist leer".into()));
    }
    for k in obj.keys() {
        if k != "resolved" {
            return Err(CoreError::Invalid(format!("Feld nicht erlaubt: {k}")));
        }
    }
    if let Some(r) = obj.get("resolved") {
        if !r.is_boolean() {
            return Err(CoreError::Invalid("resolved muss true oder false sein".into()));
        }
    }
    Ok((comment_iri.to_string(), patch.clone()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn post_validates() {
        assert!(build_post_body("/api/camps/abc1", "/api/activities/x9", "Hallo").is_ok());
        assert!(build_post_body("/api/camps/abc1/x", "/api/activities/x9", "Hallo").is_err());
        assert!(build_post_body("/api/camps/abc1", "/api/camps/x9", "Hallo").is_err());
        assert!(build_post_body("https://evil/api/camps/a", "/api/activities/x9", "Hallo").is_err());
        assert!(build_post_body("/api/camps/a", "/api/activities/x", "  ").is_err());
        assert!(build_post_body("/api/camps/a", "/api/activities/x", &"ä".repeat(1024)).is_ok());
        assert!(build_post_body("/api/camps/a", "/api/activities/x", &"ä".repeat(1025)).is_err());
    }

    #[test]
    fn patch_validates() {
        assert!(build_patch("/api/comments/q1", &json!({"resolved": true})).is_ok());
        assert!(build_patch("/api/comments/q1", &json!({"textHtml": "x"})).is_err());
        assert!(build_post_body("/api/camps/a", "/api/activities/x", "a<br>b &lt;").is_ok());
        assert!(build_post_body("/api/camps/a", "/api/activities/x", "<script>").is_err());
        assert!(build_patch("/api/comments/q1", &json!({"resolved": "yes"})).is_err());
        assert!(build_patch("/api/comments/q1", &json!({"camp": "x"})).is_err());
        assert!(build_patch("/api/comments/q1", &json!({})).is_err());
        assert!(build_patch("/api/comments/q1", &json!([1])).is_err());
        assert!(build_patch("/api/comments/q1/../x", &json!({"resolved": true})).is_err());
    }
}
