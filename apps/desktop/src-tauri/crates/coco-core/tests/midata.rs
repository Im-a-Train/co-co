use coco_core::midata::*;
use serde_json::{json, Value};

fn fx(s: &str) -> Value {
    serde_json::from_str(s).expect("fixture json")
}
fn event() -> Value {
    fx(include_str!("fixtures/midata/event.json"))
}
fn pages() -> Vec<Value> {
    vec![fx(include_str!("fixtures/midata/participations_1.json")), fx(include_str!("fixtures/midata/participations_2.json"))]
}
fn quals() -> Vec<Value> {
    vec![fx(include_str!("fixtures/midata/qualifications.json"))]
}

fn aggregate(coach: Option<&str>) -> MidataAggregate {
    let (ev, p, q) = (event(), pages(), quals());
    reduce_aggregate(&RawEventData {
        base_url: "https://db.example.test",
        event: &ev,
        participation_pages: &p,
        qualification_pages: &q,
        camp_start: "2026-07-18",
        camp_end: "2026-07-25",
        coach_person_id: coach,
        fetched_at: "2026-07-01T10:00:00Z",
        qualifications_readable: true,
        qual_mapping: None,
    })
    .expect("aggregate")
}

#[test]
fn base_url_normalization() {
    assert_eq!(normalize_midata_base_url("db.scout.ch").unwrap(), "https://db.scout.ch");
    assert_eq!(normalize_midata_base_url(" https://db.scout.ch/ ").unwrap(), "https://db.scout.ch");
    assert_eq!(normalize_midata_base_url("https://DB.scout.ch:8443").unwrap(), "https://db.scout.ch:8443");
    assert_eq!(normalize_midata_base_url("http://localhost:3000/").unwrap(), "http://localhost:3000");
    for bad in [
        "http://db.scout.ch",
        "https://db.scout.ch/api",
        "https://db.scout.ch/?a=1",
        "https://db.scout.ch/#x",
        "https://user:pw@db.scout.ch",
        "ftp://db.scout.ch",
        "",
    ] {
        assert!(normalize_midata_base_url(bad).is_err(), "{bad}");
    }
}

#[test]
fn role_classification() {
    use RoleClass::*;
    for (t, c) in [
        ("Event::Camp::Role::Leader", Leader),
        ("Event::Camp::Role::AssistantLeader", Leader),
        ("Event::Camp::Role::LeaderMountainSecurity", Leader),
        ("Event::Camp::Role::LeaderSnowSecurity", Leader),
        ("Event::Camp::Role::LeaderWaterSecurity", Leader),
        ("Event::Course::Role::Leader", Leader),
        ("Event::Role::Leader", Leader),
        ("Event::Role::Participant", Participant),
        ("Event::Course::Role::Participant", Participant),
        ("Event::Camp::Role::Coach", Coach),
        ("Event::Camp::Role::AdvisorMountainSecurity", Other),
        ("Event::Camp::Role::AdvisorSnowSecurity", Other),
        ("Event::Camp::Role::AdvisorWaterSecurity", Other),
        ("Event::Role::Cook", Other),
        ("Event::Role::Helper", Other),
        ("Event::Role::Treasurer", Other),
        ("Event::Role::Speaker", Other),
        ("Event::Camp::Role::Kitchen", Other),
        ("", Other),
    ] {
        assert_eq!(classify_role(t), c, "{t}");
    }
}

