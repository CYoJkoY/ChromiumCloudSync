use crate::{archive, categories, model::*, profiles, store, worker};
use base64::{engine::general_purpose::STANDARD, Engine};
use fs2::FileExt;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Seek, SeekFrom, Write},
    path::Path,
};

fn string<'a>(v: &'a Value, key: &str) -> Result<&'a str> {
    v.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| format!("Missing {key}"))
}
fn number(v: &Value, key: &str) -> Result<u64> {
    v.get(key)
        .and_then(Value::as_u64)
        .ok_or_else(|| format!("Missing {key}"))
}
fn list(v: &Value, key: &str) -> Result<Vec<String>> {
    serde_json::from_value(
        v.get(key)
            .cloned()
            .ok_or_else(|| format!("Missing {key}"))?,
    )
    .map_err(|e| e.to_string())
}
pub fn jobs(root: &Path) -> Result<Vec<Job>> {
    let path = root.join("jobs");
    if !path.exists() {
        return Ok(vec![]);
    }
    let mut out = vec![];
    for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
        let file = entry.map_err(|e| e.to_string())?.path().join("job.json");
        if file.is_file() {
            out.push(store::json(&file)?);
        }
    }
    out.sort_by(|a: &Job, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}
fn load(root: &Path, id: &str) -> Result<Job> {
    store::json(&store::job_dir(root, id)?.join("job.json"))
}
fn save(root: &Path, job: &Job) -> Result<()> {
    store::save(&store::job_dir(root, &job.id)?.join("job.json"), job)
}
fn summary(job: &Job) -> Value {
    let mut value = json!(job);
    value.as_object_mut().unwrap().remove("manifest");
    value["plan"]["capabilities"] = json!([]);
    value["progress"] = json!({"phase":job.state,"completedBytes": if job.state == "receiving" { job.received } else if ["ready","uploaded","restored"].contains(&job.state.as_str()) { job.size } else { 0 },"totalBytes":job.size});
    value
}
pub fn envelope(root: &Path, request: Value) -> Value {
    let request_id = request
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or("");
    let operation = request.get("op").and_then(Value::as_str).unwrap_or("");
    let result = if request.get("protocol").and_then(Value::as_u64) != Some(1)
        || request_id.is_empty()
        || request_id.len() > 64
        || !request_id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-')
    {
        Err("Protocol v1 and a valid requestId are required".into())
    } else {
        call(root, request.clone())
    };
    match result {
        Ok(value) => json!({"protocol":1,"requestId":request_id,"ok":true,"value":value}),
        Err(message) => {
            json!({"protocol":1,"requestId":request_id,"ok":false,"error":{"code":"BACKUP_OPERATION_FAILED","operation":operation,"message":message}})
        }
    }
}
fn new_job(kind: &str, plan: Plan) -> Job {
    Job {
        id: id(),
        kind: kind.into(),
        state: "waiting".into(),
        plan,
        error: String::new(),
        created_at: now(),
        size: 0,
        sha256: String::new(),
        received: 0,
        manifest: None,
    }
}
pub fn call(root: &Path, v: Value) -> Result<Value> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    // Serialize bridge mutations; workers hold a separate lifetime lock.
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("bridge.lock"))
        .map_err(|e| e.to_string())?;
    lock.lock_exclusive().map_err(|e| e.to_string())?;
    let op = string(&v, "op")?;
    match op {
        "hello" => Ok(
            json!({"protocol":1,"version":env!("CARGO_PKG_VERSION"),"platform":std::env::consts::OS,"categories":CATEGORIES,"adapters":categories::ADAPTERS,"chunkSize":CHUNK}),
        ),
        "profiles" => Ok(json!(profiles::discover(root)?)),
        "registerProfile" => Ok(json!(profiles::register(
            root,
            Path::new(string(&v, "path")?),
            string(&v, "browser")?
        )?)),
        "plan" => {
            let profile = profiles::get(root, string(&v, "profileId")?)?;
            let plan =
                categories::plan(&profile, list(&v, "extensionIds")?, list(&v, "categories")?)?;
            store::save(&root.join("plans").join(format!("{}.json", plan.id)), &plan)?;
            Ok(json!(plan))
        }
        "scheduleBackup" => {
            let id = string(&v, "planId")?;
            store::job_dir(root, id)?;
            let plan: Plan = store::json(&root.join("plans").join(format!("{id}.json")))?;
            if plan.capabilities.iter().any(|c| !c.supported) {
                return Err("Deselect unsupported categories".into());
            }
            let job = new_job("backup", plan);
            save(root, &job)?;
            worker::spawn()?;
            Ok(summary(&job))
        }
        "jobs" => {
            let mut all = jobs(root)?;
            if all
                .iter()
                .any(|j| ["waiting", "running", "recovering"].contains(&j.state.as_str()))
            {
                worker::spawn()?;
            }
            // Keep pending work reachable even after many completed snapshots.
            all.sort_by_key(|j| {
                ![
                    "ready",
                    "waiting",
                    "running",
                    "recovering",
                    "receiving",
                    "preview",
                ]
                .contains(&j.state.as_str())
            });
            Ok(json!(all.iter().take(50).map(summary).collect::<Vec<_>>()))
        }
        "readChunk" => {
            let job = load(root, string(&v, "jobId")?)?;
            if !["ready", "uploaded"].contains(&job.state.as_str()) {
                return Err("Backup is not ready".into());
            }
            let offset = number(&v, "index")?
                .checked_mul(CHUNK as u64)
                .ok_or("Chunk offset overflow")?;
            if offset >= job.size {
                return Err("Chunk out of range".into());
            }
            let mut f = fs::File::open(store::job_dir(root, &job.id)?.join("archive.zip"))
                .map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            let mut data = vec![0; CHUNK.min((job.size - offset) as usize)];
            f.read_exact(&mut data).map_err(|e| e.to_string())?;
            Ok(json!({"data":STANDARD.encode(&data),"sha256":store::hash(&data)}))
        }
        "beginRestore" => {
            let size = number(&v, "size")?;
            let hash = string(&v, "sha256")?;
            if size == 0
                || size > MAX_BYTES
                || hash.len() != 64
                || !hash.bytes().all(|b| b.is_ascii_hexdigit())
            {
                return Err("Invalid archive size or hash".into());
            }
            let plan = Plan {
                id: id(),
                profile_id: String::new(),
                extension_ids: vec![],
                categories: vec![],
                capabilities: vec![],
            };
            let mut job = new_job("restore", plan);
            job.state = "receiving".into();
            job.size = size;
            job.sha256 = hash.into();
            save(root, &job)?;
            Ok(summary(&job))
        }
        "writeChunk" => {
            let mut job = load(root, string(&v, "jobId")?)?;
            if job.state != "receiving" {
                return Err("Not a receiving task".into());
            }
            let offset = number(&v, "index")?
                .checked_mul(CHUNK as u64)
                .ok_or("Offset overflow")?;
            let data = STANDARD
                .decode(string(&v, "data")?)
                .map_err(|e| e.to_string())?;
            if data.is_empty()
                || data.len() > CHUNK
                || offset > job.received
                || offset + data.len() as u64 > job.size
                || (data.len() != CHUNK && offset + data.len() as u64 != job.size)
            {
                return Err("Invalid or out-of-order chunk".into());
            }
            let path = store::job_dir(root, &job.id)?.join("archive.zip");
            let mut f = fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(&path)
                .map_err(|e| e.to_string())?;
            f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
            if offset < job.received {
                let mut old = vec![0; data.len()];
                f.read_exact(&mut old).map_err(|e| e.to_string())?;
                if old != data {
                    return Err("Retry chunk differs".into());
                }
            } else {
                f.write_all(&data).map_err(|e| e.to_string())?;
                f.sync_data().map_err(|e| e.to_string())?;
                job.received += data.len() as u64;
                save(root, &job)?;
            }
            Ok(json!({"received":job.received}))
        }
        "planRestore" => {
            let mut job = load(root, string(&v, "jobId")?)?;
            if job.state != "receiving" || job.received != job.size {
                return Err("Incomplete restore download".into());
            }
            let dir = store::job_dir(root, &job.id)?;
            if store::file_hash(&dir.join("archive.zip"))? != job.sha256 {
                return Err("Archive checksum mismatch".into());
            }
            let m = archive::inspect(&dir, false)?;
            let p = profiles::get(root, string(&v, "profileId")?)?;
            let plan = categories::plan(&p, list(&v, "extensionIds")?, list(&v, "categories")?)?;
            worker::preview(&p, &m, &plan)?;
            job.plan = plan;
            job.manifest = Some(m);
            job.state = "preview".into();
            save(root, &job)?;
            Ok(summary(&job))
        }
        "scheduleRestore" | "retry" | "rollback" => {
            let mut job = load(root, string(&v, "jobId")?)?;
            let allowed = match op {
                "scheduleRestore" => job.state == "preview",
                "rollback" => job.state == "restored",
                _ => ["timedOut", "failed"].contains(&job.state.as_str()),
            };
            if !allowed {
                return Err("Task state does not permit this operation".into());
            }
            if op == "rollback" {
                job.kind = "rollback".into();
            }
            job.state = "waiting".into();
            job.error.clear();
            save(root, &job)?;
            worker::spawn()?;
            Ok(summary(&job))
        }
        "cancel" => {
            let mut job = load(root, string(&v, "jobId")?)?;
            if !["receiving", "preview", "waiting", "timedOut", "failed"]
                .contains(&job.state.as_str())
            {
                return Err("Task cannot be cancelled during disk writes or recovery".into());
            }
            job.state = "cancelled".into();
            save(root, &job)?;
            Ok(summary(&job))
        }
        "commitUpload" => {
            let mut job = load(root, string(&v, "jobId")?)?;
            if job.state != "ready" {
                return Err("Backup not ready".into());
            }
            job.state = "uploaded".into();
            save(root, &job)?;
            Ok(summary(&job))
        }
        _ => Err("Unknown protocol operation".into()),
    }
}
