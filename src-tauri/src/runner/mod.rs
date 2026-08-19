//! Process execution and lifecycle management are intentionally deferred.
mod model;
mod service;

pub use model::{RunRequest, RunResult, RunStatus, RunnerOutputBatch};
pub use service::RunnerManager;
