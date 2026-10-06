//! Keep launched programs and compiler subprocesses in one lifetime boundary.
use crate::error::AppResult;
use std::process::Child;

#[cfg(windows)]
pub struct ProcessTree(std::os::windows::io::OwnedHandle);
#[cfg(not(windows))]
pub struct ProcessTree;

impl ProcessTree {
    #[cfg(windows)]
    pub fn attach(child: &mut Child) -> AppResult<Self> {
        use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
        use windows_sys::Win32::System::JobObjects::*;
        // SAFETY: unnamed job, valid owned handles, and correctly sized information.
        let result = unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() {
                return Self::failed(child);
            }
            let job = OwnedHandle::from_raw_handle(handle);
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(
                handle,
                JobObjectExtendedLimitInformation,
                &limits as *const _ as *const _,
                std::mem::size_of_val(&limits) as u32,
            ) == 0
            {
                return Self::failed(child);
            }
            if AssignProcessToJobObject(handle, child.as_raw_handle()) == 0
                && child.try_wait()?.is_none()
            {
                return Self::failed(child);
            }
            Self(job)
        };
        Ok(result)
    }
    #[cfg(windows)]
    fn failed(child: &mut Child) -> AppResult<Self> {
        let error = std::io::Error::last_os_error();
        let _ = child.kill();
        let _ = child.wait();
        Err(error.into())
    }
    #[cfg(not(windows))]
    pub fn attach(_child: &mut Child) -> AppResult<Self> {
        Ok(Self)
    }
    pub fn terminate(&self, child: &mut Child) {
        #[cfg(windows)]
        {
            use std::os::windows::io::AsRawHandle;
            // SAFETY: the job remains owned by this guard.
            unsafe {
                windows_sys::Win32::System::JobObjects::TerminateJobObject(
                    self.0.as_raw_handle(),
                    1,
                );
            }
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::{
        io::{BufRead, BufReader, Write},
        os::windows::process::CommandExt,
        process::{Command, Stdio},
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, WaitForSingleObject, PROCESS_QUERY_LIMITED_INFORMATION,
    };

    #[test]
    fn stopping_parent_also_terminates_its_descendants() {
        let _guard = crate::PROCESS_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut parent = Command::new("powershell.exe")
            .args(["-NoProfile", "-Command", "$null=[Console]::ReadLine(); $p=Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile','-Command','Start-Sleep -Seconds 30' -PassThru; [Console]::WriteLine($p.Id); Start-Sleep -Seconds 30"])
            .creation_flags(0x08000000)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
        let tree = ProcessTree::attach(&mut parent).unwrap();
        parent.stdin.take().unwrap().write_all(b"start\n").unwrap();
        let mut line = String::new();
        BufReader::new(parent.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let pid = line.trim().parse::<u32>().unwrap();
        // SAFETY: OpenProcess returns a new handle; the guard owns it until the wait completes.
        let descendant = unsafe {
            let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | 0x00100000, 0, pid);
            assert!(!handle.is_null());
            OwnedHandle::from_raw_handle(handle)
        };
        tree.terminate(&mut parent);
        // SAFETY: a live process handle with SYNCHRONIZE access and a bounded wait.
        assert_eq!(
            unsafe { WaitForSingleObject(descendant.as_raw_handle(), 3000) },
            0
        );
        assert!(parent.try_wait().unwrap().is_some());
    }
}
