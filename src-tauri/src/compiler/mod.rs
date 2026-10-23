//! Compiler discovery and invocation are intentionally deferred.
mod cache;
mod dependencies;
mod diagnostics;
mod model;
mod service;
mod toolchain;

pub use model::{
    CompileDependency, CompileDiagnostic, CompileProfile, CompileRequest, CompileResult,
    CompilerConfig,
};
pub use service::{compile_current_file, compile_with_stop, CompilerManager};