#[test]
fn qualification_labels() {
    use QualKey::*;
    assert_eq!(qual_keys_for_label("Zusatz Lagerleiter"), vec![Lagerleiter]);
    assert_eq!(qual_keys_for_label("LAGERLEITER"), vec![Lagerleiter]);
    assert_eq!(qual_keys_for_label("J+S Leiter*in Lagersport/Trekking"), vec![LeiterLsT]);
    assert_eq!(qual_keys_for_label("Leiter LS/T"), vec![LeiterLsT]);
    assert_eq!(qual_keys_for_label("J+S LST Leiter"), vec![LeiterLsT]);
    assert_eq!(qual_keys_for_label("Sicherheitsmodul Wasser"), vec![Wasser]);
    assert_eq!(qual_keys_for_label("Modul BERG"), vec![Berg]);
    assert_eq!(qual_keys_for_label("Sicherheitsmodul Winter"), vec![Winter]);
    assert_eq!(qual_keys_for_label("Schneesport Zusatz"), vec![Winter]);
    assert_eq!(qual_keys_for_label("SLRG Modul See"), vec![Wasser, Slrg, WaterBath, WaterPoolUnsupervised, WaterLake]);
    assert_eq!(qual_keys_for_label("Brevet Plus Pool"), vec![Slrg, WaterBath, WaterPoolUnsupervised]);
    assert_eq!(qual_keys_for_label("Rettungsschwimmer"), vec![Slrg]);
    assert_eq!(qual_keys_for_label("Bergführer Zusatz Lagerleiter"), vec![Lagerleiter, Berg]);
    assert_eq!(qual_keys_for_label("Sicherheitsbereich Berg"), vec![Berg, SbBerg]);
    assert_eq!(qual_keys_for_label("SB Berg"), vec![Berg, SbBerg]);
    assert_eq!(qual_keys_for_label("Sicherheitsbereich Wasser"), vec![Wasser, SbWasser, WaterRiver]);
    assert_eq!(qual_keys_for_label("Sicherheitsbereich Winter"), vec![Winter, SbWinter]);
    assert_eq!(qual_keys_for_label("Modul Wasser LS/T"), vec![LeiterLsT, Wasser, WaterBath, WaterPoolUnsupervised, WaterLake]);
    assert_eq!(qual_keys_for_label("Aufsichtsperson Wasser"), vec![Wasser, WaterBath, WaterPoolUnsupervised, WaterLake]);
    assert_eq!(qual_keys_for_label("SLRG Basis Pool"), vec![Slrg, WaterBath]);
    assert_eq!(qual_keys_for_label("Brevet Basis Pool"), vec![Slrg, WaterBath]);
    assert_eq!(qual_keys_for_label("Modul See"), vec![Wasser, Slrg, WaterBath, WaterPoolUnsupervised, WaterLake]);
    assert_eq!(qual_keys_for_label("Modul Fluss"), vec![Wasser, Slrg, WaterRiver]);
    assert_eq!(qual_keys_for_label("J+S Kanusport Leiter"), vec![WaterBath, WaterPoolUnsupervised, WaterLake]);
    assert!(qual_keys_for_label("Erste Hilfe").is_empty());
    assert!(qual_keys_for_label("First Aid").is_empty());
}

#[test]
fn ages() {
    assert_eq!(age_on("2014-07-18", "2026-07-18"), Some(12));
    assert_eq!(age_on("2014-07-19", "2026-07-18"), Some(11));
    assert_eq!(age_on("2014-07-18T00:00:00+02:00", "2026-07-18"), Some(12));
    assert_eq!(age_on("2026-07-18", "2026-07-18"), Some(0));
    assert_eq!(age_on("2026-07-19", "2026-07-18"), None);
    assert_eq!(age_on("nonsense", "2026-07-18"), None);
    assert_eq!(age_on("2014-02-30", "2026-07-18"), None);
    assert_eq!(age_on("2014-13-01", "2026-07-18"), None);
    assert_eq!(age_on("2014-07-18", "x"), None);
    // leap day: counts on Mar 1 in non-leap years
    assert_eq!(age_on("2012-02-29", "2026-02-28"), Some(13));
    assert_eq!(age_on("2012-02-29", "2026-03-01"), Some(14));
    assert_eq!(age_on("2012-02-29", "2028-02-29"), Some(16));
    assert_eq!(age_on("2012-02-29", "2028-02-28"), Some(15));
}

#[test]
fn event_list() {
    let list = parse_event_list(&fx(include_str!("fixtures/midata/events_list.json"))).unwrap();
    assert_eq!(list.len(), 3);
    assert_eq!(list[0].id, "5001");
    assert_eq!(list[0].name, "Sommerlager Testwald");
    assert_eq!(list[0].start_at.as_deref(), Some("2026-07-18"));
    assert_eq!(list[0].finish_at.as_deref(), Some("2026-07-25"));
    assert_eq!(list[0].location.as_deref(), Some("Testwald"));
    assert_eq!(list[1].id, "6002");
    assert_eq!(list[1].start_at, None);
    assert_eq!(list[1].location, None);
    assert_eq!(list[2].start_at.as_deref(), Some("2026-10-03"));
    assert_eq!(list[2].finish_at.as_deref(), Some("2026-10-10"));
    assert!(parse_event_list(&json!({"foo": 1})).is_err());
}

