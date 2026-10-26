//! The filesystem the app actually runs on.
//!
//! Every operation here has a counterpart in the development middleware
//! (`apps/desktop/dev/fs-middleware.ts`), because the UI talks to one `FileSystemProvider`
//! interface and must not be able to tell which is underneath. The shapes returned here
//! are the shapes that interface expects.

use std::{
    collections::HashMap,
    fs,
    sync::atomic::{AtomicU64, Ordering},
    path::{Component, Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use regex::RegexBuilder;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use walkdir::WalkDir;

/// Never walked or watched: enormous, and never what someone is writing in.
const IGNORED: [&str; 6] = ["node_modules", ".git", ".vite", ".cache", "dist", "target"];

const FILE_LIMIT: usize = 5_000;

/// Makes each atomic write use its own temp file. Keying the name on the process id
/// alone meant two writes to the same file raced: the first rename moved the shared temp
/// away and the second failed because it was no longer there.
static WRITE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsError {
    message: String,
    /// `stale` when a write was refused because the file changed on disk.
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    stat: Option<FileStat>,
}

impl FsError {
    fn new(message: impl Into<String>) -> Self {
        Self { message: message.into(), code: None, stat: None }
    }

    fn stale(stat: FileStat) -> Self {
        Self {
            message: "File changed on disk since it was opened".into(),
            code: Some("stale".into()),
            stat: Some(stat),
        }
    }
}

impl<E: std::fmt::Display> From<E> for FsError {
    fn from(error: E) -> Self {
        Self::new(error.to_string())
    }
}

type FsResult<T> = Result<T, FsError>;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileStat {
    path: String,
    size: u64,
    mtime_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirEntry {
    name: String,
    path: String,
    /// `file` or `directory`; anything else is left out of the listing.
    kind: String,
    size: u64,
    mtime_ms: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContents {
    path: String,
    text: String,
    stat: FileStat,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContentMatch {
    path: String,
    line: usize,
    column: usize,
    length: usize,
    preview: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResult {
    matches: Vec<ContentMatch>,
    truncated: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WatchEvent {
    event: String,
    path: String,
}

/// The folders the app may touch, and the watcher attached to each.
///
/// This is the runtime equivalent of the dev middleware's root registry: a folder becomes
/// reachable only once the user has named it, and nothing outside one can be read or
/// written however the path is spelled.
#[derive(Default)]
pub struct Roots {
    paths: Mutex<Vec<PathBuf>>,
    watchers: Mutex<HashMap<PathBuf, RecommendedWatcher>>,
    /// Files the user named in a save dialog. Choosing a destination is the permission;
    /// each one is good for a single write and is then forgotten.
    picked: Mutex<Vec<PathBuf>>,
}

pub struct ConfigDir(pub PathBuf);

fn to_millis(time: SystemTime) -> f64 {
    time.duration_since(UNIX_EPOCH).map(|value| value.as_secs_f64() * 1000.0).unwrap_or(0.0)
}

fn stat_of(path: &Path) -> FsResult<FileStat> {
    let meta = fs::metadata(path)?;
    Ok(FileStat {
        path: path.to_string_lossy().into_owned(),
        size: meta.len(),
        mtime_ms: meta.modified().map(to_millis).unwrap_or(0.0),
    })
}

fn is_ignored(path: &Path) -> bool {
    path.components().any(|component| match component {
        Component::Normal(name) => {
            IGNORED.iter().any(|ignored| name.eq_ignore_ascii_case(ignored))
        }
        _ => false,
    })
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md") || extension.eq_ignore_ascii_case("markdown"))
        .unwrap_or(false)
}

/// Resolves a path and refuses anything outside the granted folders.
///
/// The path is normalised without touching the filesystem, so a target that does not
/// exist yet — a file about to be created — still gets checked.
fn require_allowed(roots: &State<Roots>, candidate: &str) -> FsResult<PathBuf> {
    let path = PathBuf::from(candidate);
    if !path.is_absolute() {
        return Err(FsError::new(format!("Path must be absolute: {candidate}")));
    }

    let normalised = normalise(&path);
    let granted = roots.paths.lock().map_err(|_| FsError::new("Root list is poisoned"))?;

    let allowed = granted.iter().any(|root| {
        let root = normalise(root);
        normalised == root || normalised.starts_with(&root)
    });

    if allowed {
        Ok(normalised)
    } else {
        Err(FsError::new(format!(
            "Path is outside the folders this workspace may use: {candidate}"
        )))
    }
}

fn normalise(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalise_resolves_dot_segments_without_touching_disk() {
        assert_eq!(normalise(Path::new(r"C:\a\b\..\c")), PathBuf::from(r"C:\a\c"));
        assert_eq!(normalise(Path::new(r"C:\a\.\b")), PathBuf::from(r"C:\a\b"));
    }

    #[test]
    fn ignored_folders_are_recognised_at_any_depth() {
        assert!(is_ignored(Path::new(r"C:\p\node_modules\x\y.md")));
        assert!(is_ignored(Path::new(r"C:\p\.git\config")));
        assert!(!is_ignored(Path::new(r"C:\p\src\notes.md")));
        // A folder that merely starts with an ignored name is not ignored.
        assert!(!is_ignored(Path::new(r"C:\p\distribution\a.md")));
    }

    #[test]
    fn markdown_is_recognised_by_extension_only() {
        assert!(is_markdown(Path::new("a.md")));
        assert!(is_markdown(Path::new("a.MARKDOWN")));
        assert!(!is_markdown(Path::new("a.mdx")));
        assert!(!is_markdown(Path::new("md")));
    }

    #[test]
    fn asset_names_cannot_escape_their_folder() {
        assert_eq!(safe_asset_name(r"..\..\evil.png"), "evil.png");
        assert_eq!(safe_asset_name("/etc/passwd"), "passwd");
        assert_eq!(safe_asset_name("my photo.png"), "my-photo.png");
        assert_eq!(safe_asset_name(""), "image.png");
        assert_eq!(safe_asset_name("..."), "image.png");
    }
}

#[tauri::command]
pub fn fs_roots(roots: State<Roots>) -> FsResult<Vec<String>> {
    let granted = roots.paths.lock().map_err(|_| FsError::new("Root list is poisoned"))?;
    Ok(granted.iter().map(|path| path.to_string_lossy().into_owned()).collect())
}

#[tauri::command]
pub fn fs_add_root(app: AppHandle, roots: State<Roots>, path: String) -> FsResult<Vec<String>> {
    let target = normalise(&PathBuf::from(&path));
    if !target.is_dir() {
        return Err(FsError::new(format!("Not a folder: {path}")));
    }

    {
        let mut granted = roots.paths.lock().map_err(|_| FsError::new("Root list is poisoned"))?;
        if !granted.contains(&target) {
            granted.push(target.clone());
        }
    }

    watch_root(&app, &roots, &target)?;
    fs_roots(roots)
}

#[tauri::command]
pub fn fs_remove_root(roots: State<Roots>, path: String) -> FsResult<Vec<String>> {
    let target = normalise(&PathBuf::from(&path));

    {
        let mut granted = roots.paths.lock().map_err(|_| FsError::new("Root list is poisoned"))?;
        granted.retain(|root| root != &target);
    }
    if let Ok(mut watchers) = roots.watchers.lock() {
        watchers.remove(&target);
    }
    fs_roots(roots)
}

/// One watcher per root, forwarding to the window as `fs-event`.
fn watch_root(app: &AppHandle, roots: &State<Roots>, root: &Path) -> FsResult<()> {
    let mut watchers = roots.watchers.lock().map_err(|_| FsError::new("Watcher list is poisoned"))?;
    if watchers.contains_key(root) {
        return Ok(());
    }

    let handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        let Ok(event) = result else { return };

        for path in event.paths {
            if is_ignored(&path) {
                continue;
            }
            let kind = match event.kind {
                notify::EventKind::Create(_) => {
                    if path.is_dir() { "addDir" } else { "add" }
                }
                notify::EventKind::Remove(_) => {
                    if path.is_dir() { "unlinkDir" } else { "unlink" }
                }
                notify::EventKind::Modify(_) => "change",
                _ => continue,
            };

            let _ = handle.emit(
                "fs-event",
                WatchEvent { event: kind.into(), path: path.to_string_lossy().into_owned() },
            );
        }
    })?;

    watcher.watch(root, RecursiveMode::Recursive)?;
    watchers.insert(root.to_path_buf(), watcher);
    Ok(())
}

#[tauri::command]
pub fn fs_list_dir(roots: State<Roots>, path: String) -> FsResult<Vec<DirEntry>> {
    let dir = require_allowed(&roots, &path)?;
    let mut entries = Vec::new();

    for entry in fs::read_dir(&dir)? {
        let Ok(entry) = entry else { continue };
        // A file can vanish between the listing and the stat; skip it rather than fail.
        let Ok(meta) = entry.metadata() else { continue };

        let kind = if meta.is_dir() {
            "directory"
        } else if meta.is_file() {
            "file"
        } else {
            continue;
        };

        entries.push(DirEntry {
            name: entry.file_name().to_string_lossy().into_owned(),
            path: entry.path().to_string_lossy().into_owned(),
            kind: kind.into(),
            size: meta.len(),
            mtime_ms: meta.modified().map(to_millis).unwrap_or(0.0),
        });
    }

    entries.sort_by(|a, b| {
        (a.kind != "directory")
            .cmp(&(b.kind != "directory"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });
    Ok(entries)
}

#[tauri::command]
pub fn fs_read_file(roots: State<Roots>, path: String) -> FsResult<FileContents> {
    let file = require_allowed(&roots, &path)?;
    let text = fs::read_to_string(&file)?;
    let stat = stat_of(&file)?;
    Ok(FileContents { path: file.to_string_lossy().into_owned(), text, stat })
}

#[tauri::command]
pub fn fs_stat(roots: State<Roots>, path: String) -> FsResult<FileStat> {
    stat_of(&require_allowed(&roots, &path)?)
}

#[tauri::command]
pub fn fs_write_file(
    roots: State<Roots>,
    path: String,
    text: String,
    expected_mtime_ms: Option<f64>,
) -> FsResult<FileStat> {
    let file = require_allowed(&roots, &path)?;

    if let Some(expected) = expected_mtime_ms {
        if let Ok(current) = stat_of(&file) {
            // mtime carries sub-millisecond noise across a JSON round trip.
            if (current.mtime_ms - expected).abs() > 1.0 {
                return Err(FsError::stale(current));
            }
        }
    }

    write_atomically(&file, text.as_bytes())?;
    stat_of(&file)
}

/// Write to a sibling temp file and rename, so a crash mid-write cannot truncate a
/// document. On Windows, rename replaces an existing destination.
fn write_atomically(file: &Path, bytes: &[u8]) -> FsResult<()> {
    let parent = file.parent().ok_or_else(|| FsError::new("File has no parent folder"))?;
    fs::create_dir_all(parent)?;

    let name = file.file_name().and_then(|name| name.to_str()).unwrap_or("file");
    let ticket = WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp = parent.join(format!(".{name}.{}.{ticket}.tmp", std::process::id()));

    if let Err(error) = fs::write(&temp, bytes) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    if let Err(error) = fs::rename(&temp, file) {
        let _ = fs::remove_file(&temp);
        return Err(error.into());
    }
    Ok(())
}

#[tauri::command]
pub fn fs_write_asset(
    roots: State<Roots>,
    dir: String,
    name: String,
    data: Vec<u8>,
) -> FsResult<FileStat> {
    let folder = require_allowed(&roots, &dir)?;
    if data.is_empty() {
        return Err(FsError::new("Asset body was empty"));
    }

    fs::create_dir_all(&folder)?;
    let target = first_free_name(&folder, &safe_asset_name(&name));
    fs::write(&target, data)?;
    stat_of(&target)
}

fn safe_asset_name(raw: &str) -> String {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' { c } else { '-' })
        .collect();

    let trimmed = cleaned.trim_start_matches(['-', '.']).chars().take(120).collect::<String>();
    if trimmed.is_empty() { "image.png".into() } else { trimmed }
}

/// Two screenshots pasted in a row must not overwrite one another.
fn first_free_name(dir: &Path, name: &str) -> PathBuf {
    let (stem, extension) = match name.rfind('.') {
        Some(at) if at > 0 => (&name[..at], &name[at..]),
        _ => (name, ""),
    };

    for attempt in 0..1000 {
        let candidate = if attempt == 0 {
            dir.join(name)
        } else {
            dir.join(format!("{stem}-{attempt}{extension}"))
        };
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(name)
}

#[tauri::command]
pub fn fs_write_binary(roots: State<Roots>, path: String, data: Vec<u8>) -> FsResult<FileStat> {
    let file = require_allowed_or_picked(&roots, &path)?;
    write_atomically(&file, &data)?;
    stat_of(&file)
}

/// An export may legitimately land outside every workspace folder, because the user said
/// so in a save dialog. Nothing else accepts a picked path.
fn require_allowed_or_picked(roots: &State<Roots>, candidate: &str) -> FsResult<PathBuf> {
    if let Ok(path) = require_allowed(roots, candidate) {
        return Ok(path);
    }

    let normalised = normalise(&PathBuf::from(candidate));
    let mut picked = roots.picked.lock().map_err(|_| FsError::new("Picked list is poisoned"))?;

    match picked.iter().position(|path| path == &normalised) {
        Some(index) => {
            picked.remove(index);
            Ok(normalised)
        }
        None => Err(FsError::new(format!(
            "Path is outside the folders this workspace may use: {candidate}"
        ))),
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitResult {
    stdout: String,
    stderr: String,
    code: i32,
}

/// Arguments that would move git somewhere else, defeating the folder check.
const GIT_ESCAPES: [&str; 4] = ["-C", "--git-dir", "--work-tree", "--exec-path"];

/// Runs git inside a granted folder.
///
/// The working directory is checked like any other path, and arguments that would point
/// git at a different tree are refused — otherwise `git -C ..` would walk straight out of
/// the workspace.
#[tauri::command]
pub fn git_run(roots: State<Roots>, cwd: String, args: Vec<String>) -> FsResult<GitResult> {
    let folder = require_allowed(&roots, &cwd)?;
    if !folder.is_dir() {
        return Err(FsError::new(format!("Not a folder: {cwd}")));
    }

    for arg in &args {
        if GIT_ESCAPES.iter().any(|escape| arg == escape || arg.starts_with(&format!("{escape}="))) {
            return Err(FsError::new(format!("Refusing git argument: {arg}")));
        }
    }

    let mut command = std::process::Command::new("git");
    command.current_dir(&folder).args(&args);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // CREATE_NO_WINDOW: a console flashing up on every status call would be absurd.
        command.creation_flags(0x0800_0000);
    }

    let output = command
        .output()
        .map_err(|error| FsError::new(format!("Could not run git: {error}")))?;

    Ok(GitResult {
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
        code: output.status.code().unwrap_or(-1),
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveOptions {
    default_name: String,
    filter_name: String,
    extensions: Vec<String>,
}

#[tauri::command]
pub async fn save_dialog(app: AppHandle, options: SaveOptions) -> FsResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let extensions: Vec<&str> = options.extensions.iter().map(String::as_str).collect();
    let (sender, receiver) = std::sync::mpsc::channel();

    app.dialog()
        .file()
        .set_file_name(&options.default_name)
        .add_filter(&options.filter_name, &extensions)
        .save_file(move |picked| {
            let _ = sender.send(picked);
        });

    let chosen = receiver.recv().map_err(|error| FsError::new(error.to_string()))?;
    let Some(path) = chosen.and_then(|path| path.into_path().ok()) else {
        return Ok(None);
    };

    let normalised = normalise(&path);
    if let Ok(mut picked) = app.state::<Roots>().picked.lock() {
        picked.push(normalised.clone());
    }
    Ok(Some(normalised.to_string_lossy().into_owned()))
}

#[tauri::command]
pub fn fs_create(
    roots: State<Roots>,
    path: String,
    kind: String,
    text: Option<String>,
) -> FsResult<FileStat> {
    let target = require_allowed(&roots, &path)?;
    if target.exists() {
        return Err(FsError::new(format!("Already exists: {path}")));
    }

    if kind == "directory" {
        fs::create_dir_all(&target)?;
    } else {
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(&target, text.unwrap_or_default())?;
    }
    stat_of(&target)
}

#[tauri::command]
pub fn fs_rename(roots: State<Roots>, from: String, to: String) -> FsResult<FileStat> {
    let source = require_allowed(&roots, &from)?;
    let destination = require_allowed(&roots, &to)?;

    if source == destination {
        return stat_of(&source);
    }
    if destination.exists() {
        return Err(FsError::new(format!("Already exists: {to}")));
    }

    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::rename(&source, &destination)?;
    stat_of(&destination)
}

#[tauri::command]
pub fn fs_trash(roots: State<Roots>, path: String) -> FsResult<()> {
    let target = require_allowed(&roots, &path)?;
    // Deliberately never a plain delete: removing from the explorer must be recoverable.
    trash::delete(&target).map_err(|error| FsError::new(error.to_string()))
}

#[tauri::command]
pub fn fs_find_files(roots: State<Roots>, limit: Option<usize>) -> FsResult<Vec<String>> {
    let granted = {
        let paths = roots.paths.lock().map_err(|_| FsError::new("Root list is poisoned"))?;
        paths.clone()
    };

    let cap = limit.unwrap_or(2_000);
    let mut files = Vec::new();

    for root in granted {
        for entry in WalkDir::new(&root).into_iter().filter_entry(|e| !is_ignored(e.path())) {
            if files.len() >= cap {
                break;
            }
            let Ok(entry) = entry else { continue };
            if entry.file_type().is_file() && is_markdown(entry.path()) {
                files.push(entry.path().to_string_lossy().into_owned());
            }
        }
    }
    Ok(files)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOptions {
    query: String,
    regex: bool,
    case_sensitive: bool,
    limit: Option<usize>,
}

#[tauri::command]
pub fn fs_search_content(
    roots: State<Roots>,
    options: SearchOptions,
) -> FsResult<ContentSearchResult> {
    if options.query.is_empty() {
        return Ok(ContentSearchResult { matches: Vec::new(), truncated: false });
    }

    let source = if options.regex { options.query.clone() } else { regex::escape(&options.query) };
    let pattern = RegexBuilder::new(&source)
        .case_insensitive(!options.case_sensitive)
        .build()
        .map_err(|error| FsError::new(error.to_string()))?;

    let cap = options.limit.unwrap_or(500);
    let mut matches = Vec::new();

    for file in fs_find_files(roots, Some(FILE_LIMIT))? {
        if matches.len() >= cap {
            break;
        }
        let Ok(text) = fs::read_to_string(&file) else { continue };

        for (index, line) in text.lines().enumerate() {
            for found in pattern.find_iter(line) {
                if found.as_str().is_empty() {
                    continue;
                }
                matches.push(ContentMatch {
                    path: file.clone(),
                    line: index + 1,
                    // Columns are 1-based character offsets, as the UI expects.
                    column: line[..found.start()].chars().count() + 1,
                    length: found.as_str().chars().count(),
                    preview: if line.chars().count() > 400 {
                        format!("{}…", line.chars().take(400).collect::<String>())
                    } else {
                        line.to_string()
                    },
                });
                if matches.len() >= cap {
                    break;
                }
            }
            if matches.len() >= cap {
                break;
            }
        }
    }

    let truncated = matches.len() >= cap;
    Ok(ContentSearchResult { matches, truncated })
}

/// Config names are file names, never paths: no separators, no traversal.
fn config_path(dir: &ConfigDir, name: &str) -> FsResult<PathBuf> {
    let valid = !name.is_empty()
        && !name.contains("..")
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-');

    if !valid {
        return Err(FsError::new(format!("Not a valid config name: {name}")));
    }
    Ok(dir.0.join(name))
}

#[tauri::command]
pub fn config_read(dir: State<ConfigDir>, name: String) -> FsResult<Option<String>> {
    let file = config_path(&dir, &name)?;
    // Editors and shells like to add a BOM. JSON parsing does not tolerate one, so strip
    // it here rather than let three stray bytes look like a corrupt workspace.
    Ok(fs::read_to_string(file).ok().map(|text| text.trim_start_matches('\u{feff}').to_string()))
}

#[tauri::command]
pub fn config_write(dir: State<ConfigDir>, name: String, text: String) -> FsResult<()> {
    let file = config_path(&dir, &name)?;
    fs::create_dir_all(&dir.0)?;
    // Same atomic write as documents: a crash must not leave half a workspace.
    write_atomically(&file, text.as_bytes())
}

#[tauri::command]
pub fn config_delete(dir: State<ConfigDir>, name: String) -> FsResult<()> {
    let file = config_path(&dir, &name)?;
    let _ = fs::remove_file(file);
    Ok(())
}

#[tauri::command]
pub fn config_list(dir: State<ConfigDir>, prefix: String) -> FsResult<Vec<String>> {
    let Ok(entries) = fs::read_dir(&dir.0) else { return Ok(Vec::new()) };

    Ok(entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.file_name().to_string_lossy().into_owned())
        .filter(|name| name.starts_with(&prefix))
        .collect())
}

/// Reads a file the user picked outside the granted folders is not possible, so the
/// picker is the only way a new folder enters the workspace.
#[tauri::command]
pub async fn pick_folder(app: AppHandle) -> FsResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let (sender, receiver) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = sender.send(picked);
    });

    let picked = receiver.recv().map_err(|error| FsError::new(error.to_string()))?;
    Ok(picked.and_then(|path| path.into_path().ok()).map(|path| path.to_string_lossy().into_owned()))
}

