use crate::{model::*, store};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Adapter {
    pub id: &'static str,
    pub version: u8,
    pub layout: &'static str,
    pub backup: bool,
    pub restore: bool,
}
pub const ADAPTERS: &[Adapter] = &[
    Adapter {
        id: "program",
        version: 1,
        layout: "extensions-id-version-manifest",
        backup: true,
        restore: true,
    },
    Adapter {
        id: "local",
        version: 1,
        layout: "local-extension-settings-leveldb",
        backup: true,
        restore: true,
    },
    Adapter {
        id: "sync",
        version: 1,
        layout: "sync-extension-settings-leveldb",
        backup: true,
        restore: true,
    },
    Adapter {
        id: "indexeddb",
        version: 1,
        layout: "origin-indexeddb-leveldb-and-blobs",
        backup: true,
        restore: true,
    },
    Adapter {
        id: "localStorage",
        version: 1,
        layout: "dom-storage-leveldb-version-1",
        backup: true,
        restore: true,
    },
    Adapter {
        id: "files",
        version: 1,
        layout: "legacy-origin-persistent-filesystem",
        backup: true,
        restore: true,
    },
    Adapter {
        id: "buckets",
        version: 1,
        layout: "storage-buckets-opfs-unrecognized",
        backup: false,
        restore: false,
    },
];
pub fn layouts(selected: &[String]) -> Result<BTreeMap<String, u8>> {
    selected
        .iter()
        .map(|id| {
            let adapter = ADAPTERS
                .iter()
                .find(|adapter| adapter.id == id && adapter.backup && adapter.restore)
                .ok_or("Unsupported category adapter")?;
            Ok((id.clone(), adapter.version))
        })
        .collect()
}
pub fn program_versions(profile: &Path, id: &str) -> Result<Vec<String>> {
    use base64::{engine::general_purpose::STANDARD, Engine};
    let directory = store::safe_join(profile, &format!("Extensions/{id}"))?;
    if !directory.exists() {
        return Ok(vec![]);
    }
    let mut versions = vec![];
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry
            .file_name()
            .into_string()
            .map_err(|_| "Non-Unicode program version")?;
        let manifest_path =
            store::safe_join(profile, &format!("Extensions/{id}/{name}/manifest.json"))?;
        if fs::metadata(&manifest_path)
            .map_err(|e| e.to_string())?
            .len()
            > 1024 * 1024
        {
            return Err("Extension manifest exceeds limit".into());
        }
        let manifest: serde_json::Value = store::json(&manifest_path)?;
        let version = manifest["version"]
            .as_str()
            .ok_or("Extension manifest has no version")?;
        if name.split('_').next() != Some(version) {
            return Err("Extension program version does not match its directory".into());
        }
        if let Some(key) = manifest.get("key") {
            let bytes = STANDARD
                .decode(key.as_str().ok_or("Invalid extension public key")?)
                .map_err(|e| e.to_string())?;
            let digest = store::hash(&bytes);
            let computed: String = digest[..32]
                .chars()
                .map(|c| char::from(b'a' + c.to_digit(16).unwrap() as u8))
                .collect();
            if computed != id {
                return Err("Extension public key does not match the selected ID".into());
            }
        }
        versions.push(version.into());
    }
    versions.sort();
    versions.dedup();
    Ok(versions)
}

