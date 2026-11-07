//! Live M7-0 spike / smoke test against a real MiData instance. Needs
//! credentials, so it is ignored:
//!
//! ```sh
//! MIDATA_E2E_URL=https://db.scout.ch MIDATA_E2E_TOKEN=... MIDATA_E2E_EVENT_ID=123 \
//!   [MIDATA_E2E_GROUP_ID=45] cargo test -p co-co midata_live -- --ignored --nocapture
//! ```
//!
//! Prints only HTTP status codes, field names and counts – never values.

use crate::midata::{fetch_aggregate_impl, probe_impl, MidataState};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

#[test]
#[ignore = "live network test against MiData, needs MIDATA_E2E_* env vars"]
fn midata_live_probe_and_aggregate() {
    let (Some(url), Some(token), Some(event)) = (env("MIDATA_E2E_URL"), env("MIDATA_E2E_TOKEN"), env("MIDATA_E2E_EVENT_ID"))
    else {
        panic!("MIDATA_E2E_URL, MIDATA_E2E_TOKEN and MIDATA_E2E_EVENT_ID must be set");
    };
    let group = env("MIDATA_E2E_GROUP_ID");
    let state = MidataState::for_test(&url, &token).unwrap();

    let probe = tauri::async_runtime::block_on(probe_impl(&state, &event, group.as_deref())).unwrap();
    println!("probe: {}", serde_json::to_string_pretty(&probe).unwrap());

    match tauri::async_runtime::block_on(fetch_aggregate_impl(&state, &event, "2026-07-18", "2026-07-25", None)) {
        Ok(a) => println!(
            "aggregate: participants={} jsAge={} leaders={} bands={} dates={} coachMatch={:?}",
            a.participants_count,
            a.participants_js_age_count,
            a.leaders_count,
            a.age_bands.len(),
            a.event_dates.len(),
            a.coach_match
        ),
        Err(e) => println!("aggregate failed: {e}"),
    }
}
