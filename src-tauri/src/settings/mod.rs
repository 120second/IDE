use std::{collections::BTreeMap, fs, path::Path};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundEffect {
    #[default]
    Transparent,
    Acrylic,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: ThemePreference,
    pub background_image: String,
    pub background_opacity: f64,
    pub background_effect: BackgroundEffect,
    pub window_opacity: f64,
    pub sidebar_opacity: f64,
    pub editor_opacity: f64,
    pub blur: f64,
    pub font_family: String,
    pub font_size: f64,
    pub line_height: f64,
    pub performance_mode: bool,
    pub compiler_path: String,
    pub gdb_path: String,
    pub clangd_path: String,
    pub compiler_standard: String,
    pub release_args: Vec<String>,
    pub debug_args: Vec<String>,
    pub run_timeout_ms: u64,
    pub max_output_bytes: usize,
    pub keybindings: BTreeMap<String, String>,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::Dark,
            background_image: String::new(),
            background_opacity: 0.18,
            background_effect: BackgroundEffect::Transparent,
            window_opacity: 0.32,
            sidebar_opacity: 0.96,
            editor_opacity: 0.98,
            blur: 12.0,
            font_family: "JetBrains Mono, Cascadia Code, Consolas, monospace".to_owned(),
            font_size: 14.0,
            line_height: 1.62,
            performance_mode: false,
            compiler_path: "g++".to_owned(),
            gdb_path: "gdb".to_owned(),
            clangd_path: String::new(),
            compiler_standard: "c++20".to_owned(),
            release_args: vec!["-O2".to_owned()],
            debug_args: vec!["-g".to_owned(), "-O0".to_owned()],
            run_timeout_ms: 2_000,
            max_output_bytes: 2 * 1024 * 1024,
            keybindings: default_keybindings(),
        }
    }
}

impl AppSettings {
    pub fn sanitize(mut self) -> Self {
        self.background_image = self.background_image.trim().chars().take(2048).collect();
        self.background_opacity = finite_clamp(self.background_opacity, 0.0, 1.0, 0.18);
        self.window_opacity = finite_clamp(self.window_opacity, 0.0, 1.0, 0.32);
        self.sidebar_opacity = finite_clamp(self.sidebar_opacity, 0.0, 1.0, 0.96);
        self.editor_opacity = finite_clamp(self.editor_opacity, 0.0, 1.0, 0.98);
        self.blur = finite_clamp(self.blur, 0.0, 24.0, 12.0);
        self.font_size = finite_clamp(self.font_size, 11.0, 24.0, 14.0);
        self.line_height = finite_clamp(self.line_height, 1.2, 2.0, 1.62);
        self.run_timeout_ms = self.run_timeout_ms.clamp(100, 60_000);
        self.max_output_bytes = self.max_output_bytes.clamp(64 * 1024, 16 * 1024 * 1024);

        let font_family = self.font_family.trim();
        self.font_family = if font_family.is_empty() {
            AppSettings::default().font_family
        } else {
            font_family.chars().take(256).collect()
        };

        self.compiler_path = bounded_nonempty(&self.compiler_path, "g++", 2048);
        self.gdb_path = bounded_nonempty(&self.gdb_path, "gdb", 2048);
        self.clangd_path = self.clangd_path.trim().chars().take(2048).collect();
        self.compiler_standard = bounded_nonempty(&self.compiler_standard, "c++20", 32);
        self.release_args = sanitize_arguments(self.release_args, &["-O2"]);
        self.debug_args = sanitize_arguments(self.debug_args, &["-g", "-O0"]);
        self.keybindings = sanitize_keybindings(self.keybindings);

        self
    }
}

fn default_keybindings() -> BTreeMap<String, String> {
    [
        ("save", "Ctrl+S"),
        ("toggleSidebar", "Ctrl+B"),
        ("quickTemplate", "Ctrl+Alt+T"),
        ("quickArchive", "Ctrl+Shift+A"),
        ("runCurrent", "F5"),
        ("runAll", "F6"),
        ("stress", "F7"),
        ("debug", "F8"),
        ("togglePanel", "Ctrl+J"),
    ]
    .into_iter()
    .map(|(key, value)| (key.to_owned(), value.to_owned()))
    .collect()
}

fn sanitize_keybindings(mut value: BTreeMap<String, String>) -> BTreeMap<String, String> {
    default_keybindings()
        .into_iter()
        .map(|(key, fallback)| {
            let shortcut = value
                .remove(&key)
                .map(|candidate| candidate.trim().chars().take(64).collect::<String>())
                .filter(|candidate| !candidate.is_empty())
                .unwrap_or(fallback);
            (key, shortcut)
        })
        .collect()
}

fn bounded_nonempty(value: &str, fallback: &str, limit: usize) -> String {
    let value = value.trim();
    if value.is_empty() {
        fallback.to_owned()
    } else {
        value.chars().take(limit).collect()
    }
}

