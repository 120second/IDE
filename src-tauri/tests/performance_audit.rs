use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use lightcp_lib::{
    compiler::CompilerConfig,
    database,
    debugger::{DebugManager, DebugStartRequest},
    filesystem::{list_directory, read_text_file},
    generator::{
        GeneratorStrategy, TreeShape, ValueExpression, VisualField, VisualGeneratorProfile,
        VisualNode,
    },
    runner::{RunRequest, RunnerManager},
    stress::{StressManager, StressRunRequest},
    templates::{list_categories, list_templates, TemplateFilter, TemplateKind, TemplateSort},
};

#[test]
#[ignore = "manual Batch 9 performance scenario"]
fn workspace_5000_deep_tree_and_8mb_source() {
    let root = temporary_directory("workspace");
    for directory_index in 0..50 {
        let directory = root.join(format!("round-{directory_index:02}"));
        fs::create_dir(&directory).unwrap();
        for file_index in 0..100 {
            fs::write(
                directory.join(format!("solution-{file_index:03}.cpp")),
                "int main() { return 0; }\n",
            )
            .unwrap();
        }
    }
    let mut deep = root.clone();
    for depth in 0..40 {
        deep = deep.join(format!("level-{depth:02}"));
        fs::create_dir(&deep).unwrap();
    }
    fs::write(deep.join("deep.cpp"), "int deep;\n").unwrap();
    let large = root.join("large-8mb.cpp");
    fs::write(&large, vec![b'x'; 8 * 1024 * 1024]).unwrap();

    let started = Instant::now();
    let root_entries = list_directory(&root, &path_text(&root)).unwrap();
    let mut cpp_files = 0;
    for directory in root_entries
        .iter()
        .filter(|entry| entry.name.starts_with("round-"))
    {
        cpp_files += list_directory(&root, &directory.path).unwrap().len();
    }
    let mut traversed = root.clone();
    for depth in 0..40 {
        traversed = traversed.join(format!("level-{depth:02}"));
        assert!(!list_directory(&root, &path_text(&traversed))
            .unwrap()
            .is_empty());
    }
    let workspace_ms = started.elapsed().as_millis();
    let started = Instant::now();
    let source = read_text_file(&root, &path_text(&large)).unwrap();
    let large_file_ms = started.elapsed().as_millis();

    eprintln!(
        "PERF workspace_files={cpp_files} workspace_ms={workspace_ms} large_bytes={} large_file_ms={large_file_ms}",
        source.content.len()
    );
    assert_eq!(cpp_files, 5_000);
    assert_eq!(source.content.len(), 8 * 1024 * 1024);
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "manual Batch 9 performance scenario"]
fn template_metadata_10000_query_profile() {
    let root = temporary_directory("templates");
    let database_path = root.join("metadata.db");
    database::initialize(&database_path).unwrap();
    let mut connection = rusqlite::Connection::open(&database_path).unwrap();
    let transaction = connection.transaction().unwrap();
    for index in 0..200 {
        transaction
            .execute(
                "INSERT INTO template_categories(name, sort_order) VALUES (?1, ?2)",
                rusqlite::params![format!("category-{index}"), index],
            )
            .unwrap();
    }
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO templates(kind, name, trigger, aliases, description, language, category_id, sort_order, use_count, code)
                 VALUES ('snippet', ?1, ?2, '[]', '', 'cpp', ?3, ?4, ?5, '')",
            )
            .unwrap();
        for index in 0..10_000_i64 {
            statement
                .execute(rusqlite::params![
                    format!("template-{index:05}"),
                    format!("t{index}"),
                    index % 200 + 1,
                    index,
                    index % 500,
                ])
                .unwrap();
        }
    }
    transaction.commit().unwrap();

    let started = Instant::now();
    let categories = list_categories(&database_path).unwrap();
    let templates = list_templates(
        &database_path,
        &TemplateFilter {
            kind: TemplateKind::Snippet,
            search: String::new(),
            favorite_only: false,
            recent_only: false,
            category_id: None,
            sort: TemplateSort::Manual,
        },
    )
    .unwrap();
    let query_ms = started.elapsed().as_millis();
    eprintln!(
        "PERF categories={} templates={} metadata_query_ms={query_ms}",
        categories.len(),
        templates.len()
    );
    assert_eq!(categories.len(), 200);
    assert_eq!(templates.len(), 10_000);
    drop(connection);
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "manual Batch 9 performance scenario"]
fn stdout_100000_lines_and_repeated_runs() {
    if !tool_available("g++") {
        eprintln!("PERF skipped: g++ unavailable");
        return;
    }
    let root = temporary_directory("runner");
    let source = root.join("output.cpp");
    let executable = root.join("output.exe");
    fs::write(
        &source,
        "#include <iostream>\nint main(){for(int i=0;i<100000;i++)std::cout<<i<<'\\n';}\n",
    )
    .unwrap();
    compile_cpp(&source, &executable, false);
    let manager = RunnerManager::default();
    let started = Instant::now();
    let mut batches = 0usize;
    let result = manager
        .run(&run_request(&executable, &root, "stdout-100k"), |_| {
            batches += 1
        })
        .unwrap();
    let output_ms = started.elapsed().as_millis();
    assert_eq!(result.stdout.lines().count(), 100_000);

    let small_source = root.join("small.cpp");
    let small_executable = root.join("small.exe");
    fs::write(&small_source, "int main(){return 0;}\n").unwrap();
    compile_cpp(&small_source, &small_executable, false);
    let started = Instant::now();
    for index in 0..50 {
        manager
            .run(
                &run_request(&small_executable, &root, &format!("repeat-{index}")),
                |_| {},
            )
            .unwrap();
    }
    let repeated_ms = started.elapsed().as_millis();
    eprintln!(
        "PERF stdout_lines=100000 stdout_ms={output_ms} ipc_batches={batches} repeated_runs=50 repeated_run_ms={repeated_ms}"
    );
    assert!(batches < 1_000, "stdout should cross IPC in batches");
    assert!(manager.active_run_id().is_none());
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "manual Batch 9 performance scenario"]
fn repeated_debug_20_sessions_cleanup() {
    if !tool_available("g++") || !tool_available("gdb") {
        eprintln!("PERF skipped: g++ or gdb unavailable");
        return;
    }
    let root = temporary_directory("debug");
    let source = root.join("debug.cpp");
    let executable = root.join("debug.exe");
    fs::write(&source, "int main(){int value=42;return value==42?0:1;}\n").unwrap();
    compile_cpp(&source, &executable, true);
    let manager = DebugManager::new(root.join("debug-data"));
    let event_count = Arc::new(AtomicUsize::new(0));
    let started = Instant::now();
    for _ in 0..20 {
        let events = event_count.clone();
        manager
            .start(
                DebugStartRequest {
                    gdb_path: "gdb".to_owned(),
                    executable_path: path_text(&executable),
                    source_path: path_text(&source),
                    working_directory: path_text(&root),
                    stdin: String::new(),
                    breakpoints: Vec::new(),
                },
                move |_| {
                    events.fetch_add(1, Ordering::Relaxed);
                },
            )
            .unwrap();
        manager.stop().unwrap();
        assert!(!manager.is_active());
    }
    let duration_ms = started.elapsed().as_millis();
    eprintln!(
        "PERF debug_sessions=20 debug_ms={duration_ms} debug_ipc_events={}",
        event_count.load(Ordering::Relaxed)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
#[ignore = "long-running Batch 9 process stress scenario"]
fn stress_iterations_batch_progress() {
    if !tool_available("g++") {
        eprintln!("PERF skipped: g++ unavailable");
        return;
    }
    let root = temporary_directory("stress");
    let build = root.join("build");
    let solution = root.join("solution.cpp");
    let brute = root.join("brute.cpp");
    let program = "#include <iostream>\nint main(){long long n;std::cin>>n;std::cout<<n<<'\\n';}\n";
    fs::write(&solution, program).unwrap();
    fs::write(&brute, program).unwrap();
    let iterations = std::env::var("LIGHTCP_STRESS_ITERATIONS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(100);
    let request = StressRunRequest {
        session_id: "performance-10000".to_owned(),
        solution_path: path_text(&solution),
        brute_path: path_text(&brute),
        generator_profile: fixed_integer_profile(),
        iterations,
        infinite: false,
        seed: "1".to_owned(),
        timeout_ms: 5_000,
        max_output_bytes: 64 * 1024,
        compiler_config: compiler_config(),
        start_case: 0,
        initial_passed: 0,
        initial_failed: 0,
        initial_elapsed_ms: 0,
    };
    let manager = StressManager::default();
    let started = Instant::now();
    let mut events = 0usize;
    let summary = manager
        .run(&root, &build, &request, |_| events += 1)
        .unwrap();
    let duration_ms = started.elapsed().as_millis();
    eprintln!(
        "PERF stress_iterations={} stress_ms={duration_ms} stress_ipc_events={events}",
        summary.stats.total_cases
    );
    assert_eq!(summary.stats.total_cases, iterations);
    assert!(events < 1_000, "progress events should be batched");
    assert!(manager.active_session_id().is_none());
    fs::remove_dir_all(root).unwrap();
}

fn fixed_integer_profile() -> VisualGeneratorProfile {
    VisualGeneratorProfile {
        version: 1,
        nodes: vec![VisualNode::Line {
            id: "line".to_owned(),
            fields: vec![VisualField::Integer {
                id: "n".to_owned(),
                name: "n".to_owned(),
                minimum: ValueExpression::Constant {
                    value: "7".to_owned(),
                },
                maximum: ValueExpression::Constant {
                    value: "7".to_owned(),
                },
            }],
        }],
        strategy: GeneratorStrategy::Random,
        tree_shape: TreeShape::Random,
        seed: "1".to_owned(),
    }
}

fn run_request(executable: &Path, root: &Path, id: &str) -> RunRequest {
    RunRequest {
        client_run_id: id.to_owned(),
        executable_path: path_text(executable),
        arguments: Vec::new(),
        working_directory: path_text(root),
        stdin: String::new(),
        timeout_ms: 30_000,
        max_output_bytes: 16 * 1024 * 1024,
    }
}

fn compiler_config() -> CompilerConfig {
    CompilerConfig {
        compiler_path: "g++".to_owned(),
        standard: "c++20".to_owned(),
        release_args: vec!["-O2".to_owned()],
        debug_args: vec!["-g".to_owned(), "-O0".to_owned()],
        max_output_bytes: 64 * 1024,
    }
}

fn compile_cpp(source: &Path, executable: &Path, debug: bool) {
    let mut command = Command::new("g++");
    command.arg(source).arg("-o").arg(executable);
    if debug {
        command.args(["-g", "-O0"]);
    } else {
        command.arg("-O2");
    }
    let output = command.output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn tool_available(tool: &str) -> bool {
    Command::new(tool).arg("--version").output().is_ok()
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn temporary_directory(label: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!(
        "lightcp-performance-{label}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&root).unwrap();
    dunce::canonicalize(root).unwrap()
}
