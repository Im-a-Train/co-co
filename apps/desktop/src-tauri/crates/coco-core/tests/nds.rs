use coco_core::nds::*;
use serde_json::{json, Value};

fn fx(s: &str) -> Value {
    serde_json::from_str(s).expect("fixture json")
}

fn reduce(supervisors: &Value, activities: &Value) -> NdsAggregate {
    let camp = fx(include_str!("fixtures/nds/camp_details.json"));
    let offer = fx(include_str!("fixtures/nds/offer_details.json"));
    let stats = fx(include_str!("fixtures/nds/statistics.json"));
    let participants = fx(include_str!("fixtures/nds/participants.json"));
    let rental = fx(include_str!("fixtures/nds/rental_orders.json"));
    reduce_aggregate(&RawNdsCamp {
        offer_business_id: "9001",
        camp_business_id: "7001",
        offer_details: &offer,
        camp_details: &camp,
        statistics: &stats,
        activities,
        supervisors,
        participants: &participants,
        rental_orders: &rental,
        fetched_at: "2026-07-01T10:00:00Z",
    })
    .expect("aggregate")
}

fn full() -> NdsAggregate {
    reduce(&fx(include_str!("fixtures/nds/supervisors.json")), &fx(include_str!("fixtures/nds/activities.json")))
}

#[test]
fn query_only_guard() {
    for q in [Q_OFFER_LIST, Q_CAMP_LIST, Q_ACTIVITY_LIST, Q_SUPERVISORS_LIST, Q_PARTICIPANTS_LIST, Q_RENTAL_ORDERS] {
        ensure_query_only(q).expect(q);
    }
    ensure_query_only("# comment\n{ offerList { content { businessId } } }").unwrap();
    for bad in [
        "mutation X { deleteCamp(id: 1) { ok } }",
        "  Mutation X { a }",
        "# query\nmutation X { a }",
        "query A { a }\nmutation B { b }",
        "subscription S { s }",
        "",
        "fragment F on Camp { id }",
    ] {
        assert!(ensure_query_only(bad).is_err(), "{bad}");
    }
    assert!(graphql_body("X", json!({}), "mutation X { a }").is_err());
    assert!(graphql_body("bad name", json!({}), Q_OFFER_LIST).is_err());
}

#[test]
fn queries_never_request_person_data() {
    for q in [Q_OFFER_LIST, Q_CAMP_LIST, Q_ACTIVITY_LIST, Q_SUPERVISORS_LIST, Q_PARTICIPANTS_LIST, Q_RENTAL_ORDERS] {
        for forbidden in
            ["firstName", "lastName", "birthDate", "ahvn13", "address", "Address", "email", "iban", "person", "coach", "rowTitle"]
        {
            assert!(!q.contains(forbidden), "{forbidden} in {q}");
        }
    }
}

#[test]
fn graphql_body_shape() {
    let body = graphql_body("OfferList", chunk_variables(json!({}), 50, 0), Q_OFFER_LIST).unwrap();
    assert_eq!(body["operationName"], "OfferList");
    assert_eq!(body["variables"]["chunk"], json!({"size": 50, "page": 0, "sort": []}));
    assert!(body["query"].as_str().unwrap().starts_with("query OfferList"));
    let v = chunk_variables(json!({"campBusinessId": "7001"}), 10, 2);
    assert_eq!(v["campBusinessId"], "7001");
    assert_eq!(v["chunk"]["page"], 2);
}

#[test]
fn graphql_errors_become_german_errors_without_message_text() {
    let err = graphql_data(&fx(include_str!("fixtures/nds/graphql_error.json"))).unwrap_err().to_string();
    assert!(err.contains("GraphQL-Fehler"), "{err}");
    assert!(err.contains("UNAUTHENTICATED"));
    assert!(!err.contains("Beispiel"));
    assert!(graphql_data(&json!({"data": null})).is_err());
    assert!(graphql_data(&json!({})).is_err());
    assert!(graphql_data(&json!({"errors": [], "data": {"a": 1}})).is_ok());
}

#[test]
fn session_expired_statuses() {
    for s in [401, 403, 302, 307] {
        assert!(is_session_expired_status(s), "{s}");
    }
    for s in [200, 204, 404, 500] {
        assert!(!is_session_expired_status(s), "{s}");
    }
    assert!(SESSION_EXPIRED_MSG.contains("Sitzung abgelaufen"));
}

#[test]
fn chunk_parsing() {
    let doc = fx(include_str!("fixtures/nds/offer_list.json"));
    let (items, pages) = parse_chunk(&doc["data"]["offerList"]).unwrap();
    assert_eq!(items.len(), 5);
    assert_eq!(pages, 1);
    assert_eq!(parse_chunk(&json!({"content": []})).unwrap(), (vec![], 1));
    assert!(parse_chunk(&json!({"totalPages": 2})).is_err());
}

