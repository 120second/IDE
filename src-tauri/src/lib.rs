pub mod archive;
pub mod commands;
pub mod compiler;
pub mod database;
pub mod debugger;
pub mod error;
pub mod filesystem;
pub mod generator;
pub mod lsp;
pub mod paths;
pub mod performance;
pub mod recovery;
pub mod runner;
pub mod settings;
pub mod state;
pub mod stress;
pub mod templates;
pub mod testcase;

use tauri::Manager;

use crate::{paths::AppPaths, state::AppState};

#[cfg(test)]
pub(crate) static PROCESS_TEST_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_started = std::time::Instant::now();
    let application = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(log::LevelFilter::Info)
                .timezone_strategy(tauri_plugin_log::TimezoneStrategy::UseLocal)
                .build(),
        )
        .setup(move |app| {
            let paths = AppPaths::initialize(app.handle())?;
            let database = database::initialize(&paths.database_file)?;

            log::info!(
                "LightCP backend initialized (schema v{}, data directory: {})",
                database.schema_version,
                paths.data_dir.display()
            );

            let state = AppState::new(paths, database.schema_version);
            state.performance.set_backend_startup_duration(
                backend_started
                    .elapsed()
                    .as_millis()
                    .min(u128::from(u64::MAX)) as u64,
            );
            app.manage(state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::health::health_check,
            commands::performance::get_performance_snapshot,
            commands::lsp::start_clangd,
            commands::lsp::stop_clangd,
            commands::lsp::lsp_did_open,
            commands::lsp::lsp_did_change,
            commands::lsp::lsp_did_save,
            commands::lsp::lsp_did_close,
            commands::lsp::lsp_completion,
            commands::lsp::lsp_hover,
            commands::lsp::lsp_definition,
            commands::lsp::lsp_signature_help,
            commands::lsp::lsp_references,
            commands::lsp::cancel_lsp_request,
            commands::settings::load_settings,
            commands::settings::save_settings,
            commands::recovery::load_editor_recovery,
            commands::recovery::save_editor_recovery,
            commands::workspace::open_workspace,
            commands::workspace::list_recent_workspaces,
            commands::filesystem::list_directory,
            commands::filesystem::read_text_file,
            commands::filesystem::get_text_file_revision,
            commands::filesystem::write_text_file,
            commands::filesystem::create_file,
            commands::filesystem::create_directory,
            commands::filesystem::rename_entry,
            commands::filesystem::delete_entry,
            commands::filesystem::move_entry,
            commands::templates::list_template_categories,
            commands::templates::create_template_category,
            commands::templates::rename_template_category,
            commands::templates::delete_template_category,
            commands::templates::move_template_category,
            commands::templates::list_templates,
            commands::templates::search_template_completions,
            commands::templates::get_template,
            commands::templates::create_template,
            commands::templates::update_template,
            commands::templates::delete_template,
            commands::templates::set_template_favorite,
            commands::templates::record_template_use,
            commands::templates::move_template,
            commands::templates::list_template_versions,
            commands::templates::get_template_version,
            commands::templates::delete_template_version,
            commands::templates::restore_template_version,
            commands::compiler::compile_current_file,
            commands::runner::run_program,
            commands::runner::stop_program,
            commands::debugger::start_debug_session,
            commands::debugger::stop_debug_session,
            commands::debugger::restart_debug_session,
            commands::debugger::debug_continue,
            commands::debugger::debug_pause,
            commands::debugger::debug_step_over,
            commands::debugger::debug_step_into,
            commands::debugger::debug_step_out,
            commands::debugger::get_debug_snapshot,
            commands::debugger::fetch_debug_variable_children,
            commands::debugger::set_debug_breakpoint,
            commands::debugger::remove_debug_breakpoint,
            commands::stress::start_stress_test,
            commands::stress::stop_stress_test,
            commands::testcase::list_testcases,
            commands::testcase::create_testcase,
            commands::testcase::update_testcase,
            commands::testcase::duplicate_testcase,
            commands::testcase::delete_testcase,
            commands::testcase::move_testcase,
            commands::testcase::compare_testcase_output,
            commands::generator::validate_generator_dsl,
            commands::generator::generate_random_cases,
            commands::generator::validate_visual_generator,
            commands::generator::generate_visual_cases,
            commands::generator::load_generator_profile,
            commands::generator::save_generator_profile,
            commands::archive::list_archive_files,
            commands::archive::get_archive_file,
            commands::archive::archive_file,
            commands::archive::set_archive_favorite,
            commands::archive::bulk_update_archive,
            commands::archive::list_archive_tags,
            commands::archive::list_archive_facets,
            commands::archive::list_smart_collections,
            commands::archive::create_smart_collection,
            commands::archive::update_smart_collection,
            commands::archive::delete_smart_collection
        ])
        .run(tauri::generate_context!());

    if let Err(error) = application {
        eprintln!("LightCP failed to start: {error}");
        std::process::exit(1);
    }
}
