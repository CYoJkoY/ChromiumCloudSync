use crate::{archive, categories, logical, model::*, profiles, store};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::Path,
    process::{Command, Stdio},
    time::{Duration, Instant},
};

pub fn browser_running() -> bool {
    use sysinfo::{ProcessesToUpdate, System};
    let mut system = System::new();
    system.refresh_processes(ProcessesToUpdate::All, true);
    system.processes().values().any(|p| {
        let name = p.name().to_string_lossy().to_lowercase();
        [
            "chrome",
            "chromium",
            "msedge",
            "microsoft edge",
            "brave",
            "vivaldi",
            "opera",
            "google chrome",
            "arc",
        ]
        .iter()
        .any(|n| {
            name == *n || name == format!("{n}.exe") || name.starts_with(&format!("{n} helper"))
        })
    })
}
pub fn require_idle() -> Result<()> {
    if browser_running() {
        Err("Close all Chromium browsers; no process will be terminated automatically".into())
    } else {
        Ok(())
    }
}
pub fn spawn() -> Result<()> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut c = Command::new(exe);
    c.arg("--worker")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x01000000 | 0x00000008 | 0x00000200);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            c.pre_exec(|| {
                if libc::setsid() == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    c.spawn()
        .map_err(|e| format!("Unable to start offline worker: {e}"))?;
    Ok(())
}
#[derive(Serialize, Deserialize)]
struct Action {
    target: String,
    existed: bool,
}
#[derive(Serialize, Deserialize)]
struct LogicalAction {
    extension_id: String,
    records: logical::Records,
}
#[derive(Serialize, Deserialize)]
struct Journal {
    actions: Vec<Action>,
    logical: Vec<LogicalAction>,
    #[serde(default)]
    new_origins: Vec<String>,
    state: String,
}
fn remove_owned(path: &Path) -> Result<()> {
    if !path.exists() {
        return Ok(());
    }
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| e.to_string())
    } else {
        fs::remove_file(path).map_err(|e| e.to_string())
    }
}
fn recover(
    profile: &Profile,
    dir: &Path,
    journal: &mut Journal,
    idle: &dyn Fn() -> Result<()>,
) -> Result<()> {
    idle()?;
    for action in &journal.actions {
        idle()?;
        let target = store::safe_join(&profile.path(), &action.target)?;
        remove_owned(&target)?;
        if action.existed {
            logical::copy_tree(
                &store::safe_join(&dir.join("rollback"), &action.target)?,
                &target,
            )?;
        }
    }
    for action in &journal.logical {
        idle()?;
        logical::write(&profile.path(), &action.extension_id, &action.records)?;
    }
    for id in &journal.new_origins {
        idle()?;
        logical::remove_origin(&profile.path(), id)?;
    }
    journal.state = "rolledBack".into();
    store::save(&dir.join("journal.json"), journal)
}
fn compatible(profile: &Profile, m: &Manifest, plan: &Plan) -> Result<()> {
    archive::validate(m)?;
    if plan.categories.iter().any(|c| c != "program") {
        let version = profiles::version(profile);
        let major = |v: &str| v.split('.').next().unwrap_or("").to_string();
        if m.platform != std::env::consts::OS
            || m.browser != profile.browser
            || major(&m.browser_version).is_empty()
            || major(&version) != major(&m.browser_version)
        {
            return Err("Persistent database restore requires the same OS, browser family and major version. Program-only restore remains available.".into());
        }
    }
    if plan
        .extension_ids
        .iter()
        .any(|id| !m.extension_ids.contains(id))
        || plan.categories.iter().any(|c| !m.categories.contains(c))
    {
        return Err("Selection is absent from backup".into());
    }
    Ok(())
}
pub fn preview(profile: &Profile, m: &Manifest, plan: &Plan) -> Result<()> {
    compatible(profile, m, plan)
}
fn restore(profile: &Profile, job: &Job, dir: &Path, idle: &dyn Fn() -> Result<()>) -> Result<()> {
    let jp = dir.join("journal.json");
    if jp.exists() {
        let mut j: Journal = store::json(&jp)?;
        if j.state == "applied" {
            return Ok(());
        }
        if j.state == "prepared" {
            recover(profile, dir, &mut j, idle)?;
            return Err(
                "Interrupted restore rolled back; create a new restore task to retry".into(),
            );
        }
        if j.state == "rolledBack" {
            return Err("Restore has been rolled back".into());
        }
    }
    let m = archive::inspect(dir, true)?;
    compatible(profile, &m, &job.plan)?;
    idle()?;
    let mut journal = Journal {
        actions: vec![],
        logical: vec![],
        new_origins: vec![],
        state: "prepared".into(),
    };
    let incoming = dir.join("incoming");
    for id in &job.plan.extension_ids {
        for category in &job.plan.categories {
            if category == "localStorage" {
                journal.logical.push(LogicalAction {
                    extension_id: id.clone(),
                    records: logical::read(&profile.path(), id)?,
                });
                continue;
            }
            let paths = if category == "files" {
                let present = m
                    .files
                    .iter()
                    .any(|e| e.extension_id == *id && e.category == *category);
                let existing = logical::filesystem_path(&profile.path(), id, false)?;
                if existing.is_none() && !present {
                    continue;
                }
                if existing.is_none() {
                    journal.new_origins.push(id.clone());
                    store::save(&jp, &journal)?;
                }
                let name = logical::filesystem_path(&profile.path(), id, true)?
                    .ok_or("Missing origin mapping")?;
                let target = format!("File System/{name}/p");
                let src = incoming.join(format!("@files/{id}/p"));
                let mapped = store::safe_join(&incoming, &target)?;
                if src.exists() {
                    logical::copy_tree(&src, &mapped)?;
                }
                vec![target]
            } else {
                categories::paths(&profile.path(), id, category)?
            };
            for rel in paths {
                if category == "program"
                    && !m
                        .files
                        .iter()
                        .any(|e| e.extension_id == *id && e.category == *category)
                {
                    continue;
                }
                let target = store::safe_join(&profile.path(), &rel)?;
                let existed = target.exists();
                if existed {
                    logical::copy_tree(&target, &store::safe_join(&dir.join("rollback"), &rel)?)?;
                }
                journal.actions.push(Action {
                    target: rel,
                    existed,
                });
            }
        }
    }
    // Every overwritten scope has a rollback copy before this durable boundary.
    store::save(&jp, &journal)?;
    let apply = (|| -> Result<()> {
        for action in &journal.actions {
            idle()?;
            let target = store::safe_join(&profile.path(), &action.target)?;
            remove_owned(&target)?;
            let source = store::safe_join(&incoming, &action.target)?;
            if source.exists() {
                logical::copy_tree(&source, &target)?;
            }
        }
        for action in &journal.logical {
            idle()?;
            let records: logical::Records =
                store::json(&incoming.join(format!("@localStorage/{}.json", action.extension_id)))?;
            logical::write(&profile.path(), &action.extension_id, &records)?;
        }
        Ok(())
    })();
    if let Err(e) = apply {
        match recover(profile, dir, &mut journal, idle) {
            Ok(()) => return Err(format!("Restore rolled back: {e}")),
            Err(rollback) => return Err(format!("Recovery required: {e}; {rollback}")),
        }
    }
    journal.state = "applied".into();
    store::save(&jp, &journal)
}
pub fn run(root: &Path) -> Result<()> {
    fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let lock = fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("worker.lock"))
        .map_err(|e| e.to_string())?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(());
    }
    let deadline = Instant::now() + Duration::from_secs(1800);
    loop {
        let mut pending = false;
        for mut job in crate::protocol::jobs(root)? {
            let bridge = fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .read(true)
                .write(true)
                .open(root.join("bridge.lock"))
                .map_err(|e| e.to_string())?;
            bridge.lock_exclusive().map_err(|e| e.to_string())?;
            job = store::json(&store::job_dir(root, &job.id)?.join("job.json"))?;
            if !["waiting", "running", "recovering"].contains(&job.state.as_str()) {
                continue;
            }
            pending = true;
            let dir = store::job_dir(root, &job.id)?;
            if browser_running() {
                if Instant::now() >= deadline {
                    job.state = "timedOut".into();
                    job.error = "Close browsers and retry; no live storage was copied".into();
                    store::save(&dir.join("job.json"), &job)?;
                }
                continue;
            }
            job.state = "running".into();
            store::save(&dir.join("job.json"), &job)?;
            let result = (|| -> Result<()> {
                let profile = profiles::get(root, &job.plan.profile_id)?;
                if job.kind == "backup" {
                    let m = archive::backup(&profile, &job.plan, &dir, &job.id)?;
                    require_idle()?;
                    job.size = fs::metadata(dir.join("archive.zip"))
                        .map_err(|e| e.to_string())?
                        .len();
                    job.sha256 = store::file_hash(&dir.join("archive.zip"))?;
                    job.manifest = Some(m);
                    job.state = "ready".into();
                } else if job.kind == "rollback" {
                    let mut j: Journal = store::json(&dir.join("journal.json"))?;
                    recover(&profile, &dir, &mut j, &require_idle)?;
                    job.state = "rolledBack".into();
                } else {
                    restore(&profile, &job, &dir, &require_idle)?;
                    job.state = "restored".into();
                }
                Ok(())
            })();
            if let Err(e) = result {
                let journal_state = if dir.join("journal.json").exists() {
                    store::json::<Journal>(&dir.join("journal.json"))?.state
                } else {
                    String::new()
                };
                job.state = match journal_state.as_str() {
                    "prepared" => "recovering",
                    "rolledBack" => "rolledBack",
                    _ => "failed",
                }
                .into();
                job.error = e;
            }
            store::save(&dir.join("job.json"), &job)?;
        }
        if !pending || Instant::now() >= deadline {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(3));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_selected_scope_and_rolls_back() {
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
        fs::write(p.root.join("Last Version"), "130.0").unwrap();
        let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let other = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
        let target = p.path().join(format!("Local Extension Settings/{id}"));
        let unrelated = p.path().join(format!("Local Extension Settings/{other}"));
        fs::create_dir_all(&target).unwrap();
        fs::create_dir_all(&unrelated).unwrap();
        fs::write(target.join("db"), b"snapshot").unwrap();
        fs::write(unrelated.join("db"), b"unrelated").unwrap();
        let plan = categories::plan(&p, vec![id.into()], vec!["local".into()]).unwrap();
        let dir = tmp.path().join("job");
        fs::create_dir_all(&dir).unwrap();
        let m = archive::backup(&p, &plan, &dir, "1-2-3").unwrap();
        fs::write(target.join("db"), b"original").unwrap();
        fs::write(target.join("extra"), b"extra").unwrap();
        let job = Job {
            id: "1-2-3".into(),
            kind: "restore".into(),
            state: "waiting".into(),
            plan,
            error: String::new(),
            created_at: now(),
            size: 0,
            sha256: String::new(),
            received: 0,
            manifest: Some(m),
        };
        assert!(restore(&p, &job, &dir, &|| Err("Browser open".into())).is_err());
        assert_eq!(fs::read(target.join("db")).unwrap(), b"original");
        assert!(!dir.join("journal.json").exists());
        restore(&p, &job, &dir, &|| Ok(())).unwrap();
        assert_eq!(fs::read(target.join("db")).unwrap(), b"snapshot");
        assert!(!target.join("extra").exists());
        assert_eq!(fs::read(unrelated.join("db")).unwrap(), b"unrelated");
        let mut journal: Journal = store::json(&dir.join("journal.json")).unwrap();
        recover(&p, &dir, &mut journal, &|| Ok(())).unwrap();
        assert_eq!(fs::read(target.join("db")).unwrap(), b"original");
        assert!(target.join("extra").exists());
        assert!(restore(&p, &job, &dir, &|| Err("Browser open".into())).is_err());
    }
    #[test]
    fn interrupted_restore_recovers_new_file_origin_and_original_data() {
        use std::cell::Cell;
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
        fs::write(p.root.join("Last Version"), "130.0").unwrap();
        let id = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        let local = p.path().join(format!("Local Extension Settings/{id}"));
        fs::create_dir_all(&local).unwrap();
        fs::write(local.join("db"), b"snapshot").unwrap();
        let origin = logical::filesystem_path(&p.path(), id, true)
            .unwrap()
            .unwrap();
        let files = p.path().join(format!("File System/{origin}/p"));
        fs::create_dir_all(&files).unwrap();
        fs::write(files.join("payload"), b"persistent").unwrap();
        let plan =
            categories::plan(&p, vec![id.into()], vec!["local".into(), "files".into()]).unwrap();
        let dir = tmp.path().join("job");
        fs::create_dir_all(&dir).unwrap();
        let m = archive::backup(&p, &plan, &dir, "1-2-3").unwrap();
        logical::remove_origin(&p.path(), id).unwrap();
        fs::write(local.join("db"), b"original").unwrap();
        let job = Job {
            id: "1-2-3".into(),
            kind: "restore".into(),
            state: "waiting".into(),
            plan,
            error: String::new(),
            created_at: now(),
            size: 0,
            sha256: String::new(),
            received: 0,
            manifest: Some(m),
        };
        let calls = Cell::new(0);
        let result = restore(&p, &job, &dir, &|| {
            calls.set(calls.get() + 1);
            if calls.get() >= 3 {
                Err("Injected browser reopen".into())
            } else {
                Ok(())
            }
        });
        assert!(result.unwrap_err().contains("Recovery required"));
        assert_eq!(fs::read(local.join("db")).unwrap(), b"snapshot");
        let mut journal: Journal = store::json(&dir.join("journal.json")).unwrap();
        assert_eq!(journal.state, "prepared");
        recover(&p, &dir, &mut journal, &|| Ok(())).unwrap();
        assert_eq!(fs::read(local.join("db")).unwrap(), b"original");
        assert!(logical::filesystem_path(&p.path(), id, false)
            .unwrap()
            .is_none());
        assert_eq!(journal.state, "rolledBack");
    }
}