fn sanitize_arguments(arguments: Vec<String>, fallback: &[&str]) -> Vec<String> {
    let arguments = arguments
        .into_iter()
        .map(|argument| argument.trim().chars().take(256).collect::<String>())
        .filter(|argument| !argument.is_empty())
        .take(32)
        .collect::<Vec<_>>();
    if arguments.is_empty() {
        fallback
            .iter()
            .map(|argument| (*argument).to_owned())
            .collect()
    } else {
        arguments
    }
}

fn finite_clamp(value: f64, minimum: f64, maximum: f64, fallback: f64) -> f64 {
    if value.is_finite() {
        value.clamp(minimum, maximum)
    } else {
        fallback
    }
}

pub fn load(path: &Path) -> AppResult<AppSettings> {
    if !path.exists() {
        return Ok(AppSettings::default());
    }

    let bytes = fs::read(path)?;
    let settings = serde_json::from_slice::<AppSettings>(&bytes).map_err(|error| {
        AppError::Configuration(format!(
            "failed to parse settings file {}: {error}",
            path.display()
        ))
    })?;

    Ok(settings.sanitize())
}

pub fn save(path: &Path, settings: AppSettings) -> AppResult<AppSettings> {
    let settings = settings.sanitize();
    let bytes = serde_json::to_vec_pretty(&settings).map_err(|error| {
        AppError::Internal(format!("failed to serialize application settings: {error}"))
    })?;
    if fs::read(path).ok().as_deref() != Some(bytes.as_slice()) {
        fs::write(path, bytes)?;
    }
    Ok(settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_are_sanitized_to_supported_ranges() {
        let settings = AppSettings {
            background_opacity: -2.0,
            window_opacity: -1.0,
            sidebar_opacity: 4.0,
            editor_opacity: f64::NAN,
            blur: 100.0,
            font_size: 3.0,
            line_height: 9.0,
            font_family: "   ".to_owned(),
            clangd_path: "  C:\\Program Files\\LLVM\\bin\\clangd.exe  ".to_owned(),
            ..AppSettings::default()
        }
        .sanitize();

        assert_eq!(settings.background_opacity, 0.0);
        assert_eq!(settings.window_opacity, 0.0);
        assert_eq!(settings.sidebar_opacity, 1.0);
        assert_eq!(settings.editor_opacity, 0.98);
        assert_eq!(settings.blur, 24.0);
        assert_eq!(settings.font_size, 11.0);
        assert_eq!(settings.line_height, 2.0);
        assert!(!settings.font_family.is_empty());
        assert_eq!(settings.compiler_path, "g++");
        assert_eq!(
            settings.clangd_path,
            r"C:\Program Files\LLVM\bin\clangd.exe"
        );
        assert_eq!(settings.run_timeout_ms, 2_000);
        assert_eq!(
            settings.keybindings.get("debug").map(String::as_str),
            Some("F8")
        );
    }

    #[test]
    fn settings_survive_a_save_and_load_roundtrip() {
        let file_name = format!(
            "lightcp-settings-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be after the Unix epoch")
                .as_nanos()
        );
        let path = std::env::temp_dir().join(file_name);
        let expected = AppSettings {
            theme: ThemePreference::Light,
            background_effect: BackgroundEffect::Acrylic,
            window_opacity: 0.44,
            font_size: 17.0,
            line_height: 1.74,
            performance_mode: true,
            clangd_path: r"C:\Program Files\LLVM\bin\clangd.exe".to_owned(),
            ..AppSettings::default()
        };

        save(&path, expected).expect("settings should save");
        let loaded = load(&path).expect("settings should load");

        assert!(matches!(loaded.theme, ThemePreference::Light));
        assert!(matches!(
            loaded.background_effect,
            BackgroundEffect::Acrylic
        ));
        assert_eq!(loaded.window_opacity, 0.44);
        assert_eq!(loaded.font_size, 17.0);
        assert_eq!(loaded.line_height, 1.74);
        assert!(loaded.performance_mode);
        assert_eq!(loaded.clangd_path, r"C:\Program Files\LLVM\bin\clangd.exe");
        assert_eq!(
            loaded.keybindings.get("stress").map(String::as_str),
            Some("F7")
        );

        fs::remove_file(path).expect("temporary settings file should be removable");
    }

    #[test]
    fn transparent_appearance_values_remain_available() {
        let settings = AppSettings {
            window_opacity: 0.0,
            sidebar_opacity: 0.0,
            editor_opacity: 0.0,
            ..AppSettings::default()
        }
        .sanitize();

        assert_eq!(settings.window_opacity, 0.0);
        assert_eq!(settings.sidebar_opacity, 0.0);
        assert_eq!(settings.editor_opacity, 0.0);
    }
}
