use crate::model::*;
use serde::{de::DeserializeOwned, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub fn home() -> Result<PathBuf> {
    if let Some(v) = std::env::var_os("CCSYNC_HOME") {
        return Ok(PathBuf::from(v));
    }
    #[cfg(target_os = "windows")]
    let root = std::env::var_os("LOCALAPPDATA").map(PathBuf::from);
    #[cfg(target_os = "macos")]
    let root =
        std::env::var_os("HOME").map(|p| PathBuf::from(p).join("Library/Application Support"));
    #[cfg(target_os = "linux")]
    let root = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".local/state")));
    root.map(|p| p.join("ChromiumCloudSync"))
        .ok_or("User data root unavailable".into())
}
pub fn json<T: DeserializeOwned>(path: &Path) -> Result<T> {
    serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}
pub fn save<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    fs::create_dir_all(path.parent().ok_or("Missing parent")?).map_err(|e| e.to_string())?;
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    use std::io::Write;
    let mut f = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    f.write_all(&serde_json::to_vec(value).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    f.sync_all().map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn file_hash(path: &Path) -> Result<String> {
    use std::io::Read;
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut b = [0; 65536];
    loop {
        let n = f.read(&mut b).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        hash.update(&b[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn relative(value: &str) -> Result<PathBuf> {
    for part in value.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.ends_with([' ', '.'])
            || part
                .chars()
                .any(|c| c.is_control() || "<>\"|?*".contains(c))
            || [
                "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7",
                "COM8", "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8",
                "LPT9",
            ]
            .contains(&stem.as_str())
        {
            return Err("Non-portable relative path".into());
        }
    }
    if value.is_empty() || value.contains('\\') || value.contains(':') || value.contains('\0') {
        return Err("Invalid relative path".into());
    }
    let p = Path::new(value);
    if p.components().any(|c| !matches!(c, Component::Normal(_))) {
        return Err("Unsafe relative path".into());
    }
    Ok(p.to_path_buf())
}
pub fn safe_join(root: &Path, rel: &str) -> Result<PathBuf> {
    let p = relative(rel)?;
    let mut out = root.to_path_buf();
    for ancestor in root.ancestors() {
        reject_link(ancestor)?;
    }
    for part in p.components() {
        out.push(part);
        reject_link(&out)?;
    }
    Ok(out)
}
fn reject_link(path: &Path) -> Result<()> {
    if let Ok(m) = fs::symlink_metadata(path) {
        if m.file_type().is_symlink() {
            return Err("Symbolic links are not permitted".into());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if m.file_attributes() & 0x400 != 0 {
                return Err("Reparse points are not permitted".into());
            }
        }
    }
    Ok(())
}
pub fn job_dir(root: &Path, id: &str) -> Result<PathBuf> {
    if id.is_empty() || !id.bytes().all(|c| c.is_ascii_digit() || c == b'-') {
        return Err("Invalid job id".into());
    }
    Ok(root.join("jobs").join(id))
}