// The category registry is the only owner of Profile-relative target mapping.
pub fn paths(profile: &Path, id: &str, category: &str) -> Result<Vec<String>> {
    if !valid_id(id) {
        return Err("Invalid extension id".into());
    }
    let values = match category {
        "program" => vec![format!("Extensions/{id}")],
        "local" => vec![format!("Local Extension Settings/{id}")],
        "sync" => vec![format!("Sync Extension Settings/{id}")],
        "indexeddb" => vec![
            format!("IndexedDB/chrome-extension_{id}_0.indexeddb.leveldb"),
            format!("IndexedDB/chrome-extension_{id}_0.indexeddb.blob"),
        ],
        "localStorage" => vec![format!("@localStorage/{id}.json")],
        "files" => vec![format!("@files/{id}/p")],
        _ => return Err("Unknown category".into()),
    };
    for p in &values {
        store::safe_join(profile, p)?;
    }
    Ok(values)
}
pub fn owned(id: &str, category: &str, path: &str) -> bool {
    if !valid_id(id) || store::relative(path).is_err() {
        return false;
    }
    if category == "localStorage" {
        return path == format!("@localStorage/{id}.json");
    }
    if category == "files" {
        return path.starts_with(&format!("@files/{id}/p/"));
    }
    let prefixes = match category {
        "program" => vec![format!("Extensions/{id}")],
        "local" => vec![format!("Local Extension Settings/{id}")],
        "sync" => vec![format!("Sync Extension Settings/{id}")],
        "indexeddb" => vec![
            format!("IndexedDB/chrome-extension_{id}_0.indexeddb.leveldb"),
            format!("IndexedDB/chrome-extension_{id}_0.indexeddb.blob"),
        ],
        _ => return false,
    };
    prefixes.iter().any(|p| path.starts_with(&format!("{p}/")))
}
pub fn walk(root: &Path, relative: &str, out: &mut Vec<(String, PathBuf, u64)>) -> Result<()> {
    let path = store::safe_join(root, relative)?;
    if !path.exists() {
        return Ok(());
    }
    let m = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
    if m.is_dir() {
        let mut children = fs::read_dir(&path)
            .map_err(|e| e.to_string())?
            .collect::<std::result::Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        children.sort_by_key(|a| a.file_name());
        for item in children {
            let name = item
                .file_name()
                .into_string()
                .map_err(|_| "Non-Unicode file name")?;
            if name == "LOCK" {
                continue;
            }
            walk(root, &format!("{relative}/{name}"), out)?;
        }
    } else if m.is_file() {
        if out.len() >= MAX_FILES {
            return Err("File count exceeds limit".into());
        }
        out.push((relative.into(), path, m.len()));
    } else {
        return Err("Unsupported special file".into());
    }
    Ok(())
}
pub fn plan(profile: &Profile, ids: Vec<String>, categories: Vec<String>) -> Result<Plan> {
    if ids.len() > 128
        || ids.iter().collect::<std::collections::HashSet<_>>().len() != ids.len()
        || categories.len() > CATEGORIES.len()
        || categories
            .iter()
            .collect::<std::collections::HashSet<_>>()
            .len()
            != categories.len()
    {
        return Err("Duplicate or excessive selection".into());
    }
    if ids.is_empty() || categories.is_empty() {
        return Err("Select extensions and categories".into());
    }
    let mut capabilities = vec![];
    for id in &ids {
        if !valid_id(id) {
            return Err("Invalid extension id".into());
        }
        for category in &categories {
            let result = paths(&profile.path(), id, category);
            let (supported, reason, files, bytes) = match result {
                Ok(paths) => {
                    if category == "localStorage" || category == "files" {
                        (true,"Origin-scoped legacy LevelDB layout only; verified after browser closes. Storage buckets and SQLite layouts are excluded.".into(),0,0)
                    } else {
                        let mut all = vec![];
                        for p in paths {
                            walk(&profile.path(), &p, &mut all)?;
                        }
                        (
                            true,
                            String::new(),
                            all.len(),
                            all.iter().map(|e| e.2).sum(),
                        )
                    }
                }
                Err(e) => (false, e, 0, 0),
            };
            capabilities.push(Capability {
                extension_id: id.clone(),
                category: category.clone(),
                supported,
                reason,
                files,
                bytes,
            });
        }
    }
    if capabilities.iter().map(|c| c.bytes).sum::<u64>() > MAX_BYTES {
        return Err("Backup exceeds 32 GiB limit".into());
    }
    Ok(Plan {
        id: id(),
        profile_id: profile.id.clone(),
        extension_ids: ids,
        categories,
        capabilities,
    })
}
