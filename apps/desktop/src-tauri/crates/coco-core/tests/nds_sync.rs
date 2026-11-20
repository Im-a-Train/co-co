use coco_core::nds::{ensure_query_only, graphql_body};
use coco_core::nds_sync::*;
use serde_json::{json, Value};

fn fx(s: &str) -> Value {
    serde_json::from_str(s).expect("fixture json")
}

fn activities() -> Value {
    fx(include_str!("fixtures/nds_sync/activities.json"))
}

fn attendance() -> NdsAttendance {
    let refs = activity_refs(&activities());
    let parts = fx(include_str!("fixtures/nds_sync/participants.json"));
    let sups = fx(include_str!("fixtures/nds_sync/supervisors.json"));
    let null = Value::Null;
    let read: Vec<RawActivityAttendance> = refs
        .iter()
        .map(|a| RawActivityAttendance {
            activity: a,
            participants: parts.get(&a.business_id).unwrap_or(&null),
            supervisors: sups.get(&a.business_id).unwrap_or(&null),
        })
        .collect();
    reduce_attendances(6, &read, true)
}

fn camp_details() -> NdsCampDetails {
    let offer = json!({"hasLateSubmittedOfferItems":true,"hasOfferItemsInCorrection":false,"evaluationState":null,"hasHandicapRegistration":"yes"});
    reduce_camp_details(
        &fx(include_str!("fixtures/nds_sync/camp_details.json")),
        &fx(include_str!("fixtures/nds_sync/timeline.json")),
        &offer,
    )
    .unwrap()
}

fn protocol() -> NdsProtocol {
    let v = fx(include_str!("fixtures/nds_sync/protocol.json"));
    reduce_protocol(v.as_array().unwrap(), false)
}

fn recognitions() -> NdsRecognitionsResult {
    let v = fx(include_str!("fixtures/nds_sync/recognitions.json"));
    let sups = [
        json!({"educationSupplement":{"name":{"de":"Bergsport"}}}),
        json!({"rowTitle":{"de":"Wasser"}}),
        json!({"educationSupplement":{"name":{"de":"Bergsport"}}}),
        json!({}),
    ];
    reduce_recognitions(v.as_array().unwrap(), &sups, vec!["JS_COACH".into()], "2026-11-20T10:00:00Z")
}

fn profile() -> NdsCoachProfile {
    let v = fx(include_str!("fixtures/nds_sync/coach_profile.json"));
    reduce_coach_profile(v["relations"].as_array().unwrap(), v["biography"].as_array().unwrap(), "now")
}

// ---------------------------------------------------------------- activities / attendance

#[test]
fn activity_refs_parse_and_skip() {
    let refs = activity_refs(&activities());
    let ids: Vec<&str> = refs.iter().map(|r| r.business_id.as_str()).collect();
    assert_eq!(ids, ["7001", "7002", "7003", "7005"]);
    assert_eq!(refs[0].date.as_deref(), Some("2026-07-18"));
    assert_eq!(refs[0].overlap_count, Some(2));
    assert_eq!(refs[1].date.as_deref(), Some("2026-07-19"));
    assert_eq!(refs[2].overlap_count, None);
    assert_eq!(refs[3].date, None);
    assert_eq!(refs[3].state.as_deref(), Some("WEIRD_STATE"));
    assert_eq!(refs[3].overlap_count, None);
    assert!(activity_refs(&Value::Null).is_empty());
    assert_eq!(activity_refs(&json!([{"businessId":"-5"},{"businessId":"123456789012345678901"}])).len(), 1);
}

#[test]
fn attendance_counts() {
    let a = attendance();
    assert_eq!(a.activities_total, 6);
    assert_eq!(a.activities_read, 4);
    assert_eq!(a.activities_checked, 2);
    assert!(a.truncated);
    assert_eq!(a.participants, 5);
    assert_eq!(a.supervisors, 2);
    assert_eq!(a.participants_never_present, 2); // 9002, 9004
    assert_eq!(a.participants_not_eligible, 1);
    assert_eq!(a.overlap_participants, 2); // 9003, 9002
    assert_eq!(a.overlap_supervisors, 1);
    assert_eq!(a.overlap_activities, 2);
    assert_eq!(a.overlap_offer_numbers, ["N-2", "N-3"]);
    assert_eq!(a.overlap_dates, ["2026-07-18", "2026-07-20"]);
    assert_eq!(a.mountain_guides, 1);
    assert_eq!(
        a.by_date,
        vec![
            NdsDateAttendance { date: "2026-07-18".into(), activities: 1, participants_present: 3, supervisors_present: 2 },
            NdsDateAttendance { date: "2026-07-19".into(), activities: 1, participants_present: 1, supervisors_present: 1 },
        ]
    );
}

