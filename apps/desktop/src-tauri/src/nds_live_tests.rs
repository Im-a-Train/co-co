//! Live smoke test against the real NDS. Needs a logged-in session cookie, so it is ignored:
//!
//! ```sh
//! NDS_E2E_SESSION=<SESSION cookie value> NDS_E2E_FROM=2026-07-01 NDS_E2E_TO=2026-07-31 \
//!   cargo test -p co-co nds_live -- --ignored --nocapture
//! ```
//!
//! Prints only HTTP status codes, field names and counts – never values.

use crate::nds::{detect_person_impl, fetch_aggregate_impl, fetch_coach_profile_impl, fetch_recognitions_impl, fetch_tasks_impl, find_camps_impl, probe_impl, NdsState};

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().filter(|v| !v.is_empty())
}

#[test]
#[ignore = "live network test against NDS, needs NDS_E2E_SESSION"]
fn nds_live_find_probe_and_aggregate() {
    let Some(session) = env("NDS_E2E_SESSION") else {
        panic!("NDS_E2E_SESSION must be set");
    };
    let from = env("NDS_E2E_FROM").unwrap_or_else(|| "2026-01-01".into());
    let to = env("NDS_E2E_TO").unwrap_or_else(|| "2026-12-31".into());
    let state = NdsState::for_test(&session).unwrap();

    let camps = tauri::async_runtime::block_on(find_camps_impl(&state, &from, &to)).unwrap();
    println!("camps found: {}", camps.len());
    let Some(first) = camps.first() else { return };

    let probe = tauri::async_runtime::block_on(probe_impl(&state, &first.camp_business_id)).unwrap();
    for e in &probe.endpoints {
        println!("{}: status={:?} present={} missing={:?}", e.name, e.status, e.fields_present.len(), e.fields_missing);
    }

    match tauri::async_runtime::block_on(fetch_aggregate_impl(&state, &first.offer_business_id, &first.camp_business_id)) {
        Ok(a) => println!(
            "aggregate: participants={} supervisorTypes={} activities={} openAttendance={} rentals={} approved={}",
            a.participant_count,
            a.supervisor_counts.len(),
            a.activities.total,
            a.activities.attendance_open_count,
            a.rental_orders.len(),
            a.approved_on.is_some()
        ),
        Err(e) => println!("aggregate failed: {e}"),
    }
}

#[test]
#[ignore = "live network test against NDS, needs NDS_E2E_SESSION"]
fn nds_live_fetch_tasks() {
    let Some(session) = env("NDS_E2E_SESSION") else {
        panic!("NDS_E2E_SESSION must be set");
    };
    let state = NdsState::for_test(&session).unwrap();
    match tauri::async_runtime::block_on(fetch_tasks_impl(&state)) {
        Ok(t) => println!(
            "tasks: {} (with dueDate: {}, with escalationDate: {})",
            t.len(),
            t.iter().filter(|x| x.due_date.is_some()).count(),
            t.iter().filter(|x| x.escalation_date.is_some()).count()
        ),
        Err(e) => println!("tasks failed: {e}"),
    }
}

#[test]
#[ignore = "live network test against NDS, needs NDS_E2E_SESSION"]
fn nds_live_detect_person_recognitions_profile() {
    let Some(session) = env("NDS_E2E_SESSION") else {
        panic!("NDS_E2E_SESSION must be set");
    };
    let state = NdsState::for_test(&session).unwrap();
    let detected = match tauri::async_runtime::block_on(detect_person_impl(&state)) {
        Ok(d) => {
            println!("detect: found={} seen={} matched={}", d.person_id.is_some(), d.offers_seen, d.offers_matched);
            d.person_id
        }
        Err(e) => {
            println!("detect failed: {e}");
            None
        }
    };
    let Some(person) = env("NDS_E2E_PERSON").or(detected) else {
        println!("no person id (set NDS_E2E_PERSON), skipping recognitions/profile");
        return;
    };
    match tauri::async_runtime::block_on(fetch_recognitions_impl(&state, &person)) {
        Ok(r) => println!(
            "recognitions: {} supplements={} failedFields={:?}",
            r.recognitions.len(),
            r.person_supplements.len(),
            r.failed_fields
        ),
        Err(e) => println!("recognitions failed: {e}"),
    }
    match tauri::async_runtime::block_on(fetch_coach_profile_impl(&state, &person)) {
        Ok(p) => println!("profile: organisations={} finishedOffers={}", p.organisations.len(), p.finished_offers.len()),
        Err(e) => println!("profile failed: {e}"),
    }
}
