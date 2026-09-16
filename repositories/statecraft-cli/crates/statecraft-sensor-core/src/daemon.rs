//! Background watcher management over a pid file (spec 112 B-6): `daemon
//! start` spawns this same binary's `watch` verb detached with its output on
//! the log, argv only, no shell.

use std::fs;
use std::path::Path;
use std::process::{Command, Stdio};

use crate::Layout;

pub fn read_pid(layout: &Layout) -> Option<i32> {
    let text = fs::read_to_string(&layout.daemon_pid).ok()?;
    let pid: i32 = text.trim().parse().ok()?;
    (pid > 0).then_some(pid)
}

pub fn alive(pid: i32) -> bool {
    #[cfg(unix)]
    {
        // SAFETY: signal 0 checks for existence and permission, sends nothing.
        unsafe { libc::kill(pid, 0) == 0 }
    }
    #[cfg(not(unix))]
    {
        let _ = pid;
        false
    }
}

/// Spawn `<exe> watch` detached, stdout and stderr on the log, `NO_COLOR`
/// set, and record its pid. Returns the pid.
pub fn start(layout: &Layout, exe: &Path) -> std::io::Result<u32> {
    fs::create_dir_all(&layout.data_dir)?;
    let log = fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&layout.daemon_log)?;
    let log_err = log.try_clone()?;
    let mut cmd = Command::new(exe);
    cmd.arg("watch")
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::from(log))
        .stderr(Stdio::from(log_err));
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // A new session, so the daemon outlives the shell that started it.
        cmd.process_group(0);
    }
    let child = cmd.spawn()?;
    let pid = child.id();
    fs::write(&layout.daemon_pid, pid.to_string())?;
    Ok(pid)
}

pub fn stop(layout: &Layout, pid: i32) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        // SAFETY: SIGTERM to the pid the pid file names.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
    }
    let _ = fs::remove_file(&layout.daemon_pid);
    Ok(())
}

pub fn remove_pidfile(layout: &Layout) {
    let _ = fs::remove_file(&layout.daemon_pid);
}