#[test]
fn event_list_groups_and_types() {
    let doc = fx(include_str!("fixtures/midata/events_groups.json"));
    let all = parse_event_list(&doc).unwrap();
    assert_eq!(all.len(), 5);
    assert!(all[0].group_names.is_empty()); // no groups document -> no names
    assert_eq!(event_group_ids(std::slice::from_ref(&doc)), vec!["11", "12"]);
    let groups = fx(include_str!("fixtures/midata/groups.json"));
    let names = group_names_by_id(&[groups]);
    let named = parse_event_list_with_groups(&doc, false, &names).unwrap();
    assert_eq!(named[0].group_names, vec!["Abteilung Alpha", "Region Nord"]);
    assert!(named[1].group_names.is_empty());
    let camps = parse_event_list_filtered(&doc, true).unwrap();
    let ids: Vec<&str> = camps.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["1", "2", "4", "5"]); // course 3 dropped, untyped kept
}

#[test]
fn rank_events_by_overlap() {
    let doc = fx(include_str!("fixtures/midata/events_groups.json"));
    let list = parse_event_list(&doc).unwrap();
    let r = rank_events(list, "2026-07-04", "2026-08-08", Some("2026-07-18"), Some("2026-07-25"));
    let ids: Vec<&str> = r.iter().map(|e| e.id.as_str()).collect();
    assert_eq!(ids, vec!["1", "2", "3", "4"]); // 5 outside window dropped, undated last
    assert_eq!(r[0].overlap_days, Some(8));
    assert_eq!(r[1].overlap_days, Some(3));
    assert_eq!(r[2].overlap_days, Some(0));
    assert_eq!(r[3].overlap_days, None);
}

#[test]
fn rank_events_nearest_start_breaks_ties() {
    let ev = |id: &str, a: &str, b: &str| MidataEventSummary {
        id: id.into(),
        name: id.into(),
        start_at: Some(a.into()),
        finish_at: Some(b.into()),
        location: None,
        group_names: vec![],
        overlap_days: None,
    };
    let r = rank_events(
        vec![ev("far", "2026-08-05", "2026-08-06"), ev("near", "2026-07-10", "2026-07-12")],
        "2026-07-04",
        "2026-08-08",
        Some("2026-07-18"),
        Some("2026-07-25"),
    );
    assert_eq!(r.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec!["near", "far"]);
}

#[test]
fn links() {
    assert_eq!(next_link(&fx(include_str!("fixtures/midata/events_list.json"))).as_deref(), Some("https://db.example.test/api/events?page[number]=2"));
    assert_eq!(next_link(&pages()[1]), None);
    assert_eq!(next_link(&json!({})), None);
}

#[test]
fn leader_ids_deduped() {
    assert_eq!(leader_person_ids(&pages()), vec!["110", "111", "112", "113"]);
}

#[test]
fn aggregate_counts() {
    let a = aggregate(Some("777"));
    assert_eq!(a.zone, "red-derived");
    assert_eq!(a.event_id, "5001");
    assert_eq!(a.event_name, "Sommerlager Testwald");
    assert_eq!(a.location.as_deref(), Some("Testwald"));
    assert_eq!(a.maximum_participants, Some(40));
    assert_eq!(a.event_dates, vec![EventDate { start_at: "2026-07-18".into(), finish_at: "2026-07-25".into() }]);
    assert_eq!(a.participants_count, 7);
    assert_eq!(a.participants_without_birthday, 1);
    // ages: 12, 11, 14, 21, 4, -, 10
    assert_eq!(a.participants_js_age_count, 4);
    assert_eq!(a.min_age, Some(4));
    assert_eq!(a.max_age, Some(21));
    assert_eq!(a.age_bands.len(), 7);
    let counts: Vec<u32> = a.age_bands.iter().map(|b| b.count).collect();
    assert_eq!(counts, vec![1, 0, 1, 3, 0, 0, 1]);
    assert_eq!(a.age_bands[6].to, None);
    assert_eq!(a.fetched_at, "2026-07-01T10:00:00Z");
    assert_eq!(a.base_url, "https://db.example.test");
}

#[test]
fn aggregate_leaders_and_qualifications() {
    use QualKey::*;
    let a = aggregate(None);
    assert_eq!(a.leaders_count, 4);
    let names: Vec<&str> = a.leaders.iter().map(|l| l.nickname.as_str()).collect();
    assert_eq!(names, vec!["Fuchs", "Ida", "Leiter/in 1", "Mira"]);
    for l in &a.leaders {
        assert_eq!(l.qualifications.len(), 13);
    }
    let fuchs = &a.leaders[0];
    assert_eq!(fuchs.role_label, "Hauptleitung");
    assert!(fuchs.main_leader);
    assert!(a.leaders.iter().any(|l| !l.main_leader));
    let q = &fuchs.qualifications;
    assert!(q[&Lagerleiter] && q[&LeiterLsT] && q[&Slrg]);
    assert!(!q[&Wasser], "expires mid camp");
    assert!(!q[&Berg], "starts after camp start");
    assert!(!q[&Winter]);
    let mira = &a.leaders[3];
    assert!(mira.qualifications[&LeiterLsT]);
    assert!(!mira.qualifications[&Lagerleiter]);
    assert!(a.leaders[2].qualifications.values().all(|v| !v));
    // cook is not a leader nor participant
    assert!(!a.leaders.iter().any(|l| l.nickname.contains("Kuechenfee")));
}

