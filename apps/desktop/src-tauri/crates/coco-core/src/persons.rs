//! «Personen» tab (ADR 0009, plan `docs/plans/participants-and-nds-sync.md`, phase P1): person rows
//! of one MiData event and one NDS camp. RED ZONE.
//!
//! Unlike `midata::reduce_aggregate` / `nds::reduce_aggregate` these reducers return INDIVIDUAL
//! people (names, birth dates, roles). Rules: memory only (the caller keeps the result in a Rust
//! `State`, never on disk), never logged, never in error messages. No AHV number, no address, no
//! e-mail/phone, no health data is read: `privateAddress` of NDS and everything but the five listed
//! MiData person attributes are ignored.
//!
//! CONTRACT: the serialized shapes mirror `apps/desktop/src/domain/persons/types.ts`
//! (serde camelCase, constant `__red: true`). Do not change one side alone.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::midata::{
    collect_people, day_string, index_included, parse_qualifications, qual_keys_with_mapping, str_attr, Included, PersonAgg,
    QualKey, ALL_QUAL_KEYS,
};
use crate::CoreError;

fn red() -> bool {
    true
}

/// Kind of a MiData person.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PersonKind {
    Participant,
    Leader,
    Kitchen,
    Coach,
    Guest,
    Other,
}

/// Qualification state of a leader for one key at camp time.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum QualState {
    Valid,
    Invalid,
    None,
}

/// One person of the MiData event (deduplicated over participations).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataPersonRow {
    #[serde(rename = "__red", default = "red")]
    pub red: bool,
    /// MiData person id (`guest:<id>` for event guests).
    pub id: String,
    pub first_name: String,
    pub last_name: String,
    pub nickname: Option<String>,
    /// YYYY-MM-DD.
    pub birth_date: Option<String>,
    pub gender: Option<String>,
    pub kind: PersonKind,
    pub role_labels: Vec<String>,
    /// Leaders only; empty for others or when qualifications are unreadable.
    pub qualifications: BTreeMap<QualKey, QualState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NdsKind {
    Participant,
    Leader,
}

/// One person of the NDS camp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsPersonRow {
    #[serde(rename = "__red", default = "red")]
    pub red: bool,
    /// NDS person businessId.
    pub id: String,
    pub person_number: Option<String>,
    pub first_name: String,
    pub last_name: String,
    pub birth_date: Option<String>,
    /// `participant` (ParticipantsListForCamp) or `leader` (SupervisorsListForCamp).
    pub kind: NdsKind,
    pub role_label: Option<String>,
    /// Rega registration (`transmittedToRega`); `None` if unknown / Rega list not readable.
    #[serde(default)]
    pub rega_transmitted: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidataPersonsResult {
    #[serde(rename = "__red", default = "red")]
    pub red: bool,
    pub event_id: String,
    pub persons: Vec<MidataPersonRow>,
    pub qualifications_readable: bool,
    pub fetched_at: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NdsPersonsResult {
    #[serde(rename = "__red", default = "red")]
    pub red: bool,
    pub nds_camp_id: String,
    pub persons: Vec<NdsPersonRow>,
    pub fetched_at: String,
}

fn kind_of(p: &PersonAgg, is_guest: bool) -> PersonKind {
    if is_guest {
        PersonKind::Guest
    } else if p.is_leader {
        PersonKind::Leader
    } else if p.is_coach {
        PersonKind::Coach
    } else if p.is_participant {
        PersonKind::Participant
    } else if p.is_kitchen {
        PersonKind::Kitchen
    } else {
        PersonKind::Other
    }
}

fn person_record<'a>(included: &'a Included, id: &str) -> Option<&'a Value> {
    match id.strip_prefix("guest:") {
        Some(g) => included.get(&("event_guests".to_string(), g.to_string())),
        None => included.get(&("people".to_string(), id.to_string())),
    }
}

