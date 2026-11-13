mod archive;
mod categories;
mod logical;
mod model;
mod profiles;
mod protocol;
mod store;
mod worker;
use model::Result;
use std::io::{Read, Write};
fn bridge() -> Result<()> {
    let root = store::home()?;
    let args: Vec<String> = std::env::args().collect();
    let origin = args.get(1).ok_or("Native origin required")?;
    let allowed: Vec<String> = store::json(&root.join("allowed-origins.json"))?;
    if !allowed.contains(origin) {
        return Err("Native origin is not authorized".into());
    }
    let mut input = std::io::stdin().lock();
    let mut output = std::io::stdout().lock();
    loop {
        let mut header = [0u8; 4];
        let n = input.read(&mut header).map_err(|e| e.to_string())?;
        if n == 0 {
            return Ok(());
        }
        if n < 4 {
            input
                .read_exact(&mut header[n..])
                .map_err(|e| e.to_string())?;
        }
        let length = u32::from_le_bytes(header) as usize;
        if length == 0 || length > 768 * 1024 {
            return Err("Native message size limit exceeded".into());
        }
        let mut bytes = vec![0; length];
        input.read_exact(&mut bytes).map_err(|e| e.to_string())?;
        let response = match serde_json::from_slice(&bytes) {
            Ok(request) => protocol::envelope(&root, request),
            Err(error) => {
                serde_json::json!({"protocol":1,"requestId":"","ok":false,"error":{"code":"INVALID_JSON","message":error.to_string()}})
            }
        };
        let bytes = serde_json::to_vec(&response).map_err(|e| e.to_string())?;
        if bytes.len() > 900 * 1024 {
            return Err("Native response exceeds limit; reduce selection or task history".into());
        }
        output
            .write_all(&(bytes.len() as u32).to_le_bytes())
            .and_then(|_| output.write_all(&bytes))
            .and_then(|_| output.flush())
            .map_err(|e| e.to_string())?;
    }
}
fn main() {
    let result = if std::env::args().nth(1).as_deref() == Some("--worker") {
        store::home().and_then(|root| worker::run(&root))
    } else {
        bridge()
    };
    if let Err(e) = result {
        eprintln!("ccsync-native: {e}");
        std::process::exit(1);
    }
}
#[cfg(test)]
mod tests;
