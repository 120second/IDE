use std::sync::atomic::{AtomicU64, Ordering};

use serde::Serialize;

#[derive(Default)]
pub struct PerformanceMetrics {
    backend_startup_duration_ms: AtomicU64,
    workspace_load_duration_ms: AtomicU64,
    ipc_event_count: AtomicU64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerformanceSnapshot {
    enabled: bool,
    backend_startup_duration_ms: u64,
    workspace_load_duration_ms: u64,
    active_process_count: usize,
    ipc_event_count: u64,
}

impl PerformanceMetrics {
    pub fn set_backend_startup_duration(&self, duration_ms: u64) {
        if cfg!(debug_assertions) {
            self.backend_startup_duration_ms
                .store(duration_ms, Ordering::Relaxed);
        }
    }

    pub fn set_workspace_load_duration(&self, duration_ms: u64) {
        if cfg!(debug_assertions) {
            self.workspace_load_duration_ms
                .store(duration_ms, Ordering::Relaxed);
        }
    }

    pub fn record_ipc_event(&self) {
        if cfg!(debug_assertions) {
            self.ipc_event_count.fetch_add(1, Ordering::Relaxed);
        }
    }

    pub fn snapshot(&self, active_process_count: usize) -> PerformanceSnapshot {
        PerformanceSnapshot {
            enabled: cfg!(debug_assertions),
            backend_startup_duration_ms: self.backend_startup_duration_ms.load(Ordering::Relaxed),
            workspace_load_duration_ms: self.workspace_load_duration_ms.load(Ordering::Relaxed),
            active_process_count,
            ipc_event_count: self.ipc_event_count.load(Ordering::Relaxed),
        }
    }
}