/// Reduces MiData participation (and qualification) pages to person rows, in first-seen order.
/// `qualification_pages = None` means «not readable»: leaders then carry no qualification states.
pub fn reduce_midata_persons(
    participation_pages: &[Value],
    qualification_pages: Option<&[Value]>,
    camp_start: &str,
    camp_end: &str,
    qual_mapping: Option<&HashMap<String, Vec<QualKey>>>,
) -> Result<Vec<MidataPersonRow>, CoreError> {
    let camp_start = day_string(camp_start).ok_or_else(|| CoreError::Invalid("Lagerbeginn ungültig".into()))?;
    let camp_end = day_string(camp_end).ok_or_else(|| CoreError::Invalid("Lagerende ungültig".into()))?;
    let refs: Vec<&Value> = participation_pages.iter().collect();
    let included = index_included(&refs);
    let recs = qualification_pages.map(|q| parse_qualifications(q, &camp_start, &camp_end)).unwrap_or_default();
    let readable = qualification_pages.is_some();

    let mut out = Vec::new();
    for p in collect_people(participation_pages) {
        let Some(id) = p.person_id.clone() else { continue };
        let is_guest = id.starts_with("guest:");
        let kind = kind_of(&p, is_guest);
        let rec = person_record(&included, &id);
        let attr = |k: &str| rec.and_then(|r| str_attr(r, k));
        let mut qualifications = BTreeMap::new();
        if readable && kind == PersonKind::Leader {
            let mut valid: BTreeSet<QualKey> = BTreeSet::new();
            let mut held: BTreeSet<QualKey> = BTreeSet::new();
            for r in recs.iter().filter(|r| r.person == id) {
                let keys = qual_keys_with_mapping(&r.label, qual_mapping);
                held.extend(keys.iter().copied());
                if r.valid {
                    valid.extend(keys);
                }
            }
            for k in ALL_QUAL_KEYS {
                let state = if valid.contains(&k) {
                    QualState::Valid
                } else if held.contains(&k) {
                    QualState::Invalid
                } else {
                    QualState::None
                };
                qualifications.insert(k, state);
            }
        }
        out.push(MidataPersonRow {
            red: true,
            id,
            first_name: attr("first_name").unwrap_or_default(),
            last_name: attr("last_name").unwrap_or_default(),
            nickname: attr("nickname"),
            birth_date: attr("birthday").and_then(|b| day_string(&b)),
            gender: attr("gender"),
            kind,
            role_labels: p.role_labels,
            qualifications,
        });
    }
    Ok(out)
}

