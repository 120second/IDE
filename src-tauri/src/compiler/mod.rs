//! Compiler discovery and invocation are intentionally deferred.
mod model;
mod service;

pub use model::{CompileProfile, CompileRequest, CompileResult, CompilerConfig};
pub use service::compile_current_file;