#[test]
fn coach_match() {
    assert_eq!(aggregate(Some("777")).coach_match, Some(true));
    assert_eq!(aggregate(Some("778")).coach_match, Some(false));
    assert_eq!(aggregate(None).coach_match, None);
    let mut ev = event();
    ev["data"]["attributes"]["advisor_id"] = json!("777");
    let (p, q) = (pages(), quals());
    let raw = |ev: &Value, c| {
        reduce_aggregate(&RawEventData {
            base_url: "u",
            event: ev,
            participation_pages: &p,
            qualification_pages: &q,
            camp_start: "2026-07-18",
            camp_end: "2026-07-25",
            coach_person_id: c,
            fetched_at: "t",
            qualifications_readable: true,
            qual_mapping: None,
        })
        .unwrap()
    };
    assert_eq!(raw(&ev, Some("777")).coach_match, Some(true));
    ev["data"]["attributes"]["advisor_id"] = Value::Null;
    assert_eq!(raw(&ev, Some("777")).coach_match, None);
}

#[test]
fn aggregate_errors_are_generic() {
    let (p, q) = (pages(), quals());
    let bad = json!({"nope": true});
    let mk = |ev: &Value, start: &'static str| {
        reduce_aggregate(&RawEventData {
            base_url: "u",
            event: ev,
            participation_pages: &p,
            qualification_pages: &q,
            camp_start: start,
            camp_end: "2026-07-25",
            coach_person_id: None,
            fetched_at: "t",
            qualifications_readable: true,
            qual_mapping: None,
        })
    };
    assert!(matches!(mk(&bad, "2026-07-18"), Err(coco_core::CoreError::Invalid(_))));
    assert!(matches!(mk(&event(), "kaputt"), Err(coco_core::CoreError::Invalid(_))));
    let msg = mk(&bad, "2026-07-18").unwrap_err().to_string();
    assert!(!msg.contains("Zehnder"));
}

#[test]
fn empty_participations_give_zero_bands() {
    let ev = event();
    let a = reduce_aggregate(&RawEventData {
        base_url: "u",
        event: &ev,
        participation_pages: &[],
        qualification_pages: &[],
        camp_start: "2026-07-18",
        camp_end: "2026-07-25",
        coach_person_id: None,
        fetched_at: "t",
        qualifications_readable: true,
        qual_mapping: None,
    })
    .unwrap();
    assert_eq!(a.participants_count, 0);
    assert_eq!(a.age_bands.len(), 7);
    assert!(a.age_bands.iter().all(|b| b.count == 0));
    assert_eq!((a.min_age, a.max_age), (None, None));
}

#[test]
fn serde_shape_matches_typescript() {
    let a = aggregate(Some("777"));
    let v = serde_json::to_value(&a).unwrap();
    let o = v.as_object().unwrap();
    for k in [
        "zone", "baseUrl", "eventId", "eventName", "eventDates", "location", "maximumParticipants", "participantsCount",
        "participantsJsAgeCount", "participantsWithoutBirthday", "minAge", "maxAge", "ageBands", "leadersCount", "leaders",
        "coachMatch", "coachNickname", "qualificationsReadable", "qualificationKinds", "fetchedAt", "participantsByBirthYear",
    ] {
        assert!(o.contains_key(k), "missing {k}");
    }
    assert_eq!(o.len(), 21);
    assert!(v["eventDates"][0].get("startAt").is_some() && v["eventDates"][0].get("finishAt").is_some());
    assert!(v["ageBands"][0].get("from").is_some() && v["ageBands"][0].get("count").is_some());
    let leader = &v["leaders"][0];
    assert!(leader.get("nickname").is_some() && leader.get("roleLabel").is_some());
    let qk: Vec<&str> = leader["qualifications"].as_object().unwrap().keys().map(String::as_str).collect();
    for k in ["lagerleiter", "leiterLsT", "wasser", "berg", "winter", "slrg"] {
        assert!(qk.contains(&k), "missing qual {k}");
    }
    let s = serde_json::to_value(MidataEventSummary { id: "1".into(), name: "n".into(), start_at: None, finish_at: None, location: None, group_names: vec![], overlap_days: None }).unwrap();
    assert!(s.get("startAt").is_some());
    assert!(s.get("groupNames").is_some() && s.get("overlapDays").is_some());
    let p = serde_json::to_value(MidataProbe {
        auth_method: None,
        event_status: 200,
        participations_status: 403,
        participations_readable: false,
        people_birthday_readable: false,
        qualifications_status: 200,
        classic_json_status: None,
        pbs_fields_present: vec![],
        classic_attribute_names: vec![],
    })
    .unwrap();
    for k in ["authMethod", "eventStatus", "participationsStatus", "participationsReadable", "peopleBirthdayReadable", "qualificationsStatus", "classicJsonStatus", "pbsFieldsPresent", "classicAttributeNames"] {
        assert!(p.get(k).is_some(), "probe {k}");
    }
}