#[test]
fn attendance_empty_and_messy() {
    let a = reduce_attendances(0, &[], false);
    assert_eq!(a, NdsAttendance::default());
    let act = NdsActivityRef {
        business_id: "1".into(),
        date: Some("2026-07-18".into()),
        state: Some(ATTENDANCE_CHECKED_STATE.into()),
        overlap_count: None,
    };
    let junk = json!("junk");
    let rows = json!([{"wasPresent":"true","person":"x"}, 5, null, {"person":{"businessId":""}}]);
    let r = reduce_attendances(
        1,
        &[RawActivityAttendance { activity: &act, participants: &rows, supervisors: &junk }],
        false,
    );
    assert_eq!(r.participants, 0);
    assert_eq!(r.participants_never_present, 0);
    assert_eq!(r.activities_checked, 1);
    assert_eq!(r.by_date.len(), 1);
    assert_eq!(r.by_date[0].participants_present, 0);
}

#[test]
fn attendance_offer_numbers_capped_at_20() {
    let act = NdsActivityRef { business_id: "1".into(), date: None, state: None, overlap_count: None };
    let overlaps: Vec<Value> = (0..30).map(|i| json!({"offerNumber": format!("N-{i:02}")})).collect();
    let rows = json!([{"person":{"businessId":"1"},"overlaps":overlaps}]);
    let none = Value::Null;
    let r = reduce_attendances(
        1,
        &[RawActivityAttendance { activity: &act, participants: &rows, supervisors: &none }],
        false,
    );
    assert_eq!(r.overlap_offer_numbers.len(), 20);
    assert_eq!(r.overlap_offer_numbers[0], "N-00");
    assert!(r.overlap_dates.is_empty());
    assert_eq!(r.overlap_activities, 1);
}

// ---------------------------------------------------------------- camp details

#[test]
fn camp_details_merge() {
    let d = camp_details();
    assert_eq!(d.risk_activities_planned, Some(true)); // camp/details wins
    assert_eq!(d.risk_activity_answers, [Some(false), Some(true), Some(true)]);
    assert_eq!(d.overnight_stay, Some(true));
    assert_eq!(d.supervisor_expertise_present, Some(true));
    assert_eq!(d.late_submission, Some(false));
    assert_eq!(d.approval_with_reservation, Some(true));
    assert_eq!(d.camp_days_with_activities, Some(5));
    assert_eq!(d.camp_days_without_activities, None);
    assert_eq!(d.activity_duration_first_day.as_deref(), Some("PT4H"));
    assert_eq!(d.activity_duration_last_day.as_deref(), Some("3.5"));
    assert_eq!(d.present.male_children, Some(4));
    assert_eq!(d.present.female_children, Some(5));
    assert_eq!(d.present.male_adolescents, Some(0));
    assert_eq!(d.present.female_adolescents, None);
    assert_eq!(d.present.supervisors, Some(3));
    assert_eq!(d.subsidies, NdsSubsidies { planned: Some(1200.5), actual: None, total: Some(900.0) });
    assert_eq!(
        d.minimal_requirements_messages.as_deref(),
        Some(&["Mindestens 3 Leitende", "Nur Objekt de", "Msg", "Texte fr"].map(String::from)[..])
    );
    assert_eq!(d.offer_flags.late_submitted_items, Some(true));
    assert_eq!(d.offer_flags.items_in_correction, Some(false));
    assert_eq!(d.offer_flags.handicap_registration, None);
    assert_eq!(d.offer_flags.evaluation_state, None);
}

