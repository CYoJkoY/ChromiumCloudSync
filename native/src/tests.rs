use crate::{archive, categories, logical, model::*, protocol, store};
use std::fs;
const A: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
#[test]
fn pending_jobs_remain_visible_after_completed_history() {
    use serde_json::json;
    let tmp = tempfile::Builder::new()
        .tempdir_in(fs::canonicalize(std::env::temp_dir()).unwrap())
        .unwrap();
    for n in 0..60 {
        let job = Job {
            id: format!("1-1-{n}"),
            kind: "backup".into(),
            state: if n == 0 { "ready" } else { "uploaded" }.into(),
            plan: Plan {
                id: "1-2-3".into(),
                profile_id: "fixture".into(),
                extension_ids: vec![A.into()],
                categories: vec!["local".into()],
                capabilities: vec![],
            },
            error: String::new(),
            created_at: n,
            size: 1,
            sha256: "a".repeat(64),
            received: 0,
            manifest: None,
        };
        store::save(
            &store::job_dir(tmp.path(), &job.id)
                .unwrap()
                .join("job.json"),
            &job,
        )
        .unwrap();
    }
    let response = protocol::envelope(
        tmp.path(),
        json!({"protocol":1,"requestId":"history","op":"jobs"}),
    );
    assert_eq!(response["ok"], true);
    assert_eq!(response["value"][0]["id"], "1-1-0");
}
#[test]
fn protocol_envelope_correlates_and_rejects_unknown_versions() {
    use serde_json::json;
    let tmp = tempfile::Builder::new()
        .tempdir_in(fs::canonicalize(std::env::temp_dir()).unwrap())
        .unwrap();
    let hello = protocol::envelope(
        tmp.path(),
        json!({"protocol":1,"requestId":"fixture-1","op":"hello"}),
    );
    assert_eq!(hello["ok"], true);
    assert_eq!(hello["requestId"], "fixture-1");
    let invalid = protocol::envelope(
        tmp.path(),
        json!({"protocol":2,"requestId":"fixture-2","op":"hello"}),
    );
    assert_eq!(invalid["ok"], false);
    assert_eq!(invalid["error"]["operation"], "hello");
    assert!(invalid["error"]["message"]
        .as_str()
        .unwrap()
        .contains("Protocol v1"));
}
fn fixture() -> (tempfile::TempDir, Profile) {
    let tmp = tempfile::Builder::new()
        .tempdir_in(fs::canonicalize(std::env::temp_dir()).unwrap())
        .unwrap();
    let p = Profile {
        id: "fixture".into(),
        browser: "chrome".into(),
        name: "Default".into(),
        root: tmp.path().join("browser"),
        directory: "Default".into(),
    };
    fs::create_dir_all(p.path()).unwrap();
    fs::write(p.root.join("Last Version"), "130.0.0.0").unwrap();
    (tmp, p)
}
#[test]
fn portable_paths_reject_escape_and_aliases() {
    for path in [
        "../secret",
        "/root",
        "C:/secret",
        "a\\b",
        "a//b",
        "a/./b",
        "a/CON.txt",
        "a/file.",
        "a/file ",
        "a/NUL",
        "a/x:y",
    ] {
        assert!(store::relative(path).is_err(), "{path}");
    }
    assert!(store::relative("Local Extension Settings/abc/000003.log").is_ok());
    assert!(!categories::owned(
        A,
        "local",
        &format!("Local Extension Settings/{B}/db")
    ));
}
#[test]
fn selection_contract_rejects_duplicates() {
    let (_tmp, p) = fixture();
    assert!(categories::plan(&p, vec![A.into(), A.into()], vec!["local".into()]).is_err());
    assert!(categories::plan(&p, vec![A.into()], vec!["local".into(), "local".into()]).is_err());
}
#[test]
fn program_metadata_rejects_version_and_identity_mismatch() {
    use serde_json::json;
    let (_tmp, p) = fixture();
    let directory = p.path().join(format!("Extensions/{A}/1.0_0"));
    fs::create_dir_all(&directory).unwrap();
    store::save(&directory.join("manifest.json"), &json!({"version":"1.0"})).unwrap();
    assert_eq!(
        categories::program_versions(&p.path(), A).unwrap(),
        vec!["1.0"]
    );
    store::save(&directory.join("manifest.json"), &json!({"version":"2.0"})).unwrap();
    assert!(categories::program_versions(&p.path(), A)
        .unwrap_err()
        .contains("version"));
    store::save(
        &directory.join("manifest.json"),
        &json!({"version":"1.0","key":"a2V5"}),
    )
    .unwrap();
    assert!(categories::program_versions(&p.path(), A)
        .unwrap_err()
        .contains("ID"));
}
#[test]
fn archive_roundtrip_is_relative_and_integrity_checked() {
    let (tmp, p) = fixture();
    let relative = format!("Local Extension Settings/{A}/data");
    let file = store::safe_join(&p.path(), &relative).unwrap();
    fs::create_dir_all(file.parent().unwrap()).unwrap();
    fs::write(file, b"settings").unwrap();
    let plan = categories::plan(&p, vec![A.into()], vec!["local".into()]).unwrap();
    let dir = tmp.path().join("job");
    fs::create_dir_all(&dir).unwrap();
    let m = archive::backup(&p, &plan, &dir, "1-2-3").unwrap();
    assert_eq!(m.files.len(), 1);
    assert_eq!(m.files[0].path, relative);
    archive::inspect(&dir, true).unwrap();
    assert_eq!(
        fs::read(dir.join("incoming").join(&relative)).unwrap(),
        b"settings"
    );
    let mut broken = m.clone();
    broken.files[0].path = "../outside".into();
    assert!(archive::validate(&broken).is_err());
    let mut duplicate = m.clone();
    duplicate.files.push(m.files[0].clone());
    assert!(archive::validate(&duplicate).is_err());
    let mut future = m.clone();
    future.layout_versions.insert("local".into(), 2);
    assert!(archive::validate(&future).is_err());
    fs::write(dir.join("archive.zip"), b"corrupt").unwrap();
    assert!(archive::inspect(&dir, false).is_err());
}
#[test]
fn logical_restore_preserves_other_origins() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let (_tmp, p) = fixture();
    let records = |id: &str, value: &str| logical::Records {
        version: 1,
        entries: vec![(
            STANDARD.encode(format!("_chrome-extension://{id}\0key")),
            STANDARD.encode(value),
        )],
    };
    logical::write(&p.path(), A, &records(A, "before")).unwrap();
    logical::write(&p.path(), B, &records(B, "unrelated")).unwrap();
    let before = logical::read(&p.path(), A).unwrap();
    logical::write(&p.path(), A, &records(A, "after")).unwrap();
    assert_eq!(
        logical::read(&p.path(), B).unwrap().entries,
        records(B, "unrelated").entries
    );
    logical::write(&p.path(), A, &before).unwrap();
    assert_eq!(logical::read(&p.path(), A).unwrap().entries, before.entries);
    assert!(logical::write(&p.path(), A, &records(B, "foreign")).is_err());
}
#[test]
fn chunks_are_ordered_and_retries_match() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use serde_json::json;
    let tmp = tempfile::Builder::new()
        .tempdir_in(fs::canonicalize(std::env::temp_dir()).unwrap())
        .unwrap();
    let root = tmp.path();
    let bytes = b"archive";
    let job = protocol::call(
        root,
        json!({"op":"beginRestore","size":bytes.len(),"sha256":store::hash(bytes)}),
    )
    .unwrap();
    let id = job["id"].as_str().unwrap();
    assert!(protocol::call(
        root,
        json!({"op":"writeChunk","jobId":id,"index":1,"data":STANDARD.encode(bytes)})
    )
    .is_err());
    let chunk = json!({"op":"writeChunk","jobId":id,"index":0,"data":STANDARD.encode(bytes)});
    protocol::call(root, chunk.clone()).unwrap();
    protocol::call(root, chunk).unwrap();
    assert!(protocol::call(
        root,
        json!({"op":"writeChunk","jobId":id,"index":0,"data":STANDARD.encode(b"changed")})
    )
    .is_err());
}