fn text(v: &Value, key: &str) -> Option<String> {
    match v.get(key)? {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Items of a list page: `{content: [...]}` or a bare array.
fn page_items(page: &Value) -> &[Value] {
    page.get("content").and_then(Value::as_array).or_else(|| page.as_array()).map_or(&[], Vec::as_slice)
}

fn nds_rows(pages: &[Value], kind: NdsKind, role_field: &str, out: &mut Vec<NdsPersonRow>) {
    for item in pages.iter().flat_map(page_items) {
        let Some(person) = item.get("person").filter(|p| p.is_object()) else { continue };
        let Some(id) = text(person, "businessId") else { continue };
        // privateAddress (and any other field) is never copied.
        out.push(NdsPersonRow {
            red: true,
            id,
            person_number: text(person, "personNumber"),
            first_name: text(person, "firstName").unwrap_or_default(),
            last_name: text(person, "lastName").unwrap_or_default(),
            birth_date: text(person, "birthDate").and_then(|d| day_string(&d)),
            kind,
            role_label: text(item, role_field),
            rega_transmitted: None,
        });
    }
}

/// Reduces `ParticipantsListForCamp` and `SupervisorsListForCamp` list pages to person rows
/// (participants first, then supervisors). A person listed twice with the same kind is kept once.
pub fn reduce_nds_persons(participant_pages: &[Value], supervisor_pages: &[Value]) -> Vec<NdsPersonRow> {
    let mut out = Vec::new();
    nds_rows(participant_pages, NdsKind::Participant, "targetAudienceGroup", &mut out);
    nds_rows(supervisor_pages, NdsKind::Leader, "involvementType", &mut out);
    let mut seen = BTreeSet::new();
    out.retain(|r| seen.insert((r.id.clone(), r.kind == NdsKind::Leader)));
    out
}

/// Attaches the Rega state to NDS rows of `kind` (match by person businessId, then personNumber).
/// `map` comes from [`crate::nds::rega_transmitted_map`]. Rows without an entry keep `None`.
pub fn attach_rega(rows: &mut [NdsPersonRow], kind: NdsKind, map: &BTreeMap<String, bool>) {
    for r in rows.iter_mut().filter(|r| r.kind == kind) {
        let by_id = map.get(&format!("{}{}", crate::nds::REGA_KEY_ID, r.id));
        let by_nr = || r.person_number.as_ref().and_then(|n| map.get(&format!("{}{n}", crate::nds::REGA_KEY_NR)));
        r.rega_transmitted = by_id.or_else(by_nr).copied();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::nds::{ensure_query_only, Q_PERSONS_PARTICIPANTS, Q_PERSONS_SUPERVISORS};
    use serde_json::json;

    fn role(id: &str, ty: &str, label: &str) -> Value {
        json!({"type":"event_roles","id":id,"attributes":{"type":ty,"label":label}})
    }
    fn person(id: &str, first: &str, last: &str, nick: Option<&str>, bd: Option<&str>) -> Value {
        json!({"type":"people","id":id,"attributes":{"first_name":first,"last_name":last,"nickname":nick,"birthday":bd,"gender":"w","email":"x@example.invalid"}})
    }
    fn part(id: &str, person: &str, roles: &[&str]) -> Value {
        json!({"type":"event_participations","id":id,"attributes":{"active":true},
          "relationships":{"participant":{"data":{"type":"people","id":person}},
            "roles":{"data":roles.iter().map(|r| json!({"type":"event_roles","id":r})).collect::<Vec<_>>()}}})
    }

    fn participations() -> Vec<Value> {
        vec![json!({
          "data":[
            part("1","10",&["r1"]),
            part("2","11",&["r2","r3"]),
            part("3","12",&["r4"]),
            part("4","13",&["r5"]),
            // attributes-only linkage (no relationship data rendered)
            {"type":"event_participations","id":"5","attributes":{"active":true,"participant_id":14,"participant_type":"Person"},
             "relationships":{"roles":{"data":[{"type":"event_roles","id":"r1"}]}}},
            {"type":"event_participations","id":"6","attributes":{"active":true,"participant_id":7,"participant_type":"Event::Guest"},
             "relationships":{"roles":{"data":[{"type":"event_roles","id":"r6"}]}}},
            part("7","15",&["r7"]),
            {"type":"event_participations","id":"8","attributes":{"active":false},
             "relationships":{"participant":{"data":{"type":"people","id":"99"}},"roles":{"data":[{"type":"event_roles","id":"r1"}]}}},
          ],
          "included":[
            person("10","Anna","Muster",Some("Wiesel"),Some("2012-05-04")),
            person("11","Ben","Beispiel",None,Some("1995-01-02")),
            person("12","Cleo","Koch",None,None),
            person("13","Dora","Coachin",Some("Dori"),Some("1980-03-03")),
            person("14","Emil","Attribut",None,Some("2011-02-28")),
            person("15","Fiona","Fee",None,Some("2000-01-01")),
            {"type":"event_guests","id":"7","attributes":{"first_name":"Gustav","last_name":"Gast","nickname":null}},
            role("r1","Event::Role::Participant","Teilnehmer/in"),
            role("r2","Event::Camp::Role::Leader","Hauptleitung"),
            role("r3","Event::Role::Cook","Küche"),
            role("r4","Event::Role::Cook","Küchenchef"),
            role("r5","Event::Camp::Role::Coach","Coach"),
            role("r6","Event::Role::Helper","Gast"),
            role("r7","Event::Role::Treasurer","Kassier"),
          ]
        })]
    }

    fn quals() -> Vec<Value> {
        vec![json!({"data":[
          {"type":"qualifications","id":"1","attributes":{"start_at":"2020-01-01","finish_at":"2025-12-31","person_id":11,"qualification_kind_id":1}},
          {"type":"qualifications","id":"2","attributes":{"start_at":"2020-01-01","finish_at":null,"person_id":11,"qualification_kind_id":2}}
        ],"included":[
          {"type":"qualification_kinds","id":"1","attributes":{"label":"J+S Leiter*in Lagersport/Trekking"}},
          {"type":"qualification_kinds","id":"2","attributes":{"label":"Zusatz Lagerleiter"}}
        ]})]
    }

    fn by_id<'a>(rows: &'a [MidataPersonRow], id: &str) -> &'a MidataPersonRow {
        rows.iter().find(|r| r.id == id).unwrap_or_else(|| panic!("row {id}"))
    }

    #[test]
    fn midata_kinds_and_fields() {
        let q = quals();
        let rows = reduce_midata_persons(&participations(), Some(&q), "2026-07-18", "2026-07-25", None).unwrap();
        assert_eq!(rows.len(), 7, "inactive participation skipped");
        let anna = by_id(&rows, "10");
        assert_eq!(anna.kind, PersonKind::Participant);
        assert_eq!((anna.first_name.as_str(), anna.last_name.as_str()), ("Anna", "Muster"));
        assert_eq!(anna.nickname.as_deref(), Some("Wiesel"));
        assert_eq!(anna.birth_date.as_deref(), Some("2012-05-04"));
        assert_eq!(anna.gender.as_deref(), Some("w"));
        assert!(anna.qualifications.is_empty());
        // leader + kitchen role: leader, both labels, qualification states incl. invalid (expired) one
        let ben = by_id(&rows, "11");
        assert_eq!(ben.kind, PersonKind::Leader);
        assert_eq!(ben.role_labels, vec!["Hauptleitung", "Küche"]);
        assert_eq!(ben.qualifications[&QualKey::Lagerleiter], QualState::Valid);
        assert_eq!(ben.qualifications[&QualKey::LeiterLsT], QualState::Invalid);
        assert_eq!(ben.qualifications[&QualKey::Berg], QualState::None);
        assert_eq!(by_id(&rows, "12").kind, PersonKind::Kitchen);
        assert_eq!(by_id(&rows, "12").birth_date, None);
        assert_eq!(by_id(&rows, "13").kind, PersonKind::Coach);
        // attributes-only linkage
        let emil = by_id(&rows, "14");
        assert_eq!((emil.first_name.as_str(), emil.kind), ("Emil", PersonKind::Participant));
        // guest
        let g = by_id(&rows, "guest:7");
        assert_eq!((g.kind, g.last_name.as_str(), g.birth_date.clone()), (PersonKind::Guest, "Gast", None));
        assert_eq!(by_id(&rows, "15").kind, PersonKind::Other);
    }

    #[test]
    fn midata_unreadable_qualifications_are_empty() {
        let rows = reduce_midata_persons(&participations(), None, "2026-07-18", "2026-07-25", None).unwrap();
        assert!(by_id(&rows, "11").qualifications.is_empty());
        assert_eq!(by_id(&rows, "11").kind, PersonKind::Leader);
    }

    #[test]
    fn midata_bad_dates_and_wire_shape() {
        assert!(reduce_midata_persons(&[], None, "x", "2026-07-25", None).is_err());
        let rows = reduce_midata_persons(&participations(), None, "2026-07-18", "2026-07-25", None).unwrap();
        let v = serde_json::to_value(&rows[0]).unwrap();
        assert_eq!(v["__red"], json!(true));
        assert_eq!(v["firstName"], json!("Anna"));
        assert_eq!(v["kind"], json!("participant"));
        assert!(v.get("email").is_none());
        let res = MidataPersonsResult { red: true, event_id: "1".into(), persons: rows, qualifications_readable: false, fetched_at: "t".into() };
        let v = serde_json::to_value(&res).unwrap();
        assert_eq!(v["__red"], json!(true));
        assert_eq!(v["eventId"], json!("1"));
        assert_eq!(v["qualificationsReadable"], json!(false));
    }

    #[test]
    fn nds_rows_ignore_address() {
        let pp = vec![json!({"content":[
          {"businessId":"1","targetAudienceGroup":"CHILD","person":{"businessId":"500","personNumber":"123456","firstName":"Anna","lastName":"Muster","birthDate":"2012-05-04",
           "privateAddress":{"streetHouseNumber":"Teststrasse 1","zipCode":"0000","town":"Nirgendwo"}}},
          {"businessId":"2","targetAudienceGroup":"ADOLESCENT","person":{"businessId":"501","firstName":"Ben","lastName":"Beispiel","birthDate":null}},
          {"businessId":"3","targetAudienceGroup":"CHILD","person":null},
          {"businessId":"4","targetAudienceGroup":"CHILD","person":{"businessId":"500","firstName":"Anna","lastName":"Muster"}}
        ]})];
        let sp = vec![json!({"content":[
          {"businessId":"9","involvementType":"MAIN_SUPERVISOR","person":{"businessId":"600","personNumber":777,"firstName":"Cleo","lastName":"Koch","birthDate":"1990-01-01T00:00:00Z"}}
        ]})];
        let rows = reduce_nds_persons(&pp, &sp);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].person_number.as_deref(), Some("123456"));
        assert_eq!(rows[0].role_label.as_deref(), Some("CHILD"));
        assert_eq!(rows[1].birth_date, None);
        assert_eq!((rows[2].kind, rows[2].role_label.as_deref()), (NdsKind::Leader, Some("MAIN_SUPERVISOR")));
        assert_eq!(rows[2].person_number.as_deref(), Some("777"));
        assert_eq!(rows[2].birth_date.as_deref(), Some("1990-01-01"));
        let s = serde_json::to_string(&rows).unwrap();
        assert!(!s.contains("Teststrasse") && !s.contains("privateAddress"));
        assert!(s.contains("\"__red\":true"));
    }

    #[test]
    fn nds_person_queries_are_read_only_and_minimal() {
        for q in [Q_PERSONS_PARTICIPANTS, Q_PERSONS_SUPERVISORS] {
            ensure_query_only(q).unwrap();
            for banned in ["privateAddress", "ahvn13", "email", "iban", "mutation"] {
                assert!(!q.to_lowercase().contains(&banned.to_lowercase()), "{banned}");
            }
            assert!(q.contains("firstName") && q.contains("birthDate") && q.contains("personNumber"));
        }
    }

    #[test]
    fn rega_attaches_per_kind() {
        let pp = vec![json!({"content":[
          {"businessId":"1","targetAudienceGroup":"CHILD","person":{"businessId":"500","personNumber":"123","firstName":"A","lastName":"B"}},
          {"businessId":"2","targetAudienceGroup":"CHILD","person":{"businessId":"501","firstName":"C","lastName":"D"}}
        ]})];
        let mut rows = reduce_nds_persons(&pp, &[]);
        let rega = vec![json!({"content":[
          {"person":{"businessId":"500","personNumber":"123"},"transmittedToRega":true}
        ]})];
        let map = crate::nds::rega_transmitted_map(&rega);
        attach_rega(&mut rows, NdsKind::Participant, &map);
        assert_eq!(rows[0].rega_transmitted, Some(true));
        assert_eq!(rows[1].rega_transmitted, None);
    }

    #[test]
    fn rega_ids_and_numbers_do_not_collide() {
        // Person 501 has no personNumber; another person's personNumber happens to be "501".
        let pp = vec![json!({"content":[
          {"businessId":"2","targetAudienceGroup":"CHILD","person":{"businessId":"501","firstName":"C","lastName":"D"}}
        ]})];
        let rega = vec![json!({"content":[
          {"person":{"businessId":"900","personNumber":"501"},"transmittedToRega":false}
        ]})];
        let map = crate::nds::rega_transmitted_map(&rega);
        let mut rows = reduce_nds_persons(&pp, &[]);
        attach_rega(&mut rows, NdsKind::Participant, &map);
        assert_eq!(rows[0].rega_transmitted, None);
        // A participant map never touches leader rows.
        let sp = vec![json!({"content":[{"businessId":"3","person":{"businessId":"900","firstName":"E","lastName":"F"}}]})];
        let mut rows = reduce_nds_persons(&[], &sp);
        attach_rega(&mut rows, NdsKind::Participant, &map);
        assert_eq!(rows[0].rega_transmitted, None);
    }
}
