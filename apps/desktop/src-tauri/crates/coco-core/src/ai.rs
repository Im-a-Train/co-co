//! Pure parts of the Anthropic Messages call (no HTTP, no key handling).

use serde::Deserialize;
use serde_json::{json, Value};

use crate::CoreError;

pub const ALLOWED_MODELS: &[&str] = &["claude-sonnet-5-5", "claude-opus-5-5", "claude-haiku-5-5"];
pub const MAX_TOKENS_CAP: u32 = 4096;
pub const API_URL: &str = "https://api.anthropic.com/v1/messages";
pub const API_VERSION: &str = "2023-06-01";
pub const KEY_SERVICE: &str = "ch.imatrain.coco";
pub const KEY_USER: &str = "anthropic-api-key";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiRequest {
    pub model: String,
    pub system: String,
    pub prompt: String,
    pub max_tokens: u32,
}

pub fn validate_request(r: &AiRequest) -> Result<(), CoreError> {
    if !ALLOWED_MODELS.contains(&r.model.as_str()) {
        return Err(CoreError::Invalid("Unbekanntes KI-Modell".into()));
    }
    if r.max_tokens == 0 || r.max_tokens > MAX_TOKENS_CAP {
        return Err(CoreError::Invalid(format!("maxTokens muss zwischen 1 und {MAX_TOKENS_CAP} liegen")));
    }
    if r.prompt.trim().is_empty() {
        return Err(CoreError::Invalid("Der Prompt ist leer".into()));
    }
    Ok(())
}

pub fn build_body(r: &AiRequest) -> Value {
    json!({
        "model": r.model,
        "max_tokens": r.max_tokens,
        "system": r.system,
        "messages": [{ "role": "user", "content": r.prompt }],
    })
}

/// Concatenated text blocks plus (input, output) token usage.
pub fn parse_response(v: &Value) -> Result<(String, u64, u64), CoreError> {
    let blocks = v
        .get("content")
        .and_then(Value::as_array)
        .ok_or_else(|| CoreError::Invalid("Antwort ohne Inhalt".into()))?;
    let text: String = blocks
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect();
    let usage = |k: &str| v.get("usage").and_then(|u| u.get(k)).and_then(Value::as_u64).unwrap_or(0);
    Ok((text, usage("input_tokens"), usage("output_tokens")))
}

/// Short error message from an Anthropic error body (never the prompt).
pub fn error_message(body: &[u8]) -> Option<String> {
    let v: Value = serde_json::from_slice(body).ok()?;
    let m = v.get("error")?.get("message")?.as_str()?;
    Some(m.chars().take(200).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req(model: &str, max: u32, prompt: &str) -> AiRequest {
        AiRequest { model: model.into(), system: "s".into(), prompt: prompt.into(), max_tokens: max }
    }

    #[test]
    fn validates() {
        assert!(validate_request(&req("claude-haiku-5-5", 4096, "x")).is_ok());
        assert!(validate_request(&req("gpt-4", 100, "x")).is_err());
        assert!(validate_request(&req("claude-haiku-5-5", 4097, "x")).is_err());
        assert!(validate_request(&req("claude-haiku-5-5", 0, "x")).is_err());
        assert!(validate_request(&req("claude-haiku-5-5", 10, " ")).is_err());
    }

    #[test]
    fn body_shape() {
        let b = build_body(&req("claude-sonnet-5-5", 10, "hi"));
        assert_eq!(b["max_tokens"], 10);
        assert_eq!(b["messages"][0]["role"], "user");
        assert_eq!(b["messages"][0]["content"], "hi");
        assert_eq!(b["system"], "s");
    }

    #[test]
    fn parses() {
        let v = json!({"content":[{"type":"text","text":"a"},{"type":"tool_use"},{"type":"text","text":"b"}],"usage":{"input_tokens":3,"output_tokens":4}});
        assert_eq!(parse_response(&v).unwrap(), ("ab".into(), 3, 4));
        assert!(parse_response(&json!({})).is_err());
        assert_eq!(error_message(br#"{"error":{"message":"bad"}}"#).as_deref(), Some("bad"));
    }

    #[test]
    fn camel_case_deser() {
        let r: AiRequest = serde_json::from_value(json!({"model":"m","system":"","prompt":"p","maxTokens":5})).unwrap();
        assert_eq!(r.max_tokens, 5);
    }
}
