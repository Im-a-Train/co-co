//! `discover_instance`: reads `{instance}/environment.js` and the API root
//! (`_links`) to learn API root, cookie prefix, feature flags and OAuth providers.

use std::collections::BTreeMap;

use coco_core::instance::{
    base_url_string, build_instance_info, join_base, normalize_base_url, parse_environment_js, parse_root_links,
    resolve_href, EnvironmentConfig,
};
use coco_core::types::{AuthLog, InstanceInfo};
use reqwest::header::ACCEPT;
use tauri::{AppHandle, Runtime};
use url::Url;

use crate::error::{AppError, AppResult};
use crate::session::{ensure_same_origin, log, read_body_capped, AppState, Instance, HAL_JSON};

/// Upper bound for environment.js and the API root document.
const MAX_DISCOVERY_BODY: usize = 256 * 1024;

/// Discovers the instance (always fetching fresh data) and caches the result.
pub async fn discover<R: Runtime>(app: &AppHandle<R>, state: &AppState, base_url: &str) -> AppResult<Instance> {
    let base = normalize_base_url(base_url)?;
    let base_str = base_url_string(&base);

    let env = fetch_environment(state, &base).await;
    match &env {
        Ok(e) => log(
            app,
            AuthLog::ok(
                "discover-environment",
                Some(format!(
                    "environment.js gelesen: API_ROOT_URL={}, COOKIE_PREFIX={}, VERSION={}",
                    e.api_root_url.as_deref().unwrap_or("-"),
                    e.cookie_prefix.as_deref().unwrap_or("-"),
                    e.version.as_deref().unwrap_or("-")
                )),
            ),
        ),
        Err(err) => log(
            app,
            AuthLog::fail("discover-environment", Some(format!("{err} – verwende Fallback ({base_str}/api)"))),
        ),
    }
    let env = env.ok();

    // First pass without links to learn the API root.
    let pre = build_instance_info(&base, env.as_ref(), &BTreeMap::new())?;
    let api_root = Url::parse(&pre.api_root).map_err(|e| AppError::Unexpected(e.to_string()))?;

    let root: serde_json::Value = match fetch_api_root(state, &api_root).await {
        Ok(v) => v,
        Err(e) => {
            log(app, AuthLog::fail("discover-api-root", Some(e.to_string())));
            return Err(e);
        }
    };
    let links = parse_root_links(&root);
    let info = build_instance_info(&base, env.as_ref(), &links)?;
    log(
        app,
        AuthLog::ok(
            "discover-api-root",
            Some(format!(
                "{} Links, OAuth: {}",
                links.len(),
                if info.oauth_providers.is_empty() { "-".to_string() } else { info.oauth_providers.join(", ") }
            )),
        ),
    );

    let instance = make_instance(info, base, api_root, &links);
    if let Ok(mut cache) = state.instances.lock() {
        cache.insert(base_str, instance.clone());
    }
    Ok(instance)
}

/// Returns the cached instance for `base_url` or discovers it.
pub async fn get_or_discover<R: Runtime>(app: &AppHandle<R>, state: &AppState, base_url: &str) -> AppResult<Instance> {
    let key = base_url_string(&normalize_base_url(base_url)?);
    let cached = state.instances.lock().ok().and_then(|c| c.get(&key).cloned());
    match cached {
        Some(i) => Ok(i),
        None => discover(app, state, base_url).await,
    }
}

fn make_instance(info: InstanceInfo, base: Url, api_root: Url, links: &BTreeMap<String, String>) -> Instance {
    let origins = coco_core::origin::session_origins(&base, &api_root);
    // Only accept link targets on the instance/API origins; fall back to the documented defaults.
    let link_or = |rel: &str, default_rel: &str| -> Url {
        links
            .get(rel)
            .and_then(|href| resolve_href(&api_root, href).ok())
            .filter(|u| origins.contains(&u.origin()))
            .unwrap_or_else(|| {
                let s = format!("{}/{}", api_root.as_str().trim_end_matches('/'), default_rel);
                Url::parse(&s).unwrap_or_else(|_| api_root.clone())
            })
    };
    let login_url = link_or("login", "authentication_token");
    let refresh_url = link_or("refreshToken", "token/refresh");
    Instance { info, base, api_root, login_url, refresh_url }
}

async fn fetch_environment(state: &AppState, base: &Url) -> AppResult<EnvironmentConfig> {
    let url = join_base(base, "environment.js")?;
    let resp = state.http.get(url).header(ACCEPT, "application/javascript, */*;q=0.5").send().await?;
    ensure_same_origin(&resp, base)?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Status { status: status.as_u16(), detail: Some("environment.js".into()) });
    }
    let bytes = read_body_capped(resp, MAX_DISCOVERY_BODY).await?;
    let text = String::from_utf8_lossy(&bytes);
    let env = parse_environment_js(&text);
    if env.raw.is_empty() {
        return Err(AppError::Unexpected("environment.js enthält keine Konfiguration".into()));
    }
    Ok(env)
}

async fn fetch_api_root(state: &AppState, api_root: &Url) -> AppResult<serde_json::Value> {
    let resp = state.http.get(api_root.clone()).header(ACCEPT, HAL_JSON).send().await?;
    ensure_same_origin(&resp, api_root)?;
    let status = resp.status();
    if !status.is_success() {
        return Err(AppError::Status { status: status.as_u16(), detail: Some(format!("API-Root {api_root}")) });
    }
    let bytes = read_body_capped(resp, MAX_DISCOVERY_BODY).await?;
    let v: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| AppError::Unexpected(format!("API-Root {api_root} lieferte kein JSON – ist das eine eCamp-v3-Instanz?")))?;
    if v.get("_links").is_none() {
        return Err(AppError::Unexpected(format!("API-Root {api_root} enthält keine _links")));
    }
    Ok(v)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn make_instance_uses_links_on_same_origin_only() {
        let base = Url::parse("https://app.ecamp3.ch").unwrap();
        let api = Url::parse("https://app.ecamp3.ch/api").unwrap();
        let info = build_instance_info(&base, None, &BTreeMap::new()).unwrap();
        let mut links = BTreeMap::new();
        links.insert("login".to_string(), "/api/authentication_token".to_string());
        links.insert("refreshToken".to_string(), "https://evil.example/steal".to_string());
        let i = make_instance(info, base, api, &links);
        assert_eq!(i.login_url.as_str(), "https://app.ecamp3.ch/api/authentication_token");
        assert_eq!(i.refresh_url.as_str(), "https://app.ecamp3.ch/api/token/refresh");
    }
}
