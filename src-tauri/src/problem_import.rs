//! Opt-in, loopback-only bridge for the bundled Codeforces / Luogu userscript.
use crate::{
    database,
    error::{AppError, AppResult},
};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    fs::{self, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tiny_http::{Header, Method, Request, Response, Server};
use url::Url;

pub const PORT: u16 = 27121;
const MAX_BODY: usize = 2 * 1024 * 1024;
const CLIENT: &str = "lightcp-userscript-v1";
const USERSCRIPT: &str = include_str!("../../scripts/lightcp-codeforces.user.js");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListenerStatus {
    pub listening: bool,
    pub port: u16,
    pub workspace_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProblemPayload {
    pub title: String,
    pub url: String,
    pub markdown: String,
    #[serde(default)]
    pub samples: Vec<Sample>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sample {
    pub input: String,
    pub expected_output: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportedProblem {
    pub title: String,
    pub source_path: String,
    pub markdown_path: String,
    pub source_url: String,
    pub sample_count: usize,
    pub already_imported: bool,
}

struct RunningListener {
    root: PathBuf,
    server: Arc<Server>,
    stopped: Arc<AtomicBool>,
    import_lock: Arc<Mutex<()>>,
    thread: thread::JoinHandle<()>,
}

#[derive(Default)]
pub struct ProblemListener {
    running: Mutex<Option<RunningListener>>,
}

impl ProblemListener {
    pub fn status(&self) -> AppResult<ListenerStatus> {
        let running = self.running.lock().map_err(lock_error)?;
        Ok(ListenerStatus {
            listening: running.is_some(),
            port: PORT,
            workspace_path: running
                .as_ref()
                .map(|r| r.root.to_string_lossy().into_owned()),
        })
    }

    pub fn start(
        &self,
        root: PathBuf,
        database: PathBuf,
        template: String,
        notify: impl Fn(ImportedProblem) + Send + Sync + 'static,
    ) -> AppResult<ListenerStatus> {
        let mut running = self.running.lock().map_err(lock_error)?;
        if running.is_some() {
            return Err(import_error("题目监听已经开启，请先停止监听再更换模板。"));
        }
        let root = dunce::canonicalize(root)?;
        let server =
            Arc::new(Server::http(("127.0.0.1", PORT)).map_err(|error| {
                import_error(format!("无法开启题目监听（端口 {PORT}）：{error}"))
            })?);
        let stopped = Arc::new(AtomicBool::new(false));
        let thread_server = server.clone();
        let thread_stopped = stopped.clone();
        let thread_root = root.clone();
        let import_lock = Arc::new(Mutex::new(()));
        let thread_lock = import_lock.clone();
        let active = Arc::new(AtomicUsize::new(0));
        let notify = Arc::new(notify);
        let token = uuid::Uuid::new_v4().to_string();
        let handle = thread::Builder::new()
            .name("problem-listener".into())
            .spawn(move || {
                while !thread_stopped.load(Ordering::Acquire) {
                    match thread_server.recv_timeout(Duration::from_millis(200)) {
                        Ok(Some(request)) => {
                            if thread_stopped.load(Ordering::Acquire) {
                                break;
                            }
                            if active.load(Ordering::Acquire) >= 8 {
                                reply(
                                    request,
                                    503,
                                    json!({"error":"监听请求过多，请稍后重试。"}).to_string(),
                                    "application/json",
                                );
                                continue;
                            }
                            active.fetch_add(1, Ordering::AcqRel);
                            let count = active.clone();
                            let root = thread_root.clone();
                            let db = database.clone();
                            let template = template.clone();
                            let token = token.clone();
                            let stopped = thread_stopped.clone();
                            let gate = thread_lock.clone();
                            let notify = notify.clone();
                            thread::spawn(move || {
                                handle_request(
                                    request,
                                    ImportRequestContext {
                                        root: &root,
                                        db: &db,
                                        template: &template,
                                        token: &token,
                                        notify: &*notify,
                                        stopped: &stopped,
                                        gate: &gate,
                                    },
                                );
                                count.fetch_sub(1, Ordering::AcqRel);
                            });
                        }
                        Ok(None) => {}
                        Err(error) => {
                            log::warn!("Problem listener receive failed: {error}");
                            break;
                        }
                    }
                }
            })?;
        *running = Some(RunningListener {
            root: root.clone(),
            server,
            stopped,
            import_lock,
            thread: handle,
        });
        Ok(ListenerStatus {
            listening: true,
            port: PORT,
            workspace_path: Some(root.to_string_lossy().into_owned()),
        })
    }

    pub fn stop(&self) -> AppResult<()> {
        let mut running = self.running.lock().map_err(lock_error)?;
        if let Some(listener) = running.take() {
            listener.stopped.store(true, Ordering::Release);
            listener.server.unblock();
            // Wait only for a committed import, never for an unfinished HTTP body.
            let _guard = listener.import_lock.lock().map_err(lock_error)?;
            let _ = listener.thread.join();
        }
        Ok(())
    }
}

impl Drop for ProblemListener {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn lock_error<T>(_: std::sync::PoisonError<T>) -> AppError {
    import_error("题目监听状态不可用，请重启 LightCP。")
}
fn import_error(message: impl Into<String>) -> AppError {
    AppError::Server(message.into())
}

fn header<'a>(request: &'a Request, name: &'static str) -> Option<&'a str> {
    request
        .headers()
        .iter()
        .find(|h| h.field.equiv(name))
        .map(|h| h.value.as_str())
}

fn trusted_request(request: &Request) -> bool {
    let host = header(request, "Host");
    if host != Some("127.0.0.1:27121") && host != Some("localhost:27121") {
        return false;
    }
    if let Some(origin) = header(request, "Origin") {
        let Ok(url) = Url::parse(origin) else {
            return false;
        };
        if url.scheme() != "https"
            || !is_problem_host(url.host_str().unwrap_or(""))
            || !url.username().is_empty()
            || url.password().is_some()
            || url.port().is_some()
        {
            return false;
        }
    }
    true
}

fn reply(request: Request, status: u16, body: String, content_type: &str) {
    let response = Response::from_string(body)
        .with_status_code(status)
        .with_header(Header::from_bytes("Content-Type", content_type).unwrap())
        .with_header(Header::from_bytes("Cache-Control", "no-store").unwrap())
        .with_header(Header::from_bytes("X-Content-Type-Options", "nosniff").unwrap());
    if let Err(error) = request.respond(response) {
        log::debug!("Problem listener response failed: {error}");
    }
}

struct ImportRequestContext<'a> {
    root: &'a Path,
    db: &'a Path,
    template: &'a str,
    token: &'a str,
    notify: &'a dyn Fn(ImportedProblem),
    stopped: &'a AtomicBool,
    gate: &'a Mutex<()>,
}

fn handle_request(mut request: Request, context: ImportRequestContext<'_>) {
    let ImportRequestContext {
        root,
        db,
        template,
        token,
        notify,
        stopped,
        gate,
    } = context;
    if !trusted_request(&request) {
        reply(
            request,
            403,
            json!({"error":"请求来源不受支持。"}).to_string(),
            "application/json",
        );
        return;
    }
    if request.method() == &Method::Get && request.url() == "/lightcp-codeforces.user.js" {
        reply(
            request,
            200,
            USERSCRIPT.into(),
            "application/javascript; charset=utf-8",
        );
        return;
    }
    // No CORS headers are exposed. Only extension requests carrying this header
    // can obtain the per-listening-session token; regular pages fail preflight.
    if header(&request, "X-LightCP-Client") != Some(CLIENT) {
        reply(
            request,
            403,
            json!({"error":"请使用 LightCP 油猴脚本发送题目。"}).to_string(),
            "application/json",
        );
        return;
    }
    if request.method() == &Method::Get && request.url() == "/session" {
        reply(
            request,
            200,
            json!({"token":token}).to_string(),
            "application/json",
        );
        return;
    }
    if request.method() != &Method::Post || request.url() != "/problem" {
        reply(
            request,
            404,
            json!({"error":"接口不存在。"}).to_string(),
            "application/json",
        );
        return;
    }
    if header(&request, "X-LightCP-Token") != Some(token) {
        reply(
            request,
            403,
            json!({"error":"监听会话已更换，请重新发送题目。"}).to_string(),
            "application/json",
        );
        return;
    }
    if request.body_length().is_none() || request.body_length().unwrap_or(0) > MAX_BODY {
        reply(
            request,
            413,
            json!({"error":"题面数据超过 2 MB 或缺少长度。"}).to_string(),
            "application/json",
        );
        return;
    }
    let mut body = Vec::new();
    if request
        .as_reader()
        .take((MAX_BODY + 1) as u64)
        .read_to_end(&mut body)
        .is_err()
        || body.len() > MAX_BODY
    {
        reply(
            request,
            400,
            json!({"error":"无法读取题面数据。"}).to_string(),
            "application/json",
        );
        return;
    }
    let Ok(_guard) = gate.lock() else {
        reply(
            request,
            503,
            json!({"error":"监听状态不可用，请重新开启监听。"}).to_string(),
            "application/json",
        );
        return;
    };
    if stopped.load(Ordering::Acquire) {
        reply(
            request,
            409,
            json!({"error":"监听已停止，请重新开启监听再发送。"}).to_string(),
            "application/json",
        );
        return;
    }
    let result = serde_json::from_slice::<ProblemPayload>(&body)
        .map_err(|e| import_error(format!("题面数据格式错误：{e}")))
        .and_then(|payload| import_problem(root, db, template, payload));
    match result {
        Ok(imported) => {
            notify(imported.clone());
            reply(
                request,
                200,
                serde_json::to_string(&imported).unwrap(),
                "application/json; charset=utf-8",
            );
        }
        Err(error) => {
            log::warn!("Problem import failed: {error}");
            reply(
                request,
                400,
                json!({"error":error.to_string()}).to_string(),
                "application/json; charset=utf-8",
            );
        }
    }
}

fn is_codeforces_host(host: &str) -> bool {
    host == "codeforces.com" || host.ends_with(".codeforces.com")
}

fn is_luogu_host(host: &str) -> bool {
    matches!(host, "www.luogu.com.cn" | "luogu.com.cn")
}

fn is_problem_host(host: &str) -> bool {
    is_codeforces_host(host) || is_luogu_host(host)
}

fn canonical_problem_url(raw: &str) -> AppResult<String> {
    let url = Url::parse(raw).map_err(|_| import_error("题目链接无效。"))?;
    if url.scheme() != "https"
        || !is_problem_host(url.host_str().unwrap_or(""))
        || !url.username().is_empty()
        || url.password().is_some()
        || url.port().is_some()
    {
        return Err(import_error(
            "目前仅支持 Codeforces 和洛谷的 HTTPS 题目链接。",
        ));
    }
    let parts: Vec<_> = url.path().trim_matches('/').split('/').collect();
    if is_luogu_host(url.host_str().unwrap_or("")) {
        let ["problem", pid] = parts.as_slice() else {
            return Err(import_error("请在单道洛谷题目页面发送。"));
        };
        if pid.is_empty()
            || pid.len() > 80
            || !pid.as_bytes()[0].is_ascii_alphabetic()
            || !pid.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            return Err(import_error("洛谷题目编号无效。"));
        }
        // AtCoder IDs contain a case-sensitive lower-case task name.
        let pid = if pid.to_ascii_uppercase().starts_with("AT_") {
            format!("AT_{}", &pid[3..])
        } else {
            pid.to_ascii_uppercase()
        };
        return Ok(format!("https://www.luogu.com.cn/problem/{pid}"));
    }
    let (contest, index) = match parts.as_slice() {
        ["problemset", "problem", contest, index] => (*contest, *index),
        ["contest" | "gym", contest, "problem", index] => (*contest, *index),
        _ => return Err(import_error("请在单道 Codeforces 题目页面发送。")),
    };
    if contest.is_empty()
        || !contest.chars().all(|c| c.is_ascii_digit())
        || index.is_empty()
        || !index.chars().all(|c| c.is_ascii_alphanumeric())
        || index.len() > 8
    {
        return Err(import_error("题目编号无效。"));
    }
    let prefix = if parts[0] == "gym" { "gym" } else { "contest" };
    Ok(format!(
        "https://codeforces.com/{prefix}/{contest}/problem/{}",
        index.to_ascii_uppercase()
    ))
}

fn safe_stem(title: &str) -> String {
    let value: String = title
        .chars()
        .take(120)
        .map(|c| {
            if c.is_control() || "<>:\"/\\|?*".contains(c) {
                '_'
            } else {
                c
            }
        })
        .collect();
    let value = value.trim().trim_end_matches(['.', ' ']);
    if value.is_empty() {
        return "Problem".into();
    }
    let base = value.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ["COM", "LPT"].iter().any(|prefix| {
            base.strip_prefix(prefix).is_some_and(|s| {
                matches!(
                    s,
                    "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
                )
            })
        })
    {
        format!("_{value}")
    } else {
        value.into()
    }
}

fn existing_import(
    root: &Path,
    db: &Path,
    url: &str,
    title: &str,
) -> AppResult<Option<ImportedProblem>> {
    let connection = database::connect(db)?;
    let mut query = connection.prepare("SELECT source_path FROM notebook_records WHERE kind='problem' AND json_extract(content,'$.sourceUrl')=?1")?;
    let keys = query.query_map([url], |r| r.get::<_, String>(0))?;
    for key in keys {
        let key = key?;
        #[cfg(not(windows))]
        let key = key.replace('\\', "/");
        if let Ok(path) = dunce::canonicalize(&key) {
            if path.starts_with(root) && path.is_file() {
                let count: i64 = connection.query_row(
                    "SELECT COUNT(*) FROM testcases WHERE source_path=?1",
                    [path.to_string_lossy().as_ref()],
                    |r| r.get(0),
                )?;
                return Ok(Some(ImportedProblem {
                    title: title.into(),
                    source_path: path.to_string_lossy().into_owned(),
                    markdown_path: path.with_extension("md").to_string_lossy().into_owned(),
                    source_url: url.into(),
                    sample_count: count as usize,
                    already_imported: true,
                }));
            }
        }
    }
    Ok(None)
}

fn import_problem(
    root: &Path,
    db: &Path,
    template: &str,
    payload: ProblemPayload,
) -> AppResult<ImportedProblem> {
    let url = canonical_problem_url(&payload.url)?;
    if payload.title.trim().is_empty()
        || payload.title.len() > 2000
        || payload.markdown.trim().is_empty()
        || payload.markdown.len() > MAX_BODY
        || payload.samples.len() > 100
    {
        return Err(import_error("题目名称、题面或样例数据无效。"));
    }
    if dunce::canonicalize(root)? != root {
        return Err(import_error("工作区目录已经更换，请重新开启监听。"));
    }
    if let Some(existing) = existing_import(root, db, &url, &payload.title)? {
        return Ok(existing);
    }
    let stem = safe_stem(&payload.title);
    let mut paths = None;
    let history = database::connect(db)?;
    for suffix in 0..1000 {
        let name = if suffix == 0 {
            stem.clone()
        } else {
            format!("{stem} ({suffix})")
        };
        let cpp = root.join(format!("{name}.cpp"));
        let md = root.join(format!("{name}.md"));
        // A removed source may still have a dirty editor or saved annotations.
        // Keep that identity intact rather than reusing its notebook key.
        let key = cpp.to_string_lossy().replace('/', "\\").to_lowercase();
        let recorded: bool = history.query_row(
            "SELECT EXISTS(SELECT 1 FROM notebook_records WHERE source_path=?1)",
            [key],
            |row| row.get(0),
        )?;
        if recorded {
            continue;
        }
        let mut source = match OpenOptions::new().write(true).create_new(true).open(&cpp) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.into()),
        };
        let mut statement = match OpenOptions::new().write(true).create_new(true).open(&md) {
            Ok(file) => file,
            Err(e) => {
                drop(source);
                let _ = fs::remove_file(&cpp);
                if e.kind() == std::io::ErrorKind::AlreadyExists {
                    continue;
                }
                return Err(e.into());
            }
        };
        let written = source
            .write_all(template.as_bytes())
            .and_then(|_| statement.write_all(payload.markdown.as_bytes()));
        drop(source);
        drop(statement);
        if let Err(error) = written {
            let _ = fs::remove_file(&cpp);
            let _ = fs::remove_file(&md);
            return Err(error.into());
        }
        paths = Some((cpp, md));
        break;
    }
    let (cpp, md) = paths.ok_or_else(|| import_error("同名文件过多，请调整题目名称后重试。"))?;
    let source_path = cpp.to_string_lossy().into_owned();
    let persisted = (|| -> AppResult<()> {
        let mut connection = database::connect(db)?;
        let transaction = connection.transaction()?;
        let key = source_path.replace('/', "\\").to_lowercase();
        let content = json!({"kind":"markdown", "title":payload.title, "markdown":payload.markdown,
            "sourceUrl":url, "updatedAt":SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64}).to_string();
        transaction.execute(
            "INSERT INTO notebook_records(kind,source_path,content) VALUES ('problem',?1,?2)",
            params![key, content],
        )?;
        for (i, sample) in payload.samples.iter().enumerate() {
            transaction.execute("INSERT INTO testcases(source_path,kind,name,input,expected_output,enabled,sort_order) VALUES (?1,'sample',?2,?3,?4,1,?5)",
                params![source_path, format!("样例 {}", i + 1), sample.input, sample.expected_output, i as i64])?;
        }
        transaction.commit()?;
        Ok(())
    })();
    if let Err(error) = persisted {
        let _ = fs::remove_file(&cpp);
        let _ = fs::remove_file(&md);
        return Err(error);
    }
    if let Err(error) = crate::archive::register_path(db, root, &source_path) {
        log::warn!("Imported problem archive registration failed: {error}");
    }
    Ok(ImportedProblem {
        title: payload.title,
        source_path,
        markdown_path: md.to_string_lossy().into_owned(),
        source_url: url,
        sample_count: payload.samples.len(),
        already_imported: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpStream;

    struct Fixture {
        dir: PathBuf,
        root: PathBuf,
        db: PathBuf,
    }
    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("lightcp-import-test-{}", uuid::Uuid::new_v4()));
            let root = dir.join("workspace");
            fs::create_dir_all(&root).unwrap();
            let root = dunce::canonicalize(root).unwrap();
            let db = dir.join("test.db");
            database::initialize(&db).unwrap();
            Self { dir, root, db }
        }
        fn import(&self, payload: ProblemPayload) -> AppResult<ImportedProblem> {
            import_problem(
                &self.root,
                &self.db,
                "// contest template\nint main() {}\n",
                payload,
            )
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }
    fn payload() -> ProblemPayload {
        ProblemPayload {
            title: "A. Example".into(),
            url: "https://codeforces.com/problemset/problem/1234/A?locale=en".into(),
            markdown: "# A. Example\n\n$$n^2$$\n".into(),
            samples: vec![Sample {
                input: "1\n  2\n".into(),
                expected_output: "YES\n".into(),
            }],
        }
    }

    #[test]
    fn imports_template_statement_and_samples_and_reopens_persisted_problem_without_overwriting() {
        let f = Fixture::new();
        let saved = f.import(payload()).unwrap();
        assert_eq!(
            Path::new(&saved.source_path).file_name().unwrap(),
            "A. Example.cpp"
        );
        assert_eq!(
            fs::read_to_string(&saved.source_path).unwrap(),
            "// contest template\nint main() {}\n"
        );
        assert_eq!(
            fs::read_to_string(&saved.markdown_path).unwrap(),
            payload().markdown
        );
        let key = saved.source_path.replace('/', "\\").to_lowercase();
        let document: serde_json::Value = serde_json::from_str(
            &crate::notebooks::read(&f.db, "problem", &key)
                .unwrap()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(
            document["sourceUrl"],
            "https://codeforces.com/contest/1234/problem/A"
        );
        assert_eq!(document["kind"], "markdown");
        let cases = crate::testcase::list(&f.db, &f.root, &saved.source_path).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].input, "1\n  2\n");
        fs::write(&saved.source_path, "// my solution").unwrap();
        let mut repeated = payload();
        repeated.url = "https://mirror.codeforces.com/contest/1234/problem/a".into();
        repeated.markdown = "# changed statement".into();
        let reopened = f.import(repeated).unwrap();
        assert!(reopened.already_imported);
        assert_eq!(saved.source_path, reopened.source_path);
        assert_eq!(
            fs::read_to_string(saved.source_path).unwrap(),
            "// my solution"
        );
        assert_eq!(
            fs::read_to_string(saved.markdown_path).unwrap(),
            payload().markdown
        );
        assert_eq!(
            crate::testcase::list(&f.db, &f.root, &reopened.source_path)
                .unwrap()
                .len(),
            1
        );
    }

    #[test]
    fn handles_name_collisions_with_both_source_and_markdown_without_overwriting() {
        let f = Fixture::new();
        fs::write(f.root.join("A. Example.cpp"), "existing source").unwrap();
        fs::write(f.root.join("A. Example (1).md"), "existing statement").unwrap();
        let saved = f.import(payload()).unwrap();
        assert!(saved.source_path.ends_with("A. Example (2).cpp"));
        assert_eq!(
            fs::read_to_string(f.root.join("A. Example.cpp")).unwrap(),
            "existing source"
        );
        assert_eq!(
            fs::read_to_string(f.root.join("A. Example (1).md")).unwrap(),
            "existing statement"
        );
        assert!(!f.root.join("A. Example (1).cpp").exists());
    }

    #[test]
    fn imports_chinese_luogu_statement_and_samples_and_reopens_same_origin() {
        let f = Fixture::new();
        let mut problem = payload();
        problem.title = "CF1234A 中文题目".into();
        problem.url = "https://luogu.com.cn/problem/CF1234A?lang=zh-CN".into();
        problem.markdown = "# 中文题目\n\n输入 $a,b$。\n".into();
        let markdown = problem.markdown.clone();
        let saved = f.import(problem).unwrap();
        assert!(saved.source_path.ends_with("CF1234A 中文题目.cpp"));
        assert_eq!(saved.source_url, "https://www.luogu.com.cn/problem/CF1234A");
        assert_eq!(fs::read_to_string(&saved.markdown_path).unwrap(), markdown);
        assert_eq!(
            crate::testcase::list(&f.db, &f.root, &saved.source_path)
                .unwrap()
                .len(),
            1
        );
        let mut problem = payload();
        problem.url = "https://www.luogu.com.cn/problem/cf1234a#top".into();
        let reopened = f.import(problem).unwrap();
        assert!(reopened.already_imported);
        assert_eq!(reopened.source_path, saved.source_path);
        // Importing another source must not overwrite an existing CF solution.
        assert_ne!(f.import(payload()).unwrap().source_path, saved.source_path);
    }

    #[test]
    fn validates_luogu_urls_and_preserves_atcoder_task_case() {
        assert_eq!(
            canonical_problem_url("https://www.luogu.com.cn/problem/AT_abc100_a").unwrap(),
            "https://www.luogu.com.cn/problem/AT_abc100_a"
        );
        assert_eq!(
            canonical_problem_url("https://luogu.com.cn/problem/P1001/").unwrap(),
            "https://www.luogu.com.cn/problem/P1001"
        );
        for url in [
            "http://www.luogu.com.cn/problem/P1001",
            "https://www.luogu.com.cn.evil.test/problem/P1001",
            "https://help.luogu.com.cn/problem/P1001",
            "https://user:pass@www.luogu.com.cn/problem/P1001",
            "https://www.luogu.com.cn:123/problem/P1001",
            "https://www.luogu.com.cn/problem/P1001/solution",
            "https://www.luogu.com.cn/problem/..",
            "https://www.luogu.com.cn/problem/123",
            "https://www.luogu.com.cn/problem/P%2F1001",
        ] {
            assert!(canonical_problem_url(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn reimporting_removed_files_preserves_the_previous_notebook_identity() {
        let f = Fixture::new();
        let old = f.import(payload()).unwrap();
        fs::remove_file(&old.source_path).unwrap();
        fs::remove_file(&old.markdown_path).unwrap();
        let new = f.import(payload()).unwrap();
        assert!(!new.already_imported);
        assert!(new.source_path.ends_with("A. Example (1).cpp"));
        assert_ne!(new.source_path, old.source_path);
        let key = old.source_path.replace('/', "\\").to_lowercase();
        assert!(crate::notebooks::read(&f.db, "problem", &key)
            .unwrap()
            .is_some());
    }

    #[test]
    fn sanitizes_windows_paths_and_reserved_names() {
        for name in [
            "../escape",
            "a/b\\c:d?*\"<>|",
            "CON",
            "nul.txt",
            "COM1",
            "LPT²",
            "  ..  ",
        ] {
            let safe = safe_stem(name);
            assert!(!safe
                .chars()
                .any(|c| "<>:\"/\\|?*".contains(c) || c.is_control()));
            assert!(!safe.ends_with('.'));
            assert!(!safe.is_empty());
        }
        assert_eq!(safe_stem("CON"), "_CON");
        assert_eq!(safe_stem("LPT²"), "_LPT²");
        assert_eq!(safe_stem("B. 数学题"), "B. 数学题");
    }

    #[test]
    fn rejects_unsupported_urls_empty_statements_and_unknown_payload_fields() {
        let f = Fixture::new();
        for url in [
            "https://evil.example/contest/1/problem/A",
            "file:///contest/1/problem/A",
            "https://codeforces.com/blog/1",
            "https://codeforces.com/contest/../problem/A",
            "https://codeforces.com.evil.test/contest/1/problem/A",
            "https://user:password@codeforces.com/contest/1/problem/A",
        ] {
            let mut problem = payload();
            problem.url = url.into();
            assert!(f.import(problem).is_err(), "accepted {url}");
        }
        let mut problem = payload();
        problem.markdown = " ".into();
        assert!(f.import(problem).is_err());
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
        assert!(serde_json::from_value::<ProblemPayload>(
            json!({"title":"A", "url":"url", "markdown":"m", "sourcePath":"../../bad"})
        )
        .is_err());
        assert_eq!(
            canonical_problem_url("https://codeforces.com/gym/123/problem/a").unwrap(),
            "https://codeforces.com/gym/123/problem/A"
        );
    }

    #[test]
    fn rolls_back_files_and_all_database_records_if_sample_insert_fails() {
        let f = Fixture::new();
        database::connect(&f.db).unwrap().execute_batch("CREATE TRIGGER fail_sample BEFORE INSERT ON testcases BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
        assert!(f.import(payload()).is_err());
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
        let count: i64 = database::connect(&f.db)
            .unwrap()
            .query_row("SELECT COUNT(*) FROM notebook_records", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }

    fn http(method: &str, path: &str, headers: &str, body: &str) -> (u16, String) {
        let mut stream = TcpStream::connect(("127.0.0.1", PORT)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}", body.len()).unwrap();
        let mut response = String::new();
        stream.read_to_string(&mut response).unwrap();
        let (headers, body) = response.split_once("\r\n\r\n").unwrap();
        (
            headers.split_whitespace().nth(1).unwrap().parse().unwrap(),
            body.into(),
        )
    }

    #[test]
    fn loopback_server_authenticates_imports_serves_script_and_can_stop_and_restart() {
        let _serial = crate::PROCESS_TEST_LOCK.lock().unwrap();
        let f = Fixture::new();
        let listener = ProblemListener::default();
        let (sender, receiver) = std::sync::mpsc::channel();
        assert!(!listener.status().unwrap().listening);
        listener
            .start(
                f.root.clone(),
                f.db.clone(),
                "template".into(),
                move |problem| {
                    let _ = sender.send(problem);
                },
            )
            .unwrap();
        assert!(listener.status().unwrap().listening);
        assert_eq!(http("GET", "/lightcp-codeforces.user.js", "", "").0, 200);
        assert_eq!(http("GET", "/session", "", "").0, 403);
        assert_eq!(
            http(
                "GET",
                "/session",
                "X-LightCP-Client: lightcp-userscript-v1\r\nOrigin: https://www.luogu.com.cn\r\n",
                ""
            )
            .0,
            200
        );
        assert_eq!(http("GET", "/session", "X-LightCP-Client: lightcp-userscript-v1\r\nOrigin: https://www.luogu.com.cn.evil.test\r\n", "").0, 403);
        assert_eq!(
            http(
                "GET",
                "/session",
                "X-LightCP-Client: lightcp-userscript-v1\r\nOrigin: https://evil.example\r\n",
                ""
            )
            .0,
            403
        );
        let (status, session) = http(
            "GET",
            "/session",
            "X-LightCP-Client: lightcp-userscript-v1\r\n",
            "",
        );
        assert_eq!(status, 200);
        let session: serde_json::Value = serde_json::from_str(&session).unwrap();
        let token = session["token"].as_str().unwrap();
        let body = json!({"title":"A. Example", "url":payload().url, "markdown":payload().markdown, "samples":[{"input":"1\n", "expectedOutput":"YES\n"}]}).to_string();
        assert_eq!(
            http(
                "POST",
                "/problem",
                "X-LightCP-Client: lightcp-userscript-v1\r\nX-LightCP-Token: invalid\r\n",
                &body
            )
            .0,
            403
        );
        let headers = format!("X-LightCP-Client: lightcp-userscript-v1\r\nX-LightCP-Token: {token}\r\nContent-Type: application/json\r\n");
        assert_eq!(http("POST", "/problem", &headers, &body).0, 200);
        let imported = receiver.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(
            fs::read_to_string(imported.source_path).unwrap(),
            "template"
        );
        let luogu_body = json!({"title":"P1001 中文题", "url":"https://www.luogu.com.cn/problem/P1001", "markdown":"# 中文题", "samples":[{"input":"1 2\n", "expectedOutput":"3\n"}]}).to_string();
        let luogu_headers = format!("{headers}Origin: https://www.luogu.com.cn\r\n");
        assert_eq!(http("POST", "/problem", &luogu_headers, &luogu_body).0, 200);
        assert!(receiver
            .recv_timeout(Duration::from_secs(2))
            .unwrap()
            .source_path
            .ends_with("P1001 中文题.cpp"));
        listener.stop().unwrap();
        assert!(!listener.status().unwrap().listening);
        listener
            .start(f.root.clone(), f.db.clone(), "template".into(), |_| {})
            .unwrap();
        assert_eq!(http("POST", "/problem", &headers, &body).0, 403);
        listener.stop().unwrap();
    }

    #[test]
    fn stopping_cancels_a_request_that_has_not_finished_uploading() {
        let _serial = crate::PROCESS_TEST_LOCK.lock().unwrap();
        let f = Fixture::new();
        let listener = ProblemListener::default();
        listener
            .start(f.root.clone(), f.db.clone(), "template".into(), |_| {})
            .unwrap();
        let (_, response) = http(
            "GET",
            "/session",
            "X-LightCP-Client: lightcp-userscript-v1\r\n",
            "",
        );
        let session: serde_json::Value = serde_json::from_str(&response).unwrap();
        let body = json!({"title":"A. Example", "url":payload().url, "markdown":"x".repeat(1500)})
            .to_string();
        let mut pending = TcpStream::connect(("127.0.0.1", PORT)).unwrap();
        pending
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        write!(pending, "POST /problem HTTP/1.1\r\nHost: 127.0.0.1:{PORT}\r\nConnection: close\r\nContent-Length: {}\r\nX-LightCP-Client: lightcp-userscript-v1\r\nX-LightCP-Token: {}\r\n\r\n{}", body.len(), session["token"].as_str().unwrap(), &body[..500]).unwrap();
        assert_eq!(
            http(
                "GET",
                "/session",
                "X-LightCP-Client: lightcp-userscript-v1\r\n",
                ""
            )
            .0,
            200
        );
        listener.stop().unwrap();
        let _ = pending.write_all(&body.as_bytes()[500..]);
        let mut result = String::new();
        let _ = pending.read_to_string(&mut result);
        assert_eq!(fs::read_dir(&f.root).unwrap().count(), 0);
    }
}
