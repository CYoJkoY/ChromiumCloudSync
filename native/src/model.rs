use serde::{Deserialize, Serialize};
use std::path::PathBuf;

pub type Result<T> = std::result::Result<T, String>;
pub const CHUNK: usize = 256 * 1024;
pub const MAX_FILES: usize = 200_000;
pub const MAX_BYTES: u64 = 32 * 1024 * 1024 * 1024;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub browser: String,
    pub name: String,
    pub root: PathBuf,
    pub directory: String,
}
impl Profile {
    pub fn path(&self) -> PathBuf {
        self.root.join(&self.directory)
    }
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub extension_id: String,
    pub category: String,
    pub path: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub format: String,
    pub snapshot_id: String,
    pub browser: String,
    pub browser_version: String,
    pub platform: String,
    pub profile: String,
    pub created_at: u64,
    pub extension_ids: Vec<String>,
    pub categories: Vec<String>,
    pub layout_versions: std::collections::BTreeMap<String, u8>,
    pub extension_versions: std::collections::BTreeMap<String, Vec<String>>,
    pub files: Vec<Entry>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Capability {
    pub extension_id: String,
    pub category: String,
    pub supported: bool,
    pub reason: String,
    pub files: usize,
    pub bytes: u64,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub id: String,
    pub profile_id: String,
    pub extension_ids: Vec<String>,
    pub categories: Vec<String>,
    pub capabilities: Vec<Capability>,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    pub kind: String,
    pub state: String,
    pub plan: Plan,
    pub error: String,
    pub created_at: u64,
    pub size: u64,
    pub sha256: String,
    pub received: u64,
    pub manifest: Option<Manifest>,
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before epoch")
        .as_secs()
}
pub fn id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        now(),
        std::process::id(),
        NEXT.fetch_add(1, Ordering::SeqCst)
    )
}
pub fn valid_id(id: &str) -> bool {
    id.len() == 32 && id.bytes().all(|b| (b'a'..=b'p').contains(&b))
}
pub const CATEGORIES: &[&str] = &[
    "program",
    "local",
    "sync",
    "indexeddb",
    "localStorage",
    "files",
];
