//! Compiler discovery and invocation are intentionally deferred.
mod diagnostics;
mod model;
mod service;

pub use model::{CompileDiagnostic, CompileProfile, CompileRequest, CompileResult, CompilerConfig};
pub use service::{compile_current_file, compile_with_stop, CompilerManager};
