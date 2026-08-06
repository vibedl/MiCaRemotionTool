use std::net::TcpStream;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

use serde::Serialize;

const STUDIO_PORT: u16 = 4300;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StudioStatus {
    pub running: bool,
    pub message: String,
    pub port: u16,
}

pub struct StudioLauncher {
    child: Mutex<Option<Child>>,
}

impl StudioLauncher {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    pub fn ensure_started(&self, resource_dir: Option<PathBuf>) -> StudioStatus {
        if port_open(STUDIO_PORT) {
            return StudioStatus {
                running: true,
                message: format!("Server läuft bereits auf Port {STUDIO_PORT}"),
                port: STUDIO_PORT,
            };
        }

        let node = match resolve_node(resource_dir.as_deref()) {
            Some(p) => p,
            None => {
                return StudioStatus {
                    running: false,
                    message: "Node.js nicht gefunden. Bitte build_node_runtime.sh ausführen oder Node installieren.".into(),
                    port: STUDIO_PORT,
                };
            }
        };

        let app_root = resolve_app_root(resource_dir.as_deref());
        let server_script = app_root.join("server").join("index.mjs");
        if !server_script.exists() {
            return StudioStatus {
                running: false,
                message: format!("Server-Skript fehlt: {}", server_script.display()),
                port: STUDIO_PORT,
            };
        }

        let mut command = Command::new(&node);
        command
            .arg(&server_script)
            .current_dir(&app_root)
            .env("PORT", STUDIO_PORT.to_string())
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());

        match command.spawn() {
            Ok(child) => {
                *self.child.lock().expect("studio child lock") = Some(child);
                for _ in 0..80 {
                    if port_open(STUDIO_PORT) {
                        return StudioStatus {
                            running: true,
                            message: format!("Studio-Server gestartet (Port {STUDIO_PORT})"),
                            port: STUDIO_PORT,
                        };
                    }
                    thread::sleep(Duration::from_millis(250));
                }
                StudioStatus {
                    running: false,
                    message: "Server-Prozess gestartet, aber Port antwortet nicht.".into(),
                    port: STUDIO_PORT,
                }
            }
            Err(err) => StudioStatus {
                running: false,
                message: format!("Server konnte nicht gestartet werden: {err}"),
                port: STUDIO_PORT,
            },
        }
    }

    pub fn shutdown(&self) {
        if let Some(mut child) = self.child.lock().expect("studio child lock").take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn port_open(port: u16) -> bool {
    TcpStream::connect(("127.0.0.1", port)).is_ok()
}

fn resolve_node(resource_dir: Option<&Path>) -> Option<PathBuf> {
    if let Some(dir) = resource_dir {
        #[cfg(windows)]
        {
            let win = dir.join("studio").join("runtime").join("node.exe");
            if win.exists() {
                return Some(win);
            }
        }
        #[cfg(not(windows))]
        {
            let mac = dir.join("studio").join("runtime").join("bin").join("node");
            if mac.exists() {
                return Some(mac);
            }
        }
    }
    which_on_path("node")
}

fn resolve_app_root(resource_dir: Option<&Path>) -> PathBuf {
    if let Some(dir) = resource_dir {
        let bundled = dir.join("studio").join("app");
        if bundled.join("server").join("index.mjs").exists() {
            return bundled;
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn which_on_path(cmd: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(cmd);
        if candidate.is_file() {
            return Some(candidate);
        }
        #[cfg(windows)]
        {
            let with_exe = dir.join(format!("{cmd}.exe"));
            if with_exe.is_file() {
                return Some(with_exe);
            }
        }
    }
    None
}
