use std::fs;
use std::path::PathBuf;
use std::process::Command;

#[tauri::command]
fn ask_victor(message: String) -> Result<String, String> {
    let root = repo_root()?;
    let output = Command::new("node")
        .arg("src/agent_chat.ts")
        .arg(message)
        .current_dir(&root)
        .output()
        .map_err(|error| format!("failed to run Victor agent: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Victor agent failed: {stderr}"));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

#[tauri::command]
fn load_memory() -> Result<String, String> {
    let root = repo_root()?;
    let files = ["machine.md", "preferences.md", "benchmarks.md", "facts.md"];
    let mut sections = Vec::new();

    for file in files {
        let path = root.join("memory").join(file);

        if let Ok(content) = fs::read_to_string(path) {
            sections.push(content.trim().to_string());
        }
    }

    Ok(sections.join("\n\n---\n\n"))
}

#[tauri::command]
fn remember(note: String) -> Result<(), String> {
    let trimmed = note.trim();

    if trimmed.is_empty() {
        return Err("memory note is empty".to_string());
    }

    let root = repo_root()?;
    let path = root.join("memory").join("facts.md");
    fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .and_then(|mut file| {
            use std::io::Write;
            writeln!(file, "\n- {trimmed}")
        })
        .map_err(|error| format!("failed to write memory: {error}"))
}

pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![ask_victor, load_memory, remember])
        .run(tauri::generate_context!())
        .expect("error while running Victor desktop app");
}

fn repo_root() -> Result<PathBuf, String> {
    let current = std::env::current_dir().map_err(|error| error.to_string())?;

    if current.ends_with("src-tauri") {
        return current
            .parent()
            .map(PathBuf::from)
            .ok_or_else(|| "failed to resolve repository root".to_string());
    }

    Ok(current)
}