#[test]
fn aggregate_contains_no_person_data() {
    let a = aggregate(Some("777"));
    let out = serde_json::to_string(&a).unwrap();
    let p = pages();
    let mut checked = 0;
    for page in &p {
        for item in page["included"].as_array().unwrap() {
            if item["type"] != "people" {
                continue;
            }
            for key in ["birthday", "last_name"] {
                if let Some(val) = item["attributes"][key].as_str() {
                    assert!(!out.contains(val), "leaked {key}");
                    checked += 1;
                }
            }
        }
    }
    assert!(checked > 10);
    // first names of non-leaders must not appear either
    for n in ["Anna", "Ben", "Cleo", "Dario", "Eli", "Gian", "Hanna", "Pixel", "Kuechenfee"] {
        assert!(!out.contains(n), "leaked {n}");
    }
}

#[test]
fn qualification_label_keywords_per_key() {
    use QualKey::*;
    for l in ["Lagerleiter", "ZUSATZ LAGER J+S", "Zusatz Lagerleiter"] {
        assert!(qual_keys_for_label(l).contains(&Lagerleiter), "{l}");
    }
    for l in ["Lagersport", "Trekking Leiter", "Leiter LS/T", "J+S LST", "Leiter*in J+S LS/T", "J+S-Leiter Lagersport"] {
        assert!(qual_keys_for_label(l).contains(&LeiterLsT), "{l}");
    }
    assert!(!qual_keys_for_label("Gelst").contains(&LeiterLsT));
    for l in ["Wasser", "Sicherheitsbereich Wasser", "Modul See", "Modul Fluss"] {
        assert!(qual_keys_for_label(l).contains(&Wasser), "{l}");
    }
    for l in ["Berg", "Sicherheitsbereich Berg"] {
        assert!(qual_keys_for_label(l).contains(&Berg), "{l}");
    }
    for l in ["Winter", "Schnee", "Sicherheitsbereich Winter"] {
        assert!(qual_keys_for_label(l).contains(&Winter), "{l}");
    }
    for l in ["SLRG", "Brevet Plus", "Rettungsschwimmer", "Modul Pool", "Modul See", "Modul Fluss"] {
        assert!(qual_keys_for_label(l).contains(&Slrg), "{l}");
    }
    // SLRG modules imply both Slrg and Wasser
    assert_eq!(qual_keys_for_label("SLRG Modul Fluss"), vec![Wasser, Slrg, WaterRiver]);
    assert_eq!(qual_keys_for_label("Modul Pool"), vec![Slrg]);
}

#[test]
fn user_mapping_replaces_builtin() {
    use std::collections::HashMap;
    use QualKey::*;
    let mut m: HashMap<String, Vec<QualKey>> = HashMap::new();
    m.insert("  sicherheitsmodul WASSER ".into(), vec![Berg]);
    m.insert("Zusatz Lagerleiter".into(), vec![]);
    assert_eq!(qual_keys_with_mapping("Sicherheitsmodul Wasser", Some(&m)), vec![Berg]);
    assert!(qual_keys_with_mapping("zusatz lagerleiter ", Some(&m)).is_empty());
    assert_eq!(qual_keys_with_mapping("Modul Berg", Some(&m)), vec![Berg]);
    assert_eq!(qual_keys_with_mapping("Modul Berg", None), vec![Berg]);
}

fn participation(id: &str, person: &str, role: &str) -> Value {
    json!({"id": id, "type": "event_participations",
        "relationships": {"participant": {"data": {"type": "people", "id": person}}, "roles": {"data": [{"type": "event_roles", "id": role}]}}})
}