#[test]
fn camp_details_fallbacks_and_none() {
    assert!(reduce_camp_details(&Value::Null, &json!([]), &json!("x")).is_none());
    let t = json!({"offerItem":{"riskActivitiesPlanned":true,"overnightStay":false,"minimalRequirementsCheckResultMessages":["A"]}});
    let d = reduce_camp_details(&Value::Null, &t, &Value::Null).unwrap();
    assert_eq!(d.risk_activities_planned, Some(true));
    assert_eq!(d.overnight_stay, Some(false));
    assert_eq!(d.minimal_requirements_messages, Some(vec!["A".to_string()]));
    let d = reduce_camp_details(&json!({}), &Value::Null, &Value::Null).unwrap();
    assert_eq!(d, NdsCampDetails::default());
    // null messages -> None, empty array -> Some(empty)
    let d = reduce_camp_details(&json!({"minimalRequirementsCheckResultMessages":null}), &Value::Null, &Value::Null).unwrap();
    assert_eq!(d.minimal_requirements_messages, None);
    let d = reduce_camp_details(&json!({"minimalRequirementsCheckResultMessages":[]}), &Value::Null, &Value::Null).unwrap();
    assert_eq!(d.minimal_requirements_messages, Some(vec![]));
}

#[test]
fn camp_details_message_limits_are_char_safe() {
    let long = "ä".repeat(500);
    let many: Vec<Value> = (0..30).map(|i| json!(format!("m{i}"))).collect();
    let d = reduce_camp_details(
        &json!({"minimalRequirementsCheckResultMessages": [long]}),
        &Value::Null,
        &Value::Null,
    )
    .unwrap();
    assert_eq!(d.minimal_requirements_messages.unwrap()[0].chars().count(), MAX_LABEL_CHARS);
    let d = reduce_camp_details(&json!({"minimalRequirementsCheckResultMessages": many}), &Value::Null, &Value::Null).unwrap();
    assert_eq!(d.minimal_requirements_messages.unwrap().len(), 20);
}

// ---------------------------------------------------------------- protocol

#[test]
fn classification_table() {
    use NdsProtocolKind::*;
    for (label, want) in [
        ("Gesuch eingereicht", Submitted),
        ("EINGEREICHT", Submitted),
        ("Gesuch bewilligt", Approved), // specific keywords win over «gesuch»
        ("Gesuch zur Prüfung", Assessment),
        ("Abrechnung eingereicht", Closed),
        ("Angebot bewilligt", Approved),
        ("Bewilligung", Approved),
        ("Bewilligung abgelehnt", Other),
        ("Nicht bewilligt", Other),
        ("Zur Bewilligung zurückgewiesen", Other),
        ("Beurteilung", Assessment),
        ("Schlussprüfung", Assessment),
        ("Abgeschlossen", Closed),
        ("Abschluss", Closed),
        ("Abgerechnet", Closed),
        ("Abrechnung erstellt", Closed),
        ("Ausbezahlt", Paid),
        ("Bezahlt", Paid),
        ("Zahlung ausgelöst", Paid),
        ("Irgendwas anderes", Other),
        ("", Other),
    ] {
        assert_eq!(classify_protocol_label(label), want, "{label}");
    }
}

#[test]
fn protocol_reduces_sorted_with_dates() {
    let p = protocol();
    let at: Vec<&str> = p.events.iter().map(|e| e.at.as_str()).collect();
    assert_eq!(
        at,
        ["2026-03-01T08:00:00", "2026-03-05T08:00:00", "2026-03-10T09:00:00", "2026-08-01T08:00:00", "2026-08-20T08:00:00"]
    );
    assert_eq!(p.events[3].label, "Beurteilung offen"); // fr fallback
    assert_eq!(p.events[0].date, "2026-03-01");
    assert_eq!(p.submitted_on.as_deref(), Some("2026-03-01"));
    assert_eq!(p.approved_on.as_deref(), Some("2026-03-10"));
    assert_eq!(p.closed_on.as_deref(), Some("2026-08-20"));
    assert!(!p.truncated);
}

#[test]
fn protocol_closed_falls_back_to_assessment_and_empty() {
    let items = [json!({"createdTimestamp":"2026-08-01T08:00:00","protocolType":{"de":"Beurteilung"}})];
    let p = reduce_protocol(&items, false);
    assert_eq!(p.closed_on.as_deref(), Some("2026-08-01"));
    assert_eq!(p.submitted_on, None);
    assert_eq!(reduce_protocol(&[], true), NdsProtocol { truncated: true, ..Default::default() });
}

