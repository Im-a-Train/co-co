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
    assert_eq!(qual_keys_for_label("SLRG Modul See"), vec![Slrg]);
    assert_eq!(qual_keys_for_label("Brevet Plus Pool"), vec![Slrg]);
    assert_eq!(qual_keys_for_label("Rettungsschwimmer"), vec![Slrg]);
    assert_eq!(qual_keys_for_label("Bergführer Zusatz Lagerleiter"), vec![Lagerleiter, Berg]);
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
    assert_eq!(all[0].group_names, vec!["Abteilung Alpha", "Region Nord"]);
    assert!(all[1].group_names.is_empty());
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
        assert_eq!(l.qualifications.len(), 6);
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
        "coachMatch", "fetchedAt",
    ] {
        assert!(o.contains_key(k), "missing {k}");
    }
    assert_eq!(o.len(), 17);
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
