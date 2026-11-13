use crate::{categories, logical, model::*, profiles, store};
use std::{
    collections::HashSet,
    fs,
    io::{Read, Write},
    path::Path,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub const FORMAT: &str = "ccsync.extension-backup.v1";
pub fn backup(profile: &Profile, plan: &Plan, dir: &Path, job_id: &str) -> Result<Manifest> {
    let stage = dir.join("snapshot");
    fs::create_dir_all(&stage).map_err(|e| e.to_string())?;
    let mut files = vec![];
    let mut total = 0u64;
    for id in &plan.extension_ids {
        for category in &plan.categories {
            let mut sources = vec![];
            if category == "localStorage" {
                let rel = format!("@localStorage/{id}.json");
                let target = store::safe_join(&stage, &rel)?;
                store::save(&target, &logical::read(&profile.path(), id)?)?;
                sources.push((
                    rel,
                    target.clone(),
                    fs::metadata(target).map_err(|e| e.to_string())?.len(),
                ));
            } else if category == "files" {
                if let Some(origin) = logical::filesystem_path(&profile.path(), id, false)? {
                    // Only persistent data (p), never temporary files (t).
                    let rel = format!("File System/{origin}/p");
                    let mut all = vec![];
                    categories::walk(&profile.path(), &rel, &mut all)?;
                    for (path, source, size) in all {
                        sources.push((
                            format!(
                                "@files/{id}/p/{}",
                                path.strip_prefix(&format!("{rel}/"))
                                    .ok_or("Invalid file origin")?
                            ),
                            source,
                            size,
                        ));
                    }
                }
            } else {
                for rel in categories::paths(&profile.path(), id, category)? {
                    categories::walk(&profile.path(), &rel, &mut sources)?;
                }
            }
            for (rel, source, size) in sources {
                if files.len() >= MAX_FILES {
                    return Err("File count exceeds limit".into());
                }
                total = total.checked_add(size).ok_or("Size overflow")?;
                if total > MAX_BYTES {
                    return Err("Backup exceeds size limit".into());
                }
                let dest = store::safe_join(&stage, &rel)?;
                if fs2::available_space(dir).map_err(|e| e.to_string())?
                    < size
                        .saturating_mul(2)
                        .saturating_add(total)
                        .saturating_add(64 * 1024 * 1024)
                {
                    return Err("Insufficient space for snapshot and archive".into());
                }
                if source != dest {
                    fs::create_dir_all(dest.parent().ok_or("Missing parent")?)
                        .map_err(|e| e.to_string())?;
                    fs::copy(source, &dest).map_err(|e| e.to_string())?;
                }
                files.push(Entry {
                    extension_id: id.clone(),
                    category: category.clone(),
                    path: rel,
                    size,
                    sha256: store::file_hash(&dest)?,
                });
            }
        }
    }
    let manifest = Manifest {
        format: FORMAT.into(),
        snapshot_id: job_id.into(),
        browser: profile.browser.clone(),
        browser_version: profiles::version(profile),
        platform: std::env::consts::OS.into(),
        profile: profile.directory.clone(),
        created_at: now(),
        extension_ids: plan.extension_ids.clone(),
        categories: plan.categories.clone(),
        layout_versions: categories::layouts(&plan.categories)?,
        extension_versions: plan
            .extension_ids
            .iter()
            .map(|id| {
                Ok((
                    id.clone(),
                    categories::program_versions(&profile.path(), id)?,
                ))
            })
            .collect::<Result<_>>()?,
        files,
    };
    validate(&manifest)?;
    let metadata = serde_json::to_vec(&manifest).map_err(|e| e.to_string())?;
    if metadata.len() > 16 * 1024 * 1024 {
        return Err("Manifest exceeds the portable restore limit".into());
    }
    let file = fs::File::create(dir.join("archive.zip.partial")).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o600);
    zip.start_file("manifest.json", opts)
        .map_err(|e| e.to_string())?;
    zip.write_all(&metadata).map_err(|e| e.to_string())?;
    for entry in &manifest.files {
        zip.start_file(format!("data/{}", entry.path), opts)
            .map_err(|e| e.to_string())?;
        std::io::copy(
            &mut fs::File::open(store::safe_join(&stage, &entry.path)?)
                .map_err(|e| e.to_string())?,
            &mut zip,
        )
        .map_err(|e| e.to_string())?;
    }
    zip.finish()
        .map_err(|e| e.to_string())?
        .sync_all()
        .map_err(|e| e.to_string())?;
    fs::rename(dir.join("archive.zip.partial"), dir.join("archive.zip"))
        .map_err(|e| e.to_string())?;
    Ok(manifest)
}
pub fn validate(m: &Manifest) -> Result<()> {
    if m.layout_versions != categories::layouts(&m.categories)?
        || m.extension_versions.len() != m.extension_ids.len()
        || m.extension_ids
            .iter()
            .any(|id| !m.extension_versions.contains_key(id))
    {
        return Err("Unsupported storage layout contract".into());
    }
    if m.format != FORMAT
        || m.extension_ids.is_empty()
        || m.categories.is_empty()
        || m.files.len() > MAX_FILES
    {
        return Err("Unsupported manifest".into());
    }
    store::relative(&m.profile)?;
    store::job_dir(Path::new("."), &m.snapshot_id)?;
    let ids: HashSet<_> = m.extension_ids.iter().collect();
    let categories: HashSet<_> = m.categories.iter().collect();
    if ids.len() != m.extension_ids.len()
        || categories.len() != m.categories.len()
        || ids.iter().any(|id| !valid_id(id))
        || categories.iter().any(|c| !CATEGORIES.contains(&c.as_str()))
    {
        return Err("Invalid manifest selection".into());
    }
    let mut seen = HashSet::new();
    let mut total = 0u64;
    for e in &m.files {
        if !ids.contains(&e.extension_id)
            || !categories.contains(&e.category)
            || !categories::owned(&e.extension_id, &e.category, &e.path)
            || !seen.insert(e.path.to_lowercase())
            || e.sha256.len() != 64
            || !e.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Unsafe or duplicate manifest entry".into());
        }
        total = total.checked_add(e.size).ok_or("Size overflow")?;
        if total > MAX_BYTES {
            return Err("Archive expands beyond size limit".into());
        }
    }
    Ok(())
}
pub fn inspect(dir: &Path, extract: bool) -> Result<Manifest> {
    let file = fs::File::open(dir.join("archive.zip")).map_err(|e| e.to_string())?;
    let mut zip = ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut raw = String::new();
    zip.by_name("manifest.json")
        .map_err(|e| e.to_string())?
        .take(16 * 1024 * 1024 + 1)
        .read_to_string(&mut raw)
        .map_err(|e| e.to_string())?;
    if raw.len() > 16 * 1024 * 1024 {
        return Err("Manifest too large".into());
    }
    let manifest: Manifest = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    validate(&manifest)?;
    if zip.len() != manifest.files.len() + 1 {
        return Err("Unlisted or duplicate archive entry".into());
    }
    let expected: HashSet<String> = manifest
        .files
        .iter()
        .map(|e| format!("data/{}", e.path))
        .chain(std::iter::once("manifest.json".into()))
        .collect();
    let mut seen = HashSet::new();
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        if !expected.contains(f.name())
            || !seen.insert(f.name().to_string())
            || f.is_dir()
            || f.unix_mode().is_some_and(|m| m & 0o170000 == 0o120000)
        {
            return Err("Unexpected archive entry".into());
        }
    }
    for e in &manifest.files {
        let mut f = zip
            .by_name(&format!("data/{}", e.path))
            .map_err(|e| e.to_string())?;
        if f.size() != e.size {
            return Err("Entry size mismatch".into());
        }
        use sha2::{Digest, Sha256};
        let mut hash = Sha256::new();
        let mut n = 0u64;
        let mut buf = [0; 65536];
        let mut output = if extract {
            let p = store::safe_join(&dir.join("incoming"), &e.path)?;
            fs::create_dir_all(p.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
            Some(fs::File::create(p).map_err(|e| e.to_string())?)
        } else {
            None
        };
        loop {
            let len = f.read(&mut buf).map_err(|e| e.to_string())?;
            if len == 0 {
                break;
            }
            n += len as u64;
            if n > e.size {
                return Err("Entry exceeds declared size".into());
            }
            hash.update(&buf[..len]);
            if let Some(o) = output.as_mut() {
                o.write_all(&buf[..len]).map_err(|e| e.to_string())?;
            }
        }
        if n != e.size || format!("{:x}", hash.finalize()) != e.sha256 {
            return Err("Entry integrity check failed".into());
        }
    }
    Ok(manifest)
}