fn coach_pages() -> Vec<Value> {
    vec![json!({
        "data": [
            participation("1", "300", "rl"),
            participation("2", "301", "rc"),
            participation("3", "302", "ra"),
            participation("4", "303", "rp")
        ],
        "included": [
            {"id": "300", "type": "people", "attributes": {"first_name": "Lena", "last_name": "Leitzinger", "nickname": "Luchs"}},
            {"id": "301", "type": "people", "attributes": {"first_name": "Corinna", "last_name": "Coachmann", "nickname": null}},
            {"id": "302", "type": "people", "attributes": {"first_name": "Adrian", "last_name": "Advisor", "nickname": "Ad"}},
            {"id": "303", "type": "people", "attributes": {"first_name": "Tim", "last_name": "Teilnehmer", "birthday": "2014-07-18"}},
            {"id": "rl", "type": "event_roles", "attributes": {"type": "Event::Camp::Role::Leader", "label": "Hauptleitung"}},
            {"id": "rc", "type": "event_roles", "attributes": {"type": "Event::Camp::Role::Coach", "label": "Coach"}},
            {"id": "ra", "type": "event_roles", "attributes": {"type": "Event::Camp::Role::AdvisorWaterSecurity", "label": "Berater Wasser"}},
            {"id": "rp", "type": "event_roles", "attributes": {"type": "Event::Role::Participant", "label": "TN"}}
        ]
    })]
}

fn quals_doc() -> Vec<Value> {
    vec![json!({
        "data": [
            {"id": "q1", "type": "qualifications", "attributes": {"start_at": "2020-01-01", "finish_at": null},
             "relationships": {"person": {"data": {"type": "people", "id": "300"}}, "qualification_kind": {"data": {"type": "qualification_kinds", "id": "k1"}}}},
            {"id": "q2", "type": "qualifications", "attributes": {"start_at": null, "qualified_at": "2026-07-20", "finish_at": null},
             "relationships": {"person": {"data": {"type": "people", "id": "300"}}, "qualification_kind": {"data": {"type": "qualification_kinds", "id": "k2"}}}},
            {"id": "q3", "type": "qualifications", "attributes": {"start_at": "2019-01-01", "finish_at": "2025-01-01"},
             "relationships": {"person": {"data": {"type": "people", "id": "300"}}, "qualification_kind": {"data": {"type": "qualification_kinds", "id": "k3"}}}},
            {"id": "q4", "type": "qualifications", "attributes": {"start_at": "2019-01-01", "finish_at": null},
             "relationships": {"person": {"data": {"type": "people", "id": "300"}}, "qualification_kind": {"data": {"type": "qualification_kinds", "id": "k4"}}}},
            {"id": "q5", "type": "qualifications", "attributes": {"start_at": "2019-01-01", "finish_at": null},
             "relationships": {"person": {"data": {"type": "people", "id": "303"}}, "qualification_kind": {"data": {"type": "qualification_kinds", "id": "k4"}}}}
        ],
        "included": [
            {"id": "k1", "type": "qualification_kinds", "attributes": {"label": "Zusatz Lagerleiter"}},
            {"id": "k2", "type": "qualification_kinds", "attributes": {"label": "Sicherheitsbereich Berg"}},
            {"id": "k3", "type": "qualification_kinds", "attributes": {"label": "SLRG Modul Pool"}},
            {"id": "k4", "type": "qualification_kinds", "attributes": {"label": "Erste Hilfe Kurs"}}
        ]
    })]
}

fn reduce_with(
    coach: Option<&str>,
    ev: &Value,
    q: &[Value],
    readable: bool,
    mapping: Option<&std::collections::HashMap<String, Vec<QualKey>>>,
) -> MidataAggregate {
    let p = coach_pages();
    reduce_aggregate(&RawEventData {
        base_url: "u",
        event: ev,
        participation_pages: &p,
        qualification_pages: q,
        camp_start: "2026-07-18",
        camp_end: "2026-07-25",
        coach_person_id: coach,
        fetched_at: "t",
        qualifications_readable: readable,
        qual_mapping: mapping,
    })
    .unwrap()
}