#[test]
fn offers_overlapping_dates() {
    let doc = fx(include_str!("fixtures/nds/offer_list.json"));
    let (items, _) = parse_chunk(&doc["data"]["offerList"]).unwrap();
    let hit = parse_offers_overlapping(&items, "2026-07-20", "2026-07-22").unwrap();
    // 9001 overlaps; 9003 starts 07-24 -> no; id-less and date-less items are skipped
    assert_eq!(hit, vec![("9001".to_string(), Some("4711".to_string()), Some("WAITING_FOR_ASSESSMENT".to_string()))]);
    let hit = parse_offers_overlapping(&items, "2026-07-24", "2026-07-24").unwrap();
    let ids: Vec<_> = hit.iter().map(|h| h.0.as_str()).collect();
    assert_eq!(ids, vec!["9001", "9003"]); // open end (last null) counts as single day; unknown state kept raw
    assert_eq!(hit[1].2.as_deref(), Some("SOME_NEW_STATE"));
    assert!(parse_offers_overlapping(&items, "2025-01-01", "2025-01-02").unwrap().is_empty());
}

#[test]
fn camps_overlapping_dates() {
    let doc = fx(include_str!("fixtures/nds/camp_list.json"));
    let (items, _) = parse_chunk(&doc["data"]["campList"]).unwrap();
    let camps =
        parse_camps_overlapping("9001", Some("4711"), Some("WAITING_FOR_ASSESSMENT"), &items, "2026-07-01", "2026-07-31").unwrap();
    assert_eq!(camps.len(), 1);
    let c = &camps[0];
    assert_eq!(c.camp_business_id, "7001");
    assert_eq!(c.offer_business_id, "9001");
    assert_eq!(c.offer_item_number.as_deref(), Some("1"));
    assert_eq!(c.group_name.as_deref(), Some("Testgruppe Alpha"));
    assert_eq!((c.start.as_deref(), c.end.as_deref()), (Some("2026-07-18"), Some("2026-07-25")));
    let all = parse_camps_overlapping("9001", None, None, &items, "2026-07-01", "2026-08-31").unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[1].offer_item_state.as_deref(), Some("BRAND_NEW_CODE"));
}

#[test]
fn aggregate_full() {
    let a = full();
    assert_eq!((a.offer_business_id.as_str(), a.camp_business_id.as_str()), ("9001", "7001"));
    assert_eq!(a.offer_number.as_deref(), Some("4711"));
    assert_eq!((a.start.as_deref(), a.end.as_deref()), (Some("2026-07-18"), Some("2026-07-25")));
    assert_eq!(a.offer_state.as_deref(), Some("WAITING_FOR_ASSESSMENT"));
    assert_eq!(a.offer_item_state.as_deref(), Some("WAITING_FOR_ASSESSMENT"));
    assert_eq!(a.approved_on.as_deref(), Some("2026-05-03"));
    assert_eq!(a.statistics.planned.children, Some(16));
    assert_eq!(a.statistics.planned.total_participants, Some(20));
    assert_eq!(a.statistics.planned.js_instructors, Some(3));
    assert_eq!(a.statistics.planned.camp_days, Some(8));
    assert_eq!(a.statistics.planned.total_activities, Some(12));
    assert_eq!(a.statistics.actual.children, Some(15));
    assert_eq!(a.statistics.actual.total_participants, None);
    assert_eq!(a.statistics.coach_authorized_for_contribution, Some(true));
    assert_eq!(a.supervisor_counts.get("JS_INSTRUCTOR"), Some(&2));
    assert_eq!(a.supervisor_counts.get("COACH"), Some(&1));
    assert_eq!(a.supervisor_counts.get("UNKNOWN"), Some(&1));
    assert_eq!(a.participant_count, 3);
    assert_eq!(a.participant_counts_by_audience.get("YOUTH_TRAINING"), Some(&2));
    assert_eq!(a.participant_counts_by_audience.get("OTHER_GROUP"), Some(&1));
    assert_eq!(a.activities.total, 5);
    assert_eq!(a.activities.by_state.get("ATTENDANCE_CHECKED"), Some(&2));
    assert_eq!(a.activities.by_state.get("MYSTERY_STATE"), Some(&1));
    assert_eq!(a.activities.by_state.get("UNKNOWN"), Some(&1));
    assert_eq!(a.activities.by_type.get("LAST_CAMP_DAY"), Some(&1));
    assert_eq!(a.activities.last_activity_date.as_deref(), Some("2026-07-25"));
    // only the known open code counts, MYSTERY_STATE and missing states do not
    assert_eq!(a.activities.attendance_open_count, 1);
    assert_eq!(a.camp_agenda_uploaded, Some(true));
    assert_eq!(a.rental_orders.len(), 2);
    assert_eq!(a.rental_orders[0].order_state.as_deref(), Some("FINISHED"));
    assert_eq!(a.rental_orders[0].return_date.as_deref(), Some("2026-07-28"));
    assert_eq!(a.rental_orders[1].order_state.as_deref(), Some("NEW_STATE"));
    assert_eq!(a.rental_orders[1].dispatchment_date, None);
    assert_eq!(a.fetched_at, "2026-07-01T10:00:00Z");
}

