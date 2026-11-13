use crate::{model::*, store};
use std::{
    fs,
    path::{Path, PathBuf},
};

pub fn register(root: &Path, path: &Path, browser: &str) -> Result<Profile> {
    if !["chrome", "edge", "chromium"].contains(&browser) {
        return Err("Select a supported Chrome, Edge or Chromium browser family".into());
    }
    let canonical = fs::canonicalize(path).map_err(|e| e.to_string())?;
    if !canonical.join("Preferences").is_file() {
        return Err("Select a browser Profile containing Preferences".into());
    }
    let parent = canonical
        .parent()
        .ok_or("Missing user data directory")?
        .to_path_buf();
    if !parent.join("Local State").is_file() {
        return Err("User data directory must contain Local State".into());
    }
    let directory = canonical
        .file_name()
        .ok_or("Missing Profile name")?
        .to_str()
        .ok_or("Non-Unicode Profile path")?
        .to_string();
    store::relative(&directory)?;
    let profile = Profile {
        id: store::hash(canonical.to_string_lossy().as_bytes())[..24].into(),
        browser: browser.into(),
        name: directory.clone(),
        root: parent,
        directory,
    };
    let mut all = registered(root)?;
    all.retain(|p| p.id != profile.id);
    all.push(profile.clone());
    store::save(&root.join("profiles.json"), &all)?;
    Ok(profile)
}
pub fn registered(root: &Path) -> Result<Vec<Profile>> {
    let file = root.join("profiles.json");
    if !file.exists() {
        return Ok(vec![]);
    }
    store::json(&file)
}
pub fn get(root: &Path, id: &str) -> Result<Profile> {
    let p = registered(root)?
        .into_iter()
        .find(|p| p.id == id)
        .ok_or("Profile not registered")?;
    if fs::canonicalize(p.path()).map_err(|e| e.to_string())? != p.path() {
        return Err("Profile location changed".into());
    }
    Ok(p)
}
pub fn roots() -> Vec<(String, PathBuf)> {
    let mut out = vec![];
    #[cfg(target_os = "windows")]
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        for (b, p) in [
            ("chrome", "Google/Chrome/User Data"),
            ("edge", "Microsoft/Edge/User Data"),
            ("chromium", "Chromium/User Data"),
        ] {
            out.push((b.into(), PathBuf::from(&base).join(p)));
        }
    }
    #[cfg(target_os = "macos")]
    if let Some(base) = std::env::var_os("HOME") {
        for (b, p) in [
            ("chrome", "Google/Chrome"),
            ("edge", "Microsoft Edge"),
            ("chromium", "Chromium"),
        ] {
            out.push((
                b.into(),
                PathBuf::from(&base)
                    .join("Library/Application Support")
                    .join(p),
            ));
        }
    }
    #[cfg(target_os = "linux")]
    {
        let base = std::env::var_os("CHROME_CONFIG_HOME")
            .or_else(|| std::env::var_os("XDG_CONFIG_HOME"))
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")));
        if let Some(base) = base {
            for (b, p) in [
                ("chrome", "google-chrome"),
                ("edge", "microsoft-edge"),
                ("chromium", "chromium"),
            ] {
                out.push((b.into(), base.join(p)));
            }
        }
    }
    out
}
pub fn discover(root: &Path) -> Result<Vec<Profile>> {
    for (browser, base) in roots() {
        if !base.join("Local State").is_file() {
            continue;
        }
        for e in fs::read_dir(base).map_err(|e| e.to_string())? {
            let path = e.map_err(|e| e.to_string())?.path();
            if path.join("Preferences").is_file() {
                register(root, &path, &browser)?;
            }
        }
    }
    registered(root)
}
pub fn version(profile: &Profile) -> String {
    fs::read_to_string(profile.root.join("Last Version"))
        .unwrap_or_default()
        .trim()
        .to_string()
}