#[test]
fn coach_participation_is_neither_leader_nor_participant() {
    let a = reduce_with(Some("301"), &event(), &quals_doc(), true, None);
    assert_eq!(a.leaders_count, 1);
    assert_eq!(a.leaders[0].nickname, "Luchs");
    assert_eq!(a.participants_count, 1);
    assert_eq!(a.coach_match, Some(true));
    assert_eq!(a.coach_nickname.as_deref(), Some("Corinna")); // nickname null -> first name
    let other = reduce_with(Some("999"), &event(), &quals_doc(), true, None);
    assert_eq!(other.coach_match, Some(false));
    // advisor_id 777 of the event is ignored while a coach participation exists
    assert_eq!(reduce_with(Some("777"), &event(), &quals_doc(), true, None).coach_match, Some(false));
    assert_eq!(reduce_with(None, &event(), &quals_doc(), true, None).coach_match, None);
    let out = serde_json::to_string(&a).unwrap();
    for n in ["Coachmann", "Leitzinger", "Advisor", "Teilnehmer"] {
        assert!(!out.contains(n), "leaked {n}");
    }
    // no coach participation: fixture keeps the advisor_id fallback and no nickname
    assert_eq!(aggregate(Some("777")).coach_nickname, None);
}

#[test]
fn qualification_kinds_and_validity() {
    use QualKey::*;
    let a = reduce_with(None, &event(), &quals_doc(), true, None);
    assert!(a.qualifications_readable);
    let leader = &a.leaders[0];
    assert!(leader.qualifications[&Lagerleiter]);
    assert!(!leader.qualifications[&Berg], "qualified_at after camp start counts as start_at");
    assert!(!leader.qualifications[&Slrg] && !leader.qualifications[&Wasser], "expired");
    let labels: Vec<&str> = a.qualification_kinds.iter().map(|k| k.label.as_str()).collect();
    // only leaders' qualifications; the participant's first aid kind is not counted, the leader's is
    assert_eq!(labels, vec!["Erste Hilfe Kurs", "Sicherheitsbereich Berg", "SLRG Modul Pool", "Zusatz Lagerleiter"]);
    let by = |l: &str| a.qualification_kinds.iter().find(|k| k.label == l).unwrap();
    assert!(by("Erste Hilfe Kurs").keys.is_empty());
    assert_eq!((by("Erste Hilfe Kurs").valid_leaders, by("Erste Hilfe Kurs").expired_leaders), (1, 0));
    assert_eq!(by("SLRG Modul Pool").keys, vec![Slrg]);
    assert_eq!((by("SLRG Modul Pool").valid_leaders, by("SLRG Modul Pool").expired_leaders), (0, 1));
    assert_eq!((by("Sicherheitsbereich Berg").valid_leaders, by("Sicherheitsbereich Berg").expired_leaders), (0, 1));
    assert_eq!((by("Zusatz Lagerleiter").valid_leaders, by("Zusatz Lagerleiter").expired_leaders), (1, 0));
}

#[test]
fn qualification_mapping_in_aggregate() {
    use std::collections::HashMap;
    use QualKey::*;
    let mut m: HashMap<String, Vec<QualKey>> = HashMap::new();
    m.insert("erste hilfe kurs".into(), vec![Winter]);
    m.insert("ZUSATZ LAGERLEITER".into(), vec![]);
    let a = reduce_with(None, &event(), &quals_doc(), true, Some(&m));
    assert!(a.leaders[0].qualifications[&Winter]);
    assert!(!a.leaders[0].qualifications[&Lagerleiter], "empty list ignores the label");
    let k = a.qualification_kinds.iter().find(|k| k.label == "Zusatz Lagerleiter").unwrap();
    assert!(k.keys.is_empty());
}

#[test]
fn unreadable_qualifications_are_flagged() {
    let a = reduce_with(None, &event(), &quals_doc(), false, None);
    assert!(!a.qualifications_readable);
    assert!(a.qualification_kinds.is_empty());
    assert!(a.leaders.iter().all(|l| l.qualifications.values().all(|v| !v)));
    let v = serde_json::to_value(&a).unwrap();
    assert_eq!(v["qualificationsReadable"], json!(false));
    assert!(v["qualificationKinds"].is_array() && v.get("coachNickname").is_some());
    let k = serde_json::to_value(QualKindInfo { label: "x".into(), keys: vec![QualKey::LeiterLsT], valid_leaders: 1, expired_leaders: 2 }).unwrap();
    assert_eq!(k, json!({"label": "x", "keys": ["leiterLsT"], "validLeaders": 1, "expiredLeaders": 2}));
}