#[test]
fn protocol_cap_and_label_trim() {
    let items: Vec<Value> = (0..(MAX_PROTOCOL_EVENTS + 5))
        .map(|i| json!({"createdTimestamp": format!("2026-01-01T00:{:02}:{:02}", i / 60, i % 60), "protocolType": {"de": format!("  Ereignis {i} {}  ", "x".repeat(300))}}))
        .collect();
    let p = reduce_protocol(&items, false);
    assert_eq!(p.events.len(), MAX_PROTOCOL_EVENTS);
    assert!(p.truncated);
    assert!(p.events[0].at.ends_with("00:00:00")); // oldest kept
    assert_eq!(p.events[0].label.chars().count(), MAX_LABEL_CHARS);
    assert!(!reduce_protocol(&items[..3], false).truncated);
    assert!(reduce_protocol(&items[..3], true).truncated);
}

// ---------------------------------------------------------------- recognitions

#[test]
fn recognition_filter_shape() {
    assert_eq!(
        recognition_filter("7001", "JS_COACH"),
        json!({"educationField":{"selected":"JS_COACH"},"person":{"selected":"7001"}})
    );
}

#[test]
fn recognitions_dedup_sort_and_supplements() {
    let r = recognitions();
    let ids: Vec<&str> = r.recognitions.iter().map(|x| x.business_id.as_str()).collect();
    assert_eq!(ids, ["5001", "5005", "5002", "5003"]);
    let c = &r.recognitions[2];
    assert_eq!(c.title, "J+S-Coach Kindersport"); // cadre.name beats rowTitle, first duplicate wins
    assert_eq!(c.education_field.as_deref(), Some("JS_COACH"));
    assert_eq!(c.state.as_deref(), Some("VALID"));
    assert_eq!(c.valid_from.as_deref(), Some("2024-01-01"));
    assert_eq!(c.valid_until.as_deref(), Some("2027-12-31"));
    assert_eq!(c.target_audience_group.as_deref(), Some("CHILDREN"));
    assert_eq!(c.sport.as_deref(), Some("Leichtathletik"));
    assert_eq!(
        c.supplements,
        vec![NdsRecognitionSupplement {
            title: "Berg".into(),
            valid_from: Some("2025-01-01".into()),
            valid_until: Some("2026-12-31".into())
        }]
    );
    let a = &r.recognitions[0];
    assert_eq!(a.title, "Row A");
    assert_eq!(a.omitted_since.as_deref(), Some("2025-07-01"));
    assert_eq!(a.invalid_since, None);
    assert_eq!(r.recognitions[3].title, "Cadre fr");
    assert_eq!(r.recognitions[3].valid_until, None);
    assert_eq!(r.person_supplements, ["Bergsport", "Wasser"]);
    assert_eq!(r.failed_fields, ["JS_COACH"]);
    assert_eq!(r.fetched_at, "2026-11-20T10:00:00Z");
}

// ---------------------------------------------------------------- coach profile / detection

#[test]
fn coach_profile_reduces() {
    let p = profile();
    assert_eq!(p.organisations.len(), 2);
    let o = &p.organisations[0];
    assert_eq!((o.business_id.as_str(), o.name.as_str()), ("6001", "Pfadi Testland"));
    assert_eq!(o.relation_type.as_deref(), Some("MEMBER"));
    assert_eq!(o.offer_groups, ["JS_KIDS", "JS_YOUTH"]);
    assert_eq!(o.since.as_deref(), Some("2019-05-01"));
    assert_eq!(p.organisations[1].business_id, "6003");
    assert_eq!(p.organisations[1].name, "Scouts");
    let ids: Vec<&str> = p.finished_offers.iter().map(|o| o.offer_business_id.as_str()).collect();
    assert_eq!(ids, ["4002", "4001", "4003"]);
    let f = &p.finished_offers[1];
    assert_eq!(f.offer_number.as_deref(), Some("N-100"));
    assert_eq!(f.organisation_name.as_deref(), Some("Pfadi Testland"));
    assert_eq!((f.start.as_deref(), f.end.as_deref()), (Some("2024-07-01"), Some("2024-07-08")));
    assert_eq!((f.camp_count, f.course_count), (Some(1), Some(0)));
    assert_eq!(f.sports, ["Pfadi"]);
    assert_eq!(p.finished_offers[0].end.as_deref(), Some("2025-07-01"));
    assert_eq!(p.finished_offers[2].start, None);
    assert_eq!(p.fetched_at, "now");
}

