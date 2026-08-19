//! Fixed testcase persistence and execution are intentionally deferred.
mod model;
mod service;

pub use model::{Testcase, TestcaseInput, TestcaseKind};
pub use service::{compare_output, create, delete, duplicate, list, move_to, update};
