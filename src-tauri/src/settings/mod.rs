use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::Path,
};

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ThemePreference {
    #[default]
    System,
    Dark,
    Light,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ColorTheme {
    #[default]
    Signal,
    Graphite,
    Forest,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum UiDensity {
    #[default]
    Compact,
    Standard,
    Comfortable,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum BackgroundFit {
    #[default]
    Cover,
    Contain,
    Fill,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomThemeVariant {
    pub colors: BTreeMap<String, String>,
    pub syntax: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomThemeVariants {
    pub dark: CustomThemeVariant,
    pub light: CustomThemeVariant,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct CustomThemeDefinition {
    pub id: String,
    pub name: String,
    pub inherits: ColorTheme,
    pub variants: CustomThemeVariants,
}

impl Default for CustomThemeDefinition {
    fn default() -> Self {
        Self {
            id: "custom-theme".to_owned(),
            name: "自定义主题".to_owned(),
            inherits: ColorTheme::Signal,
            variants: CustomThemeVariants::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: ThemePreference,
    pub color_theme: ColorTheme,
    pub active_custom_theme: String,
    pub custom_themes: Vec<CustomThemeDefinition>,
    pub ui_density: UiDensity,
    pub background_image: String,
    pub background_image_name: String,
    pub background_image_opacity: f64,
    pub background_dim: f64,
    pub background_fit: BackgroundFit,
    pub sidebar_opacity: f64,
    pub editor_opacity: f64,
    pub surface_blur: f64,
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
            theme: ThemePreference::System,
            color_theme: ColorTheme::Signal,
            active_custom_theme: String::new(),
            custom_themes: Vec::new(),
            ui_density: UiDensity::Compact,
            background_image: String::new(),
            background_image_name: String::new(),
            background_image_opacity: 0.42,
            background_dim: 0.28,
            background_fit: BackgroundFit::Cover,
            sidebar_opacity: 0.92,
            editor_opacity: 0.96,
            surface_blur: 10.0,
            font_family: "Cascadia Code, JetBrains Mono, Consolas, monospace".to_owned(),
            font_size: 14.0,
            line_height: 1.55,
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
        self.background_image = self.background_image.trim().chars().take(4096).collect();
        self.background_image_name = self
            .background_image_name
            .trim()
            .chars()
            .take(256)
            .collect();
        self.background_image_opacity = finite_clamp(self.background_image_opacity, 0.0, 1.0, 0.42);
        self.background_dim = finite_clamp(self.background_dim, 0.0, 0.8, 0.28);
        self.sidebar_opacity = finite_clamp(self.sidebar_opacity, 0.2, 1.0, 0.92);
        self.editor_opacity = finite_clamp(self.editor_opacity, 0.2, 1.0, 0.96);
        self.surface_blur = finite_clamp(self.surface_blur, 0.0, 20.0, 10.0);
        self.font_size = finite_clamp(self.font_size, 11.0, 24.0, 14.0);
        self.line_height = finite_clamp(self.line_height, 1.2, 2.0, 1.55);
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
        self.custom_themes = sanitize_custom_themes(self.custom_themes);
        self.active_custom_theme = self
            .custom_themes
            .iter()
            .find(|theme| theme.id == self.active_custom_theme)
            .map(|theme| theme.id.clone())
            .unwrap_or_default();

        self
    }
}

fn default_keybindings() -> BTreeMap<String, String> {
    [
        ("save", "Ctrl+S"),
        ("newFile", "Ctrl+N"),
        ("quickOpen", "Ctrl+P"),
        ("commandPalette", "Ctrl+Shift+P"),
        ("closeEditor", "Ctrl+W"),
        ("nextEditor", "Ctrl+Tab"),
        ("previousEditor", "Ctrl+Shift+Tab"),
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

const THEME_COLOR_KEYS: &[&str] = &[
    "background",
    "backgroundElevated",
    "activityBackground",
    "sidebarBackground",
    "panelBackground",
    "editorBackground",
    "tabBackground",
    "tabActiveBackground",
    "inputBackground",
    "surface",
    "surfaceRaised",
    "surfaceSunken",
    "hoverBackground",
    "activeBackground",
    "textPrimary",
    "textSecondary",
    "textMuted",
    "accent",
    "accentStrong",
    "accentSoft",
    "accentContrast",
    "border",
    "borderSubtle",
    "borderStrong",
    "success",
    "warning",
    "danger",
    "focusRing",
];

const SYNTAX_COLOR_KEYS: &[&str] = &[
    "text",
    "muted",
    "activeLine",
    "selection",
    "cursor",
    "keyword",
    "type",
    "string",
    "number",
    "comment",
    "function",
    "variable",
];

fn sanitize_custom_themes(themes: Vec<CustomThemeDefinition>) -> Vec<CustomThemeDefinition> {
    let mut ids = BTreeSet::new();
    themes
        .into_iter()
        .take(24)
        .filter_map(|mut theme| {
            theme.id = sanitize_theme_id(&theme.id);
            if !ids.insert(theme.id.clone()) {
                return None;
            }
            theme.name = bounded_nonempty(&theme.name, "自定义主题", 48);
            theme.variants.dark.colors =
                sanitize_color_map(theme.variants.dark.colors, THEME_COLOR_KEYS);
            theme.variants.dark.syntax =
                sanitize_color_map(theme.variants.dark.syntax, SYNTAX_COLOR_KEYS);
            theme.variants.light.colors =
                sanitize_color_map(theme.variants.light.colors, THEME_COLOR_KEYS);
            theme.variants.light.syntax =
                sanitize_color_map(theme.variants.light.syntax, SYNTAX_COLOR_KEYS);
            Some(theme)
        })
        .collect()
}

fn sanitize_theme_id(value: &str) -> String {
    let id = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .filter(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
        .take(64)
        .collect::<String>();
    if id.is_empty() {
        "custom-theme".to_owned()
    } else {
        id
    }
}

fn sanitize_color_map(
    colors: BTreeMap<String, String>,
    allowed: &[&str],
) -> BTreeMap<String, String> {
    colors
        .into_iter()
        .filter(|(key, value)| allowed.contains(&key.as_str()) && is_theme_color(value))
        .take(allowed.len())
        .map(|(key, value)| (key, value.to_ascii_lowercase()))
        .collect()
}

fn is_theme_color(value: &str) -> bool {
    matches!(value.len(), 4 | 5 | 7 | 9)
        && value.starts_with('#')
        && value[1..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_are_sanitized_to_supported_ranges() {
        let settings = AppSettings {
            background_image: "  C:\\Pictures\\wallpaper.png  ".to_owned(),
            background_image_opacity: -2.0,
            background_dim: 5.0,
            sidebar_opacity: 0.1,
            editor_opacity: f64::NAN,
            surface_blur: 100.0,
            font_size: 3.0,
            line_height: 9.0,
            font_family: "   ".to_owned(),
            clangd_path: "  C:\\Program Files\\LLVM\\bin\\clangd.exe  ".to_owned(),
            ..AppSettings::default()
        }
        .sanitize();

        assert_eq!(settings.background_image, r"C:\Pictures\wallpaper.png");
        assert_eq!(settings.background_image_opacity, 0.0);
        assert_eq!(settings.background_dim, 0.8);
        assert_eq!(settings.sidebar_opacity, 0.2);
        assert_eq!(settings.editor_opacity, 0.96);
        assert_eq!(settings.surface_blur, 20.0);
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
        let custom_theme = CustomThemeDefinition {
            id: "contest".to_owned(),
            name: "Contest".to_owned(),
            inherits: ColorTheme::Forest,
            variants: CustomThemeVariants {
                dark: CustomThemeVariant {
                    colors: BTreeMap::from([("accent".to_owned(), "#ff3366".to_owned())]),
                    syntax: BTreeMap::from([("keyword".to_owned(), "#ffcc00".to_owned())]),
                },
                light: CustomThemeVariant::default(),
            },
        };
        let expected = AppSettings {
            theme: ThemePreference::Light,
            color_theme: ColorTheme::Forest,
            active_custom_theme: custom_theme.id.clone(),
            custom_themes: vec![custom_theme],
            ui_density: UiDensity::Comfortable,
            font_size: 17.0,
            line_height: 1.74,
            performance_mode: true,
            clangd_path: r"C:\Program Files\LLVM\bin\clangd.exe".to_owned(),
            ..AppSettings::default()
        };

        save(&path, expected).expect("settings should save");
        let loaded = load(&path).expect("settings should load");

        assert_eq!(loaded.theme, ThemePreference::Light);
        assert_eq!(loaded.color_theme, ColorTheme::Forest);
        assert_eq!(loaded.active_custom_theme, "contest");
        assert_eq!(loaded.custom_themes.len(), 1);
        assert_eq!(
            loaded.custom_themes[0]
                .variants
                .dark
                .colors
                .get("accent")
                .map(String::as_str),
            Some("#ff3366")
        );
        assert_eq!(loaded.ui_density, UiDensity::Comfortable);
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
    fn legacy_appearance_fields_migrate_to_new_defaults() {
        let legacy = r#"{
            "theme": "dark",
            "backgroundImage": "C:\\\\wallpaper.png",
            "windowOpacity": 0.16,
            "sidebarOpacity": 0.42,
            "editorOpacity": 0.5,
            "blur": 14,
            "fontFamily": "Consolas",
            "fontSize": 15,
            "lineHeight": 1.55
        }"#;
        let settings = serde_json::from_str::<AppSettings>(legacy)
            .expect("legacy settings should remain readable")
            .sanitize();

        assert_eq!(settings.theme, ThemePreference::Dark);
        assert_eq!(settings.color_theme, ColorTheme::Signal);
        assert_eq!(settings.ui_density, UiDensity::Compact);
        assert_eq!(settings.font_family, "Consolas");
    }

    #[test]
    fn custom_theme_values_are_bounded_and_invalid_colors_are_removed() {
        let settings = AppSettings {
            active_custom_theme: "contest".to_owned(),
            custom_themes: vec![CustomThemeDefinition {
                id: " Contest !! ".to_owned(),
                name: "  My Theme  ".to_owned(),
                variants: CustomThemeVariants {
                    dark: CustomThemeVariant {
                        colors: BTreeMap::from([
                            ("accent".to_owned(), "#AABBCC".to_owned()),
                            ("unknown".to_owned(), "#ffffff".to_owned()),
                            ("danger".to_owned(), "red".to_owned()),
                        ]),
                        syntax: BTreeMap::new(),
                    },
                    light: CustomThemeVariant::default(),
                },
                ..CustomThemeDefinition::default()
            }],
            ..AppSettings::default()
        }
        .sanitize();

        assert_eq!(settings.custom_themes[0].id, "contest");
        assert_eq!(settings.custom_themes[0].name, "My Theme");
        assert_eq!(
            settings.custom_themes[0]
                .variants
                .dark
                .colors
                .get("accent")
                .map(String::as_str),
            Some("#aabbcc")
        );
        assert_eq!(settings.custom_themes[0].variants.dark.colors.len(), 1);
        assert_eq!(settings.active_custom_theme, "contest");
    }
}