#[test]
fn session_cookie_and_person_id_helpers() {
    use coco_core::cookies::RawCookie;
    let c = vec![RawCookie::new("other", "1"), RawCookie::new("_session_id", ""), RawCookie::new("_session_id", "abc")];
    assert_eq!(pick_session_cookie(&c).map(|c| c.value.as_str()), Some("abc"));
    assert!(pick_session_cookie(&c[..2]).is_none());
    assert!(pick_session_cookie(&[]).is_none());
    assert_eq!(person_id_from_path("/groups/1/people/123"), Some("123".into()));
    assert_eq!(person_id_from_path("/de/people/45.json"), Some("45".into()));
    assert_eq!(person_id_from_path("/people/7/qualifications"), Some("7".into()));
    assert_eq!(person_id_from_path("/groups/1/people"), None);
    assert_eq!(person_id_from_path("/people/abc"), None);
    assert_eq!(person_id_from_path("/groups/12"), None);
    let s = serde_json::to_value(MidataStatus { connected: true, base_url: None, method: None, cookie_names: vec![], person_id: Some("9".into()) }).unwrap();
    assert_eq!(s["personId"], json!("9"));
}

#[test]
fn classic_probe() {
    let (pbs, names) = probe_classic_fields(&fx(include_str!("fixtures/midata/classic_event.json")));
    assert_eq!(pbs, vec!["camp_submitted", "canton", "coach", "expected_participants_rover_m", "expected_participants_wolf_f", "j_s_kind"]);
    assert!(names.contains(&"name".to_string()) && names.contains(&"links".to_string()));
    let mut sorted = names.clone();
    sorted.sort();
    assert_eq!(names, sorted);
    let (pbs2, names2) = probe_classic_fields(&json!({"event": {"id": 1, "total_expected_participants": 5}}));
    assert_eq!(pbs2, vec!["total_expected_participants"]);
    assert_eq!(names2.len(), 2);
    let (pbs3, names3) = probe_classic_fields(&json!([]));
    assert!(pbs3.is_empty() && names3.is_empty());
}

#[test]
fn guests_and_inactive_participations() {
    let doc = json!({
        "data": [
            {"id":"1","type":"event_participations","attributes":{"active":true},"relationships":{"participant":{"data":{"type":"event_guests","id":"g1"}},"roles":{"data":[{"type":"event_roles","id":"r1"}]}}},
            {"id":"2","type":"event_participations","attributes":{"active":false},"relationships":{"participant":{"data":{"type":"people","id":"5"}},"roles":{"data":[{"type":"event_roles","id":"r1"}]}}},
            {"id":"3","type":"event_participations","relationships":{"participant":{"data":{"type":"people","id":"6"}},"roles":{"data":[{"type":"event_roles","id":"r1"}]}}}
        ],
        "included": [
            {"id":"6","type":"people","attributes":{"birthday":"2014-07-18"}},
            {"id":"r1","type":"event_roles","attributes":{"type":"Event::Camp::Role::Leader","label":"Leitung"}}
        ]
    });
    assert_eq!(leader_person_ids(std::slice::from_ref(&doc)), vec!["6"]);
}

fn year_aggregate(camp_start: &str, birthdays: &[&str]) -> MidataAggregate {
    let mut data: Vec<Value> = Vec::new();
    let mut included: Vec<Value> = vec![json!({"id": "r1", "type": "event_roles", "attributes": {"type": "Event::Role::Participant"}})];
    for (i, b) in birthdays.iter().enumerate() {
        let id = format!("{}", 900 + i);
        data.push(json!({"id": format!("p{i}"), "type": "event_participations", "relationships": {
            "participant": {"data": {"type": "people", "id": id}},
            "roles": {"data": [{"type": "event_roles", "id": "r1"}]}}}));
        included.push(json!({"id": id, "type": "people", "attributes": {"first_name": "A", "birthday": b}}));
    }
    let pages = vec![json!({"data": data, "included": included})];
    let ev = event();
    reduce_aggregate(&RawEventData {
        base_url: "u",
        event: &ev,
        participation_pages: &pages,
        qualification_pages: &[],
        camp_start,
        camp_end: camp_start,
        coach_person_id: None,
        fetched_at: "t",
        qualifications_readable: true,
        qual_mapping: None,
    })
    .unwrap()
}

#[test]
fn js_age_by_jahrgang() {
    // camp 2026: Jahrgang 2021 (5) .. 2006 (20) count, 2022 (4) and 2005 (21) do not,
    // even when the birthday is after the camp start.
    let a = year_aggregate("2026-07-18", &["2021-12-31", "2006-01-01", "2022-01-01", "2005-12-31", "2012-05-05", "2012-09-09"]);
    assert_eq!(a.participants_js_age_count, 4);
    assert_eq!(a.participants_by_birth_year.get(&2012), Some(&2));
    assert_eq!(a.participants_by_birth_year.get(&2005), Some(&1));
    assert_eq!(a.participants_by_birth_year.values().sum::<u32>(), 6);
}