#[test]
fn organisation_names() {
    let items = [
        json!({"businessId":"1","organisation":{"name":{"resolvedLocalizedString":{"de":"Abt A"}}}}),
        json!({"businessId":"2","organisation":{"name":{"fr":"Abt B"}}}),
        json!({"businessId":"3","organisation":null}),
        json!({"organisation":{"name":{"de":"x"}}}),
    ];
    let m = offer_organisation_names(&items);
    assert_eq!(m.len(), 2);
    assert_eq!(m["1"], "Abt A");
    assert_eq!(m["2"], "Abt B");
}

fn coaches(ids: &[Value]) -> Vec<Value> {
    ids.iter().map(|i| json!({"businessId":"1","coach":{"businessId":i}})).collect()
}

#[test]
fn detect_person_majority_tie_and_noise() {
    let d = detect_person(&coaches(&[json!("7001"), json!("7001"), json!(7001), json!("9001")]));
    assert_eq!(d, NdsPersonDetection { person_id: Some("7001".into()), offers_seen: 4, offers_matched: 3 });
    // tie
    let d = detect_person(&coaches(&[json!("7001"), json!("9001")]));
    assert_eq!(d, NdsPersonDetection { person_id: None, offers_seen: 2, offers_matched: 0 });
    // below share, 3 distinct
    let d = detect_person(&coaches(&[json!("1"), json!("1"), json!("2"), json!("3"), json!("4")]));
    assert_eq!(d.person_id, None);
    // non numeric / missing ignored
    let mut items = coaches(&[json!("abc"), json!(null), json!("7001")]);
    items.push(json!({"businessId":"2"}));
    let d = detect_person(&items);
    assert_eq!(d, NdsPersonDetection { person_id: Some("7001".into()), offers_seen: 1, offers_matched: 1 });
    assert_eq!(detect_person(&[]), NdsPersonDetection { person_id: None, offers_seen: 0, offers_matched: 0 });
}

// ---------------------------------------------------------------- red-zone guards

#[test]
fn results_contain_no_fixture_person_data() {
    let outputs = [
        serde_json::to_string(&attendance()).unwrap(),
        serde_json::to_string(&camp_details()).unwrap(),
        serde_json::to_string(&protocol()).unwrap(),
        serde_json::to_string(&recognitions()).unwrap(),
        serde_json::to_string(&profile()).unwrap(),
    ];
    for out in &outputs {
        for forbidden in ["Muster", "geheim", "Privatgrund", "9001", "9002", "9003", "8001", "8002", "firstName", "triggeringPerson", "protocolContent", "reason"] {
            assert!(!out.contains(forbidden), "{forbidden} in {out}");
        }
    }
}

const ALL_QUERIES: [&str; 8] = [
    Q_PARTICIPANT_ATTENDANCES,
    Q_SUPERVISOR_ATTENDANCES,
    Q_PROTOCOL,
    Q_RECOGNITIONS,
    Q_PERSON_SUPPLEMENTS,
    Q_ORG_RELATIONS,
    Q_COACH_BIOGRAPHY,
    Q_OFFER_COACHES,
];

#[test]
fn sync_queries_are_read_only() {
    for q in &ALL_QUERIES {
        ensure_query_only(q).expect(q);
    }
    graphql_body(OP_PROTOCOL, json!({}), Q_PROTOCOL).unwrap();
}

#[test]
fn sync_queries_never_request_person_data() {
    for q in &ALL_QUERIES {
        for forbidden in ["firstName", "lastName", "birthDate", "ahvn13", "privateAddress", "triggeringPerson", "protocolContent", "reason"] {
            assert!(!q.contains(forbidden), "{forbidden} in {q}");
        }
    }
}
