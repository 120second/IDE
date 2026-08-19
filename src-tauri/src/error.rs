use serde::Serialize;
use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("filesystem error: {0}")]
    FileSystem(#[from] std::io::Error),

    #[error("filesystem error: {0}")]
    FileSystemOperation(String),

    #[error("database error: {0}")]
    Database(#[from] rusqlite::Error),

    #[error("process error: {0}")]
    Process(String),

    #[error("compiler not found: {0}")]
    CompilerNotFound(String),

    #[error("process could not start: {0}")]
    ProcessStart(String),

    #[error("configuration error: {0}")]
    Configuration(String),

    #[error("internal error: {0}")]
    Internal(String),
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCategory {
    FileSystem,
    Database,
    Process,
    Configuration,
    Internal,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub category: ErrorCategory,
    pub code: &'static str,
    pub user_message: String,
    pub technical_message: String,
}

impl From<AppError> for CommandError {
    fn from(error: AppError) -> Self {
        let (category, code, user_message) = match &error {
            AppError::FileSystem(_) | AppError::FileSystemOperation(_) => (
                ErrorCategory::FileSystem,
                "FILE_SYSTEM_ERROR",
                "LightCP 无法访问所需的文件或目录。",
            ),
            AppError::Database(_) => (
                ErrorCategory::Database,
                "DATABASE_ERROR",
                "LightCP 无法初始化本地数据库。",
            ),
            AppError::Process(_) => (
                ErrorCategory::Process,
                "PROCESS_ERROR",
                "LightCP 无法完成请求的进程操作。",
            ),
            AppError::CompilerNotFound(_) => (
                ErrorCategory::Process,
                "COMPILER_NOT_FOUND",
                "找不到已配置的 C++ 编译器。",
            ),
            AppError::ProcessStart(_) => (
                ErrorCategory::Process,
                "PROCESS_START_FAILED",
                "LightCP 无法启动请求的程序。",
            ),
            AppError::Configuration(_) => (
                ErrorCategory::Configuration,
                "CONFIGURATION_ERROR",
                "LightCP 配置不可用或无效。",
            ),
            AppError::Internal(_) => (
                ErrorCategory::Internal,
                "INTERNAL_ERROR",
                "LightCP 遇到了内部错误。",
            ),
        };

        Self {
            category,
            code,
            user_message: user_message.to_owned(),
            technical_message: error.to_string(),
        }
    }
}
