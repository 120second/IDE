use lightcp_lib::compiler::{
    compile_current_file, CompileProfile, CompileRequest, CompileResult, CompilerConfig,
    CompilerManager,
};
use std::{fs, path::Path, sync::Arc};

fn request(source: &Path, reuse: bool) -> CompileRequest {
    CompileRequest {
        reuse_artifact: reuse,
        client_task_id: None,
        expected_source: None,
        source_path: source.to_string_lossy().into_owned(),
        profile: CompileProfile::Release,
        config: CompilerConfig {
            compiler_path: "g++".into(),
            standard: "c++20".into(),
            release_args: vec!["-O2".into(), "-Wall".into()],
            debug_args: vec!["-g".into(), "-O0".into()],
            max_output_bytes: 2 * 1024 * 1024,
        },
    }
}

fn errors(result: &CompileResult) -> Vec<(String, u32, u32, u8)> {
    result
        .diagnostics
        .iter()
        .filter(|d| d.severity == 1)
        .map(|d| {
            (
                d.message.clone(),
                d.range.start.line,
                d.range.start.character,
                d.severity,
            )
        })
        .collect()
}

#[test]
fn mixed_and_truncated_gcc_output_keeps_positioned_diagnostics() {
    let root =
        std::env::temp_dir().join(format!("lightcp-output-followup-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    fs::write(
        &source,
        "static_assert(false, \"undefined reference\");\nint main(){}\n",
    )
    .unwrap();
    let mut config = request(&source, false);
    config.config.release_args.push("-v".into());
    let result = compile_current_file(&root, &root.join("build"), &config).unwrap();
    assert_eq!(
        result
            .diagnostics
            .iter()
            .filter(|d| d.severity == 1)
            .count(),
        1
    );
    assert!(result
        .diagnostics
        .iter()
        .any(|d| !d.file_level && d.message.contains("static assertion")));
    assert!(!result
        .diagnostics
        .iter()
        .any(|d| d.source == "链接器" || d.message.is_empty()));
    fs::write(
        &source,
        (0..500)
            .map(|index| format!("int value{index}=missing{index};\n"))
            .collect::<String>(),
    )
    .unwrap();
    config.config.release_args = vec!["-O2".into()];
    config.config.max_output_bytes = 65536;
    let result = compile_current_file(&root, &root.join("build"), &config).unwrap();
    assert!(!result.success && result.output_truncated && result.diagnostics_incomplete);
    assert!(
        result
            .diagnostics
            .iter()
            .filter(|d| !d.file_level && d.severity == 1)
            .count()
            > 20
    );
    assert!(result
        .diagnostics
        .iter()
        .any(|d| d.code == "diagnostics_incomplete"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn build_dependencies_include_only_real_inputs_and_hash_normalized_contents() {
    use sha2::{Digest, Sha256};
    let root = std::env::temp_dir().join(format!("lightcp-依赖 空格-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    let header = root.join("value space.h");
    let unused = root.join("unrelated.h");
    fs::write(
        &source,
        "#include \"value space.h\"\nint main(){return VALUE;}\n",
    )
    .unwrap();
    fs::write(&header, "// 中文\r\n#define VALUE 3\r\n").unwrap();
    fs::write(&unused, "#error unused\n").unwrap();
    let result =
        compile_current_file(&root, &root.join("build"), &request(&source, false)).unwrap();
    assert!(result.success && result.dependencies_complete, "{result:?}");
    assert!(!result
        .dependencies
        .iter()
        .any(|d| Path::new(&d.path) == unused));
    let dependency = result
        .dependencies
        .iter()
        .find(|d| Path::new(&d.path) == header)
        .unwrap();
    assert_eq!(
        dependency.content_hash.as_deref(),
        Some(
            format!(
                "{:x}",
                Sha256::digest("// 中文\n#define VALUE 3\n".as_bytes())
            )
            .as_str()
        )
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn running_and_explicit_build_preserve_macro_diagnostics() {
    let root = std::env::temp_dir().join(format!("lightcp-macro-audit-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("macro.cpp");
    fs::write(&source, "#define VERY_LONG_TYPE_NAME int\nint main(){ VERY_LONG_TYPE_NAME value=0; return missing_name + value; }\n").unwrap();
    let normal =
        compile_current_file(&root, &root.join("normal"), &request(&source, false)).unwrap();
    let manager = Arc::new(CompilerManager::default());
    let running = manager
        .reserve()
        .unwrap()
        .compile(&root, &root.join("running"), &request(&source, true))
        .unwrap();
    assert!(!normal.success && !running.success);
    assert_eq!(
        errors(&normal),
        errors(&running),
        "running must report the same locations as compiling the original source"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compiler_diagnostic_matrix() {
    let root = std::env::temp_dir().join(format!(
        "lightcp-diagnostic-matrix-中文 空格-{}",
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("诊断.cpp");
    let cases = [
        (
            "undeclared_function",
            "int main(){add_subtree(1,1);}\n",
            "add_subtree",
        ),
        (
            "missing_semicolon",
            "int main(){int x=0 return x;}\n",
            "expected",
        ),
        (
            "missing_header",
            "#include \"not_present_123456.h\"\nint main(){}\n",
            "not_present_123456",
        ),
        (
            "link_failure",
            "void declared_only(); int main(){declared_only();}\n",
            "undefined reference",
        ),
        (
            "type_mismatch",
            "int main(){int x=\"hello\";return x;}\n",
            "conversion",
        ),
        (
            "crlf_tabs_unicode",
            "int main(){\r\n\t/* 中文😀 */ return missing_value;\r\n}\r\n",
            "missing_value",
        ),
        (
            "cr_only_unicode",
            "int main(){\r\t/* 中文😀 */ return missing_value;\r}\r",
            "missing_value",
        ),
    ];
    for (label, text, expected) in cases {
        fs::write(&source, text).unwrap();
        for reuse in [false, true] {
            let manager = Arc::new(CompilerManager::default());
            let result = manager
                .reserve()
                .unwrap()
                .compile(&root, &root.join(label), &request(&source, reuse))
                .unwrap();
            assert!(
                !result.success && result.executable_path.is_none(),
                "{label} reuse={reuse}"
            );
            assert!(
                result
                    .diagnostics
                    .iter()
                    .any(|d| d.severity == 1 && d.message.contains(expected)),
                "{label}: {:?}",
                result.diagnostics
            );
        }
    }
    fs::write(&source, "#include <bits/stdc++.h>\nint main(){std::vector<std::pair<int,int>> a{{1,2}};for(auto [k,id]:a){for(int i=k;i<id;++i){}}return 0;}\n").unwrap();
    let clean = compile_current_file(&root, &root.join("fixed"), &request(&source, false)).unwrap();
    assert!(
        clean.success && !clean.diagnostics.iter().any(|d| d.severity == 1),
        "{}",
        clean.stderr
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn warnings_and_time_macros_are_preserved_when_running() {
    let root = std::env::temp_dir().join(format!("lightcp-warning-audit-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    fs::write(&source, "#warning sample_warning\n#define VERY_LONG_TYPE_NAME int\nint main(){ VERY_LONG_TYPE_NAME unused; return 0; }\n").unwrap();
    let normal =
        compile_current_file(&root, &root.join("normal"), &request(&source, false)).unwrap();
    let manager = Arc::new(CompilerManager::default());
    let running = manager
        .reserve()
        .unwrap()
        .compile(&root, &root.join("running"), &request(&source, true))
        .unwrap();
    let warnings = |result: &CompileResult| {
        result
            .diagnostics
            .iter()
            .map(|d| {
                (
                    d.message.clone(),
                    d.range.start.line,
                    d.range.start.character,
                    d.severity,
                )
            })
            .collect::<Vec<_>>()
    };
    assert!(normal.success && running.success);
    assert_eq!(warnings(&normal), warnings(&running));
    let hit = manager
        .reserve()
        .unwrap()
        .compile(&root, &root.join("running"), &request(&source, true))
        .unwrap();
    assert!(
        !hit.cache_hit,
        "warning locations must be recomputed from original source"
    );
    assert_eq!(warnings(&normal), warnings(&hit));
    fs::write(
        &source,
        "const char* stamp=__TIME__; int main(){return stamp[0]==0;}\n",
    )
    .unwrap();
    let timed = manager
        .reserve()
        .unwrap()
        .compile(&root, &root.join("timed"), &request(&source, true))
        .unwrap();
    assert!(
        timed.success && !timed.source_changed && !timed.cache_hit,
        "valid __TIME__ code must not produce a fake dependency error"
    );
    assert!(
        !timed
            .diagnostics
            .iter()
            .any(|d| d.message.contains("__TIME__")),
        "cache validation must not introduce -Wdate-time warnings"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn standard_library_builds_do_not_invent_dependency_changes() {
    let root = std::env::temp_dir().join(format!("lightcp-stable-中文-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("求和.cpp");
    fs::write(&source, "#include <bits/stdc++.h>\nint main(){std::vector<int> values{3,4};return std::accumulate(values.begin(),values.end(),0);}\n").unwrap();
    let manager = Arc::new(CompilerManager::default());
    for _ in 0..3 {
        let result = manager
            .reserve()
            .unwrap()
            .compile(&root, &root.join("build"), &request(&source, true))
            .unwrap();
        assert!(result.success && !result.source_changed, "{result:?}");
        assert_eq!(
            std::process::Command::new(result.executable_path.unwrap())
                .status()
                .unwrap()
                .code(),
            Some(7)
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn mixed_line_endings_do_not_look_like_unsaved_source_edits() {
    let root = std::env::temp_dir().join(format!("lightcp-eol-audit-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    fs::write(&source, "// 中文\r\nint main(){\nreturn 0;\r}\r\n").unwrap();
    let manager = Arc::new(CompilerManager::default());
    for reuse in [false, true] {
        let mut request = request(&source, reuse);
        request.expected_source = Some("// 中文\nint main(){\nreturn 0;\n}\n".into());
        let result = manager
            .reserve()
            .unwrap()
            .compile(&root, &root.join("build"), &request)
            .unwrap();
        assert!(result.success, "{}", result.stderr);
        request.expected_source = Some("int main(){return 1;}".into());
        assert!(manager
            .reserve()
            .unwrap()
            .compile(&root, &root.join("build"), &request)
            .is_err());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn unsaved_header_changes_refresh_main_diagnostics() {
    use lightcp_lib::lsp::{ClangdManager, LspEvent, LspPosition, LspRange, LspTextChange};
    use std::{
        process::Command,
        sync::mpsc,
        time::{Duration, Instant},
    };
    let clangd = [
        "clangd",
        "C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/Llvm/x64/bin/clangd.exe",
    ]
    .into_iter()
    .find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .output()
            .is_ok_and(|result| result.status.success())
    })
    .expect("clangd is required for this audit");
    let root = std::env::temp_dir().join(format!("lightcp-header-audit-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    let header = root.join("types.hpp");
    let original = "struct Item { int value; };";
    let broken = "struct Item {};";
    let text = "#include \"types.hpp\"\nint main(){Item item{};return item.value;}\n";
    fs::write(&source, text).unwrap();
    fs::write(&header, original).unwrap();
    let manager = ClangdManager::default();
    let (sender, receiver) = mpsc::channel();
    manager
        .start(
            root.clone(),
            clangd.into(),
            "g++".into(),
            "c++20".into(),
            vec![],
            move |event| {
                let _ = sender.send(event);
            },
        )
        .unwrap();
    manager
        .did_open(&source.to_string_lossy(), text.into(), 1)
        .unwrap();
    manager
        .did_open(&header.to_string_lossy(), original.into(), 1)
        .unwrap();
    let wait = |version: i64, failed: bool| {
        let deadline = Instant::now() + Duration::from_secs(15);
        while Instant::now() < deadline {
            if let Ok(LspEvent::Diagnostics {
                path,
                version: Some(current),
                diagnostics,
                ..
            }) = receiver.recv_timeout(Duration::from_millis(100))
            {
                if path != source.to_string_lossy() || current != version {
                    continue;
                }
                assert_eq!(
                    diagnostics.iter().any(|d| d.severity == 1),
                    failed,
                    "version {version}: {diagnostics:?}"
                );
                return;
            }
        }
        panic!("main.cpp was not rechecked at version {version}");
    };
    wait(1, false);
    for (index, (before, after)) in [(original, broken), (broken, original)]
        .into_iter()
        .enumerate()
    {
        let version = index as i64 + 2;
        manager
            .did_change(
                &header.to_string_lossy(),
                version,
                vec![LspTextChange {
                    range: LspRange {
                        start: LspPosition {
                            line: 0,
                            character: 0,
                        },
                        end: LspPosition {
                            line: 0,
                            character: before.len() as u32,
                        },
                    },
                    text: after.into(),
                }],
            )
            .unwrap();
        manager.did_close(&source.to_string_lossy()).unwrap();
        manager
            .did_open(&source.to_string_lossy(), text.into(), version)
            .unwrap();
        wait(version, index == 0);
    }
    assert_eq!(fs::read_to_string(&header).unwrap(), original);
    manager.stop().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn clang_text_diagnostics_keep_utf16_positions() {
    use std::process::Command;
    let compiler = [
        "clang++",
        "C:/Program Files/Microsoft Visual Studio/2022/Community/VC/Tools/Llvm/x64/bin/clang++.exe",
    ]
    .into_iter()
    .find(|candidate| {
        Command::new(candidate)
            .arg("--version")
            .output()
            .is_ok_and(|result| result.status.success())
    })
    .expect("clang++ is required for this audit");
    let root =
        std::env::temp_dir().join(format!("lightcp-clang-text-中文-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    let line = "int main(){ /*中文😀*/ return missing_name; }";
    fs::write(&source, format!("// header\n{line}\n")).unwrap();
    let mut request = request(&source, false);
    request.config.compiler_path = compiler.into();
    let result = compile_current_file(&root, &root.join("build"), &request).unwrap();
    assert!(!result.success);
    let error = result
        .diagnostics
        .iter()
        .find(|d| d.severity == 1 && d.message.contains("missing_name"))
        .expect("missing positioned Clang diagnostic");
    assert!(!error.file_level);
    assert_eq!(error.range.start.line, 1);
    assert_eq!(
        error.range.start.character,
        line[..line.find("missing_name").unwrap()]
            .encode_utf16()
            .count() as u32
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn gcc_positions_cover_bom_tabs_unicode_and_cr_line_endings() {
    let root = std::env::temp_dir().join(format!("lightcp-gcc-columns-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    for (index, (prefix, separator)) in [("\u{feff}", "\n"), ("// first", "\r")]
        .into_iter()
        .enumerate()
    {
        let line = if index == 0 {
            format!("{prefix}int main(){{ /* 中文😀 */ return missing_name; }}")
        } else {
            "\tint main(){ /* 中文😀 */ return missing_name; }".into()
        };
        let text = if index == 0 {
            line.clone()
        } else {
            format!("{prefix}{separator}{line}{separator}")
        };
        fs::write(&source, text).unwrap();
        let mut request = request(&source, false);
        request.profile = CompileProfile::Debug;
        let result = compile_current_file(&root, &root.join("build"), &request).unwrap();
        let error = result
            .diagnostics
            .iter()
            .find(|d| d.severity == 1 && d.message.contains("missing_name"))
            .unwrap();
        assert_eq!(error.range.start.line, index as u32);
        assert_eq!(
            error.range.start.character,
            line[..line.find("missing_name").unwrap()]
                .encode_utf16()
                .count() as u32,
            "BOM or CR offset mismatch: {error:?}"
        );
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn failed_preprocessing_preserves_known_dependencies_without_claiming_completeness() {
    let root = std::env::temp_dir().join(format!("lightcp-partial-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    let header = root.join("value.h");
    fs::write(&source, "#include \"value.h\"\nint main(){}\n").unwrap();
    fs::write(&header, "#error old_disk_error\n").unwrap();
    let result =
        compile_current_file(&root, &root.join("build"), &request(&source, false)).unwrap();
    assert!(!result.success && !result.dependencies_complete);
    assert!(result
        .dependencies
        .iter()
        .any(|dependency| Path::new(&dependency.path) == header));
    assert!(result.stderr.contains("old_disk_error"));
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn mp_phony_rules_do_not_turn_successful_builds_into_failures() {
    let root = std::env::temp_dir().join(format!("lightcp-phony 空格-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    let header = root.join("value space.h");
    fs::write(
        &source,
        "#include \"value space.h\"\nint main(){return VALUE;}\n",
    )
    .unwrap();
    fs::write(&header, "#define VALUE 3\n").unwrap();
    let mut request = request(&source, false);
    request.config.release_args.push("-MP".into());
    let result = compile_current_file(&root, &root.join("build"), &request).unwrap();
    assert!(result.success && result.dependencies_complete, "{result:?}");
    assert!(result
        .dependencies
        .iter()
        .any(|dependency| Path::new(&dependency.path) == header));
    assert_eq!(
        std::process::Command::new(result.executable_path.unwrap())
            .status()
            .unwrap()
            .code(),
        Some(3)
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compiler_aliases_and_column_origins_keep_exact_identifier_positions() {
    let root = std::env::temp_dir().join(format!("lightcp-alias-columns-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    for compiler in ["g++", "c++"] {
        for origin in [0, 1, 5] {
            for prefix in ["\t", "\t/* 中文😀 */ ", "\u{feff}"] {
                let line = format!("{prefix}int main(){{ return missing_name; }}");
                fs::write(&source, format!("{line}\r\n")).unwrap();
                let mut request = request(&source, false);
                request.config.compiler_path = compiler.into();
                request
                    .config
                    .release_args
                    .push(format!("-fdiagnostics-column-origin={origin}"));
                let result = compile_current_file(&root, &root.join("build"), &request).unwrap();
                let error = result
                    .diagnostics
                    .iter()
                    .find(|d| d.message.contains("missing_name"))
                    .unwrap();
                assert!(!error.file_level);
                assert_eq!(
                    error.range.start.character,
                    line[..line.find("missing_name").unwrap()]
                        .encode_utf16()
                        .count() as u32,
                    "compiler={compiler} origin={origin} prefix={prefix:?}, error={error:?}"
                );
                assert_eq!(error.range.end.character - error.range.start.character, 12);
            }
        }
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn extra_translation_units_and_response_files_are_explicitly_rejected() {
    let root = std::env::temp_dir().join(format!("lightcp-single-tu-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&root).unwrap();
    let source = root.join("main.cpp");
    fs::write(&source, "int main(){}\n").unwrap();
    for argument in [
        "helper.cpp",
        "extensionless_source",
        "@options.rsp",
        "-Wp,@options.rsp",
    ] {
        for profile in [CompileProfile::Release, CompileProfile::Debug] {
            let mut request = request(&source, true);
            request.profile = profile;
            request.config.release_args.push(argument.into());
            request.config.debug_args.push(argument.into());
            let manager = Arc::new(CompilerManager::default());
            let error = manager
                .reserve()
                .unwrap()
                .compile(&root, &root.join("build"), &request)
                .unwrap_err();
            assert!(error.to_string().contains("单个 .cpp"), "{error:?}");
        }
    }
    // A forced include is a single TU input, even if its extension is .cpp.
    fs::write(root.join("definitions.cpp"), "#define VALUE 3\n").unwrap();
    let mut request = request(&source, false);
    request
        .config
        .release_args
        .extend(["-include".into(), "definitions.cpp".into()]);
    let result = compile_current_file(&root, &root.join("build"), &request).unwrap();
    assert!(result.success && result.dependencies_complete, "{result:?}");
    fs::remove_dir_all(root).unwrap();
}
