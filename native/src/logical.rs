//! Logical access to shared databases. No shared database file enters an archive.
use crate::{categories, model::*, store};
use base64::{engine::general_purpose::STANDARD, Engine};
use rusty_leveldb::{LdbIterator, Options, WriteBatch, DB};
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Records {
    pub version: u8,
    pub entries: Vec<(String, String)>,
}
fn options(create: bool) -> Options {
    let mut o = Options::default();
    o.create_if_missing = create;
    o.paranoid_checks = true;
    o
}
fn open(path: &Path, create: bool) -> Result<DB> {
    DB::open(path, options(create)).map_err(|e| format!("Unsupported or locked LevelDB: {e}"))
}
fn get(db: &mut DB, key: &[u8]) -> Result<Option<Vec<u8>>> {
    let snapshot = db.get_snapshot();
    db.get_at(&snapshot, key)
        .map(|value| value.map(|bytes| bytes.to_vec()))
        .map_err(|e| format!("LevelDB read failed: {e}"))
}
pub fn belongs(id: &str, key: &[u8]) -> bool {
    let origin = format!("chrome-extension://{id}");
    key.starts_with(format!("_{origin}\0").as_bytes())
        || key == format!("META:{origin}").as_bytes()
        || key == format!("METAACCESS:{origin}").as_bytes()
}
pub fn read(profile: &Path, id: &str) -> Result<Records> {
    let directory = store::safe_join(profile, "Local Storage")?;
    if directory.exists()
        && fs::read_dir(&directory)
            .map_err(|e| e.to_string())?
            .any(|e| {
                e.is_ok_and(|e| {
                    e.path()
                        .extension()
                        .is_some_and(|x| x == "sqlite" || x == "sqlite3")
                })
            })
    {
        return Err("SQLite localStorage is not supported".into());
    }
    let path = store::safe_join(profile, "Local Storage/leveldb")?;
    if !path.exists() {
        return Ok(Records {
            version: 1,
            entries: vec![],
        });
    }
    let mut db = open(&path, false)?;
    if get(&mut db, b"VERSION")?.as_deref() != Some(b"1") {
        return Err("Unknown localStorage schema; only LevelDB VERSION=1 is supported".into());
    }
    let mut it = db.new_iter().map_err(|e| e.to_string())?;
    let mut entries = vec![];
    while let Some((k, v)) = it.next() {
        if belongs(id, &k) {
            entries.push((STANDARD.encode(k), STANDARD.encode(v)));
        }
    }
    Ok(Records {
        version: 1,
        entries,
    })
}
pub fn write(profile: &Path, id: &str, records: &Records) -> Result<()> {
    if records.version != 1 || !valid_id(id) {
        return Err("Unsupported logical storage format".into());
    }
    let decoded = records
        .entries
        .iter()
        .map(|(k, v)| {
            let key = STANDARD.decode(k).map_err(|e| e.to_string())?;
            let value = STANDARD.decode(v).map_err(|e| e.to_string())?;
            if !belongs(id, &key) {
                return Err("Logical record belongs to another origin".into());
            }
            Ok((key, value))
        })
        .collect::<Result<Vec<_>>>()?;
    let path = store::safe_join(profile, "Local Storage/leveldb")?;
    fs::create_dir_all(path.parent().ok_or("Missing storage parent")?)
        .map_err(|e| e.to_string())?;
    let exists = path.exists();
    let mut db = open(&path, !exists)?;
    if exists && get(&mut db, b"VERSION")?.as_deref() != Some(b"1") {
        return Err("Unknown target localStorage schema".into());
    }
    let mut batch = WriteBatch::default();
    if !exists {
        batch.put(b"VERSION", b"1");
    }
    let mut it = db.new_iter().map_err(|e| e.to_string())?;
    while let Some((k, _)) = it.next() {
        if belongs(id, &k) {
            batch.delete(&k);
        }
    }
    drop(it);
    for (k, v) in decoded {
        batch.put(&k, &v);
    }
    db.write(batch, true).map_err(|e| e.to_string())?;
    db.flush().map_err(|e| e.to_string())
}
// Copying a locked database for a preview is deliberately forbidden. The worker
// calls these functions only after browser shutdown and holds the job lock.
pub fn filesystem_path(profile: &Path, id: &str, create: bool) -> Result<Option<String>> {
    if !valid_id(id) {
        return Err("Invalid extension id".into());
    }
    let path = store::safe_join(profile, "File System/Origins")?;
    if !path.exists() && !create {
        return Ok(None);
    }
    fs::create_dir_all(path.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
    let mut db = open(&path, create)?;
    let key = format!("ORIGIN:chrome-extension_{id}_0");
    if let Some(value) = get(&mut db, key.as_bytes())? {
        let name = String::from_utf8(value.to_vec()).map_err(|e| e.to_string())?;
        if name.is_empty() || !name.bytes().all(|b| b.is_ascii_digit()) {
            return Err("Unknown File System origin mapping".into());
        }
        return Ok(Some(name));
    }
    if !create {
        return Ok(None);
    }
    let last = get(&mut db, b"LAST_PATH")?
        .map(|v| String::from_utf8(v.to_vec()).map_err(|e| e.to_string()))
        .transpose()?
        .unwrap_or_else(|| "-1".into());
    let mut next = last
        .parse::<i64>()
        .map_err(|_| "Unknown File System allocator")?
        .checked_add(1)
        .ok_or("File System allocator overflow")?;
    while profile.join(format!("File System/{next:03}")).exists() {
        next += 1;
    }
    let name = format!("{next:03}");
    let mut batch = WriteBatch::default();
    batch.put(b"LAST_PATH", name.as_bytes());
    batch.put(key.as_bytes(), name.as_bytes());
    db.write(batch, true).map_err(|e| e.to_string())?;
    db.flush().map_err(|e| e.to_string())?;
    Ok(Some(name))
}
pub fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    fs::create_dir_all(to).map_err(|e| e.to_string())?;
    let mut all = vec![];
    for item in fs::read_dir(from).map_err(|e| e.to_string())? {
        let name = item
            .map_err(|e| e.to_string())?
            .file_name()
            .into_string()
            .map_err(|_| "Non-Unicode file")?;
        if name != "LOCK" {
            categories::walk(from, &name, &mut all)?;
        }
    }
    for (rel, path, _) in all {
        let size = fs::metadata(&path).map_err(|e| e.to_string())?.len();
        if fs2::available_space(to).map_err(|e| e.to_string())?
            < size.saturating_add(64 * 1024 * 1024)
        {
            return Err("Insufficient free space; keep at least 64 MiB reserve".into());
        }
        let dest = store::safe_join(to, &rel)?;
        fs::create_dir_all(dest.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
        fs::copy(path, &dest).map_err(|e| e.to_string())?;
        fs::OpenOptions::new()
            .write(true)
            .open(&dest)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
pub fn remove_origin(profile: &Path, id: &str) -> Result<()> {
    if let Some(name) = filesystem_path(profile, id, false)? {
        let path = store::safe_join(profile, &format!("File System/{name}/p"))?;
        if path.exists() {
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
        let mut db = open(&store::safe_join(profile, "File System/Origins")?, false)?;
        let mut batch = WriteBatch::default();
        batch.delete(format!("ORIGIN:chrome-extension_{id}_0").as_bytes());
        db.write(batch, true).map_err(|e| e.to_string())?;
        db.flush().map_err(|e| e.to_string())?;
    }
    Ok(())
}