#[test]
fn aggregate_tolerates_missing_everything_but_camp_details() {
    let empty = json!({});
    let camp = json!({"offerItemState": "SOMETHING_NEW"});
    let a = reduce_aggregate(&RawNdsCamp {
        offer_business_id: "1",
        camp_business_id: "2",
        offer_details: &empty,
        camp_details: &camp,
        statistics: &empty,
        activities: &Value::Null,
        supervisors: &json!([]),
        participants: &json!({"content": null}),
        rental_orders: &empty,
        fetched_at: "t",
    })
    .unwrap();
    assert_eq!(a.offer_item_state.as_deref(), Some("SOMETHING_NEW"));
    assert_eq!(a.approved_on, None);
    assert_eq!(a.start, None);
    assert_eq!(a.statistics, NdsStatistics::default());
    assert_eq!(a.participant_count, 0);
    assert_eq!(a.activities, NdsActivities::default());
    assert_eq!(a.camp_agenda_uploaded, Some(false));
    assert!(a.rental_orders.is_empty());

    let err = reduce_aggregate(&RawNdsCamp {
        offer_business_id: "1",
        camp_business_id: "2",
        offer_details: &empty,
        camp_details: &Value::Null,
        statistics: &empty,
        activities: &empty,
        supervisors: &empty,
        participants: &empty,
        rental_orders: &empty,
        fetched_at: "t",
    });
    assert!(err.is_err());
}

#[test]
fn approval_falls_back_to_offer() {
    let camp = json!({"duration": {"first": "2026-07-18"}});
    let offer = fx(include_str!("fixtures/nds/offer_details.json"));
    let empty = json!({});
    let a = reduce_aggregate(&RawNdsCamp {
        offer_business_id: "1",
        camp_business_id: "2",
        offer_details: &offer,
        camp_details: &camp,
        statistics: &empty,
        activities: &empty,
        supervisors: &empty,
        participants: &empty,
        rental_orders: &empty,
        fetched_at: "t",
    })
    .unwrap();
    assert_eq!(a.approved_on.as_deref(), Some("2026-05-04"));
    // open-ended camp duration: end falls back to start
    assert_eq!(a.end.as_deref(), Some("2026-07-18"));
}

#[test]
fn aggregate_json_has_no_person_data() {
    let json = serde_json::to_string(&full()).unwrap();
    for forbidden in ["firstName", "lastName", "birthDate", "ahvn13", "Testgruppe", "agenda.pdf"] {
        assert!(!json.contains(forbidden), "{forbidden}");
    }
    let v: Value = serde_json::from_str(&json).unwrap();
    assert!(v.get("offerBusinessId").is_some() && v.get("participantCountsByAudience").is_some());
    assert!(v["statistics"].get("coachAuthorizedForContribution").is_some());
}

#[test]
fn probe_field_names() {
    let doc = fx(include_str!("fixtures/nds/camp_details.json"));
    let (present, missing) = probe_fields(&doc, &["approvalTimestamp", "duration.first", "campAgenda", "nope", "duration.nope"]);
    assert_eq!(present, vec!["approvalTimestamp", "duration.first", "campAgenda"]);
    assert_eq!(missing, vec!["nope", "duration.nope"]);
    let list = fx(include_str!("fixtures/nds/activities.json"));
    let (p, m) = probe_fields(&list, &["content[].activityType", "totalPages", "content[].location"]);
    assert_eq!(p, vec!["content[].activityType", "totalPages"]);
    assert_eq!(m, vec!["content[].location"]);
    let (p, m) = probe_fields(&json!({"content": []}), &["content[].x"]);
    assert!(p.is_empty() && m.len() == 1);
}

#[test]
fn known_closed_states_constant() {
    assert_eq!(KNOWN_CLOSED_STATES, ["WAITING_FOR_ASSESSMENT", "PAYED_CH", "PARTIALLY_PAYED"]);
    assert_eq!(SESSION_COOKIE, "SESSION");
}
