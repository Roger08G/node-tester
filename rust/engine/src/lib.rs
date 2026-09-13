#![forbid(unsafe_code)]

use std::{
    collections::HashSet,
    io::{self, BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

use command_group::{CommandGroup, GroupChild};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const PROTOCOL_VERSION: u32 = 1;
const DEFAULT_TEST_TIMEOUT_MS: u64 = 30_000;
const DEFAULT_RUN_TIMEOUT_MS: u64 = 15 * 60_000;
const DEFAULT_MAX_OUTPUT_BYTES: usize = 64 * 1024;
const MAX_OUTPUT_BYTES: usize = 64 * 1024 * 1024;
const MAX_PROTOCOL_LINE_BYTES: usize = 128 * 1024;
const MAX_PROTOCOL_BYTES: usize = 128 * 1024 * 1024;
const MAX_PROTOCOL_EVENTS: usize = 1_000_000;
const MAX_STDERR_BYTES: usize = 64 * 1024;
const MAX_TIMEOUT_MS: u64 = 7 * 24 * 60 * 60 * 1_000;
const MAX_INPUT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Error)]
pub enum EngineError {
    #[error("invalid engine options: {0}")]
    InvalidOptions(String),
    #[error("failed to start Node.js: {0}")]
    Spawn(#[source] io::Error),
    #[error("failed to communicate with the Node.js bridge: {0}")]
    Io(#[source] io::Error),
    #[error("invalid bridge protocol: {0}")]
    Protocol(String),
    #[error("Node.js bridge failed: {0}")]
    Bridge(String),
    #[error("an internal reader thread panicked")]
    ReaderPanicked,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineOptions {
    pub node_path: PathBuf,
    pub bridge_path: PathBuf,
    pub cwd: PathBuf,
    #[serde(default)]
    pub files: Vec<PathBuf>,
    #[serde(default)]
    pub glob_patterns: Vec<String>,
    pub concurrency: Option<u32>,
    #[serde(default = "default_test_timeout")]
    pub test_timeout_ms: u64,
    #[serde(default = "default_run_timeout")]
    pub run_timeout_ms: u64,
    #[serde(default = "default_max_output")]
    pub max_output_bytes: usize,
    pub name_pattern: Option<String>,
    pub skip_pattern: Option<String>,
    #[serde(default)]
    pub only: bool,
    #[serde(default)]
    pub test_args: Vec<String>,
    #[serde(default)]
    pub node_args: Vec<String>,
}

fn default_test_timeout() -> u64 {
    DEFAULT_TEST_TIMEOUT_MS
}

fn default_run_timeout() -> u64 {
    DEFAULT_RUN_TIMEOUT_MS
}

fn default_max_output() -> usize {
    DEFAULT_MAX_OUTPUT_BYTES
}

impl EngineOptions {
    pub fn validate(mut self) -> Result<Self, EngineError> {
        if self.node_path.as_os_str().is_empty() {
            return Err(EngineError::InvalidOptions(
                "nodePath cannot be empty".to_owned(),
            ));
        }
        if !self.files.is_empty() && !self.glob_patterns.is_empty() {
            return Err(EngineError::InvalidOptions(
                "files and globPatterns are mutually exclusive".to_owned(),
            ));
        }
        if self
            .concurrency
            .is_some_and(|value| value == 0 || value > 1024)
        {
            return Err(EngineError::InvalidOptions(
                "concurrency must be between 1 and 1024".to_owned(),
            ));
        }
        if self.test_timeout_ms == 0
            || self.run_timeout_ms == 0
            || self.test_timeout_ms > MAX_TIMEOUT_MS
            || self.run_timeout_ms > MAX_TIMEOUT_MS
        {
            return Err(EngineError::InvalidOptions(
                "timeouts must be between 1 millisecond and 7 days".to_owned(),
            ));
        }
        if self.max_output_bytes == 0 || self.max_output_bytes > MAX_OUTPUT_BYTES {
            return Err(EngineError::InvalidOptions(format!(
                "maxOutputBytes must be between 1 and {MAX_OUTPUT_BYTES}"
            )));
        }

        self.cwd = canonical_directory(&self.cwd, "cwd")?;
        self.bridge_path = canonical_file(&self.bridge_path, "bridgePath")?;
        let mut seen = HashSet::new();
        self.files = self
            .files
            .into_iter()
            .map(|file| {
                let file = if file.is_absolute() {
                    dunce::simplified(&file).to_path_buf()
                } else {
                    self.cwd.join(file)
                };
                canonical_file(&file, &format!("test file '{}'", file.display()))
            })
            .collect::<Result<Vec<_>, _>>()?
            .into_iter()
            .filter(|file| seen.insert(file.clone()))
            .collect();
        let input = serde_json::to_vec(&BridgeInput::from(&self))
            .map_err(|error| EngineError::InvalidOptions(error.to_string()))?;
        if input.len() >= MAX_INPUT_BYTES {
            return Err(EngineError::InvalidOptions(format!(
                "bridge configuration exceeds {MAX_INPUT_BYTES} bytes"
            )));
        }
        Ok(self)
    }
}

fn canonical_directory(path: &Path, field: &str) -> Result<PathBuf, EngineError> {
    let canonical = dunce::canonicalize(path).map_err(|error| {
        EngineError::InvalidOptions(format!("{field} is not accessible: {error}"))
    })?;
    if !canonical.is_dir() {
        return Err(EngineError::InvalidOptions(format!(
            "{field} must point to a directory"
        )));
    }
    Ok(canonical)
}

fn canonical_file(path: &Path, field: &str) -> Result<PathBuf, EngineError> {
    let canonical = dunce::canonicalize(path).map_err(|error| {
        EngineError::InvalidOptions(format!("{field} is not accessible: {error}"))
    })?;
    if !canonical.is_file() {
        return Err(EngineError::InvalidOptions(format!(
            "{field} must point to a file"
        )));
    }
    Ok(canonical)
}

#[derive(Debug, Default)]
pub struct RunControl {
    cancelled: AtomicBool,
}

impl RunControl {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TestStatus {
    Passed,
    Failed,
    Skipped,
    Todo,
    Cancelled,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestLocation {
    pub file: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub name: String,
    pub status: TestStatus,
    pub duration_ms: f64,
    pub nesting: u32,
    pub location: TestLocation,
    pub error: Option<String>,
    #[serde(default)]
    pub is_suite: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapturedOutput {
    pub stdout: String,
    pub stderr: String,
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultCounts {
    pub tests: u64,
    pub passed: u64,
    pub failed: u64,
    pub skipped: u64,
    pub todo: u64,
    pub cancelled: u64,
    pub suites: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub engine: String,
    pub node_version: String,
    pub protocol_version: u32,
    pub success: bool,
    pub timed_out: bool,
    pub cancelled: bool,
    pub duration_ms: f64,
    pub counts: ResultCounts,
    pub tests: Vec<TestResult>,
    pub output: CapturedOutput,
}

#[derive(Serialize)]
struct BridgeInput<'a> {
    protocol_version: u32,
    files: Vec<String>,
    glob_patterns: &'a [String],
    concurrency: Option<u32>,
    test_timeout_ms: u64,
    max_output_bytes: usize,
    name_pattern: &'a Option<String>,
    skip_pattern: &'a Option<String>,
    only: bool,
    test_args: &'a [String],
    node_args: &'a [String],
}

impl<'a> From<&'a EngineOptions> for BridgeInput<'a> {
    fn from(options: &'a EngineOptions) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            files: options
                .files
                .iter()
                .map(|file| file.to_string_lossy().into_owned())
                .collect(),
            glob_patterns: &options.glob_patterns,
            concurrency: options.concurrency,
            test_timeout_ms: options.test_timeout_ms,
            max_output_bytes: options.max_output_bytes,
            name_pattern: &options.name_pattern,
            skip_pattern: &options.skip_pattern,
            only: options.only,
            test_args: &options.test_args,
            node_args: &options.node_args,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum BridgeEvent {
    Ready {
        protocol_version: u32,
        node_version: String,
    },
    Test {
        name: String,
        status: TestStatus,
        duration_ms: f64,
        nesting: u32,
        file: Option<String>,
        line: Option<u32>,
        column: Option<u32>,
        error: Option<String>,
        #[serde(default)]
        is_suite: bool,
    },
    Suite,
    Output {
        stream: OutputStream,
        message: String,
        #[serde(default)]
        truncated: bool,
    },
    Summary {
        success: bool,
        counts: ResultCounts,
        duration_ms: f64,
        file: Option<String>,
    },
    Fatal {
        message: String,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
enum OutputStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Termination {
    Completed,
    TimedOut,
    Cancelled,
    ReaderFailed,
}

pub fn run_tests(
    options: EngineOptions,
    control: Arc<RunControl>,
) -> Result<RunResult, EngineError> {
    let options = options.validate()?;
    let started = Instant::now();
    if control.is_cancelled() {
        return Ok(RunResult {
            engine: "rust".to_owned(),
            node_version: "unknown".to_owned(),
            protocol_version: PROTOCOL_VERSION,
            success: false,
            timed_out: false,
            cancelled: true,
            duration_ms: 0.0,
            counts: ResultCounts::default(),
            tests: Vec::new(),
            output: CapturedOutput::default(),
        });
    }
    let mut input = serde_json::to_vec(&BridgeInput::from(&options))
        .map_err(|error| EngineError::Protocol(format!("cannot encode bridge input: {error}")))?;
    input.push(b'\n');
    let mut command = Command::new(&options.node_path);
    command
        .arg(&options.bridge_path)
        .current_dir(&options.cwd)
        .env_remove("NODE_TEST_CONTEXT")
        .env_remove("NODE_TEST_WORKER_ID")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut group = command.group();
    #[cfg(windows)]
    group.kill_on_drop(true).creation_flags(0x0800_0000);
    let mut child = group.spawn().map_err(EngineError::Spawn)?;
    let stdout = child
        .inner()
        .stdout
        .take()
        .ok_or_else(|| EngineError::Protocol("bridge stdout was not captured".to_owned()))?;
    let stderr = child
        .inner()
        .stderr
        .take()
        .ok_or_else(|| EngineError::Protocol("bridge stderr was not captured".to_owned()))?;
    let mut stdin = child
        .inner()
        .stdin
        .take()
        .ok_or_else(|| EngineError::Protocol("bridge stdin was not captured".to_owned()))?;
    let io_failed = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&io_failed);
    let stdout_reader = thread::spawn(move || {
        let result = read_protocol(stdout, options.max_output_bytes);
        if result.is_err() {
            flag.store(true, Ordering::Release);
        }
        result
    });
    let flag = Arc::clone(&io_failed);
    let stderr_reader = thread::spawn(move || {
        let result = read_bounded(stderr, MAX_STDERR_BYTES);
        if result.is_err() {
            flag.store(true, Ordering::Release);
        }
        result
    });
    let flag = Arc::clone(&io_failed);
    let stdin_writer = thread::spawn(move || {
        let result = stdin.write_all(&input).map_err(EngineError::Io);
        if result.is_err() {
            flag.store(true, Ordering::Release);
        }
        result
    });
    let waited = wait_for_child(
        &mut child,
        Duration::from_millis(options.run_timeout_ms),
        started,
        &control,
        &io_failed,
    );
    // A leader can exit while descendants still hold its pipes open. Always
    // terminate the group before waiting for any I/O worker to finish.
    let _ = child.kill();
    let cleanup_started = Instant::now();
    while !(stdout_reader.is_finished()
        && stderr_reader.is_finished()
        && stdin_writer.is_finished())
    {
        if cleanup_started.elapsed() >= Duration::from_secs(2) {
            return Err(EngineError::Protocol(
                "bridge pipes remained open after process-group cleanup".to_owned(),
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
    let (status, termination) = waited?;
    let events = stdout_reader
        .join()
        .map_err(|_| EngineError::ReaderPanicked)?;
    let stderr = stderr_reader
        .join()
        .map_err(|_| EngineError::ReaderPanicked)??;
    let written = stdin_writer
        .join()
        .map_err(|_| EngineError::ReaderPanicked)?;
    let events = match events {
        Ok(events) => events,
        Err(_) if matches!(termination, Termination::TimedOut | Termination::Cancelled) => {
            ProtocolState::default()
        }
        Err(error) => return Err(error),
    };
    if !matches!(termination, Termination::TimedOut | Termination::Cancelled) {
        written?;
    }

    aggregate(
        events,
        status,
        termination,
        started.elapsed(),
        options.max_output_bytes,
        stderr,
    )
}

fn wait_for_child(
    child: &mut GroupChild,
    timeout: Duration,
    started: Instant,
    control: &RunControl,
    io_failed: &AtomicBool,
) -> Result<(ExitStatus, Termination), EngineError> {
    loop {
        if control.is_cancelled() {
            return terminate(child).map(|status| (status, Termination::Cancelled));
        }
        if started.elapsed() >= timeout {
            return terminate(child).map(|status| (status, Termination::TimedOut));
        }
        if io_failed.load(Ordering::Acquire) {
            return terminate(child).map(|status| (status, Termination::ReaderFailed));
        }
        if let Some(status) = child.inner().try_wait().map_err(EngineError::Io)? {
            return Ok((status, Termination::Completed));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn terminate(child: &mut GroupChild) -> Result<ExitStatus, EngineError> {
    if let Err(error) = child.kill() {
        if let Some(status) = child.inner().try_wait().map_err(EngineError::Io)? {
            return Ok(status);
        }
        return Err(EngineError::Io(error));
    }
    let cleanup_started = Instant::now();
    loop {
        if let Some(status) = child.inner().try_wait().map_err(EngineError::Io)? {
            return Ok(status);
        }
        if cleanup_started.elapsed() >= Duration::from_secs(2) {
            return Err(EngineError::Protocol(
                "bridge did not exit after process-group termination".to_owned(),
            ));
        }
        thread::sleep(Duration::from_millis(10));
    }
}

fn read_protocol(reader: impl Read, max_output_bytes: usize) -> Result<ProtocolState, EngineError> {
    let mut state = ProtocolState::default();
    let mut reader = BufReader::new(reader);
    let mut line = Vec::new();
    let mut total_bytes = 0_usize;
    let mut event_count = 0_usize;
    loop {
        line.clear();
        // Take limits the allocation before a newline arrives, including when
        // the child writes an unterminated, arbitrarily large protocol line.
        let read = reader
            .by_ref()
            .take((MAX_PROTOCOL_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
            .map_err(EngineError::Io)?;
        if read == 0 {
            break;
        }
        total_bytes = total_bytes.saturating_add(read);
        if line.last() == Some(&b'\n') {
            line.pop();
        }
        if line.len() > MAX_PROTOCOL_LINE_BYTES {
            return Err(EngineError::Protocol(format!(
                "a protocol line exceeded {MAX_PROTOCOL_LINE_BYTES} bytes"
            )));
        }
        if total_bytes > MAX_PROTOCOL_BYTES {
            return Err(EngineError::Protocol(format!(
                "protocol output exceeded {MAX_PROTOCOL_BYTES} bytes"
            )));
        }
        if line.is_empty() {
            continue;
        }
        event_count += 1;
        if event_count > MAX_PROTOCOL_EVENTS {
            return Err(EngineError::Protocol(format!(
                "the bridge emitted more than {MAX_PROTOCOL_EVENTS} events"
            )));
        }
        let event = serde_json::from_slice(&line)
            .map_err(|error| EngineError::Protocol(format!("invalid JSON event: {error}")))?;
        state.push(event, max_output_bytes)?;
    }
    Ok(state)
}

struct BoundedBytes {
    bytes: Vec<u8>,
    truncated: bool,
}

fn read_bounded(mut reader: impl Read, max_bytes: usize) -> Result<BoundedBytes, EngineError> {
    let mut bytes = Vec::with_capacity(max_bytes.min(8 * 1024));
    let mut buffer = [0_u8; 8 * 1024];
    let mut truncated = false;
    loop {
        let read = reader.read(&mut buffer).map_err(EngineError::Io)?;
        if read == 0 {
            break;
        }
        let retained = read.min(max_bytes.saturating_sub(bytes.len()));
        bytes.extend_from_slice(&buffer[..retained]);
        truncated |= retained < read;
    }
    Ok(BoundedBytes { bytes, truncated })
}

#[derive(Debug, Default)]
struct ProtocolState {
    ready: Option<String>,
    tests: Vec<TestResult>,
    suites: u64,
    output: CapturedOutput,
    retained_output_bytes: usize,
    final_summary: Option<(bool, ResultCounts, f64)>,
    fatal: Option<String>,
}

impl ProtocolState {
    fn push(&mut self, event: BridgeEvent, max_output_bytes: usize) -> Result<(), EngineError> {
        if self.final_summary.is_some() {
            return Err(EngineError::Protocol(
                "event received after the final summary".to_owned(),
            ));
        }
        if self.ready.is_none()
            && !matches!(event, BridgeEvent::Ready { .. } | BridgeEvent::Fatal { .. })
        {
            return Err(EngineError::Protocol(
                "event received before the handshake".to_owned(),
            ));
        }
        match event {
            BridgeEvent::Ready {
                protocol_version,
                node_version,
            } => {
                if self.ready.is_some() || protocol_version != PROTOCOL_VERSION {
                    return Err(EngineError::Protocol(format!(
                        "expected protocol {PROTOCOL_VERSION}, got {protocol_version}"
                    )));
                }
                self.ready = Some(node_version);
            }
            BridgeEvent::Test {
                name,
                status,
                duration_ms,
                nesting,
                file,
                line,
                column,
                error,
                is_suite,
            } => {
                if !duration_ms.is_finite() || duration_ms < 0.0 || nesting > 128 {
                    return Err(EngineError::Protocol(
                        "invalid test duration or nesting".to_owned(),
                    ));
                }
                self.tests.push(TestResult {
                    name,
                    status,
                    duration_ms,
                    nesting,
                    location: TestLocation { file, line, column },
                    error,
                    is_suite,
                });
            }
            BridgeEvent::Suite => self.suites += 1,
            BridgeEvent::Output {
                stream,
                message,
                truncated,
            } => {
                let retained = retain_utf8(&message, max_output_bytes - self.retained_output_bytes);
                self.retained_output_bytes += retained.len();
                self.output.truncated |= truncated || retained.len() < message.len();
                match stream {
                    OutputStream::Stdout => self.output.stdout.push_str(retained),
                    OutputStream::Stderr => self.output.stderr.push_str(retained),
                }
            }
            BridgeEvent::Summary {
                success,
                counts,
                duration_ms,
                file,
            } => {
                if !duration_ms.is_finite() || duration_ms < 0.0 {
                    return Err(EngineError::Protocol("invalid summary duration".to_owned()));
                }
                if file.is_none() {
                    self.final_summary = Some((success, counts, duration_ms));
                }
            }
            BridgeEvent::Fatal { message } => self.fatal = Some(message),
        }
        Ok(())
    }
}

fn aggregate(
    state: ProtocolState,
    status: ExitStatus,
    termination: Termination,
    elapsed: Duration,
    max_output_bytes: usize,
    bridge_stderr: BoundedBytes,
) -> Result<RunResult, EngineError> {
    let ProtocolState {
        ready,
        tests,
        suites,
        mut output,
        retained_output_bytes,
        final_summary,
        fatal,
    } = state;

    if termination == Termination::Completed {
        if let Some(message) = fatal {
            return Err(EngineError::Bridge(message));
        }
        if !status.success() {
            let stderr = String::from_utf8_lossy(&bridge_stderr.bytes);
            return Err(EngineError::Bridge(if stderr.trim().is_empty() {
                format!("bridge exited with status {status}")
            } else {
                stderr.trim().to_owned()
            }));
        }
    }

    let node_version = match (ready, termination) {
        (Some(node_version), _) => node_version,
        (None, Termination::Completed) => {
            return Err(EngineError::Protocol(
                "the bridge did not complete its handshake".to_owned(),
            ));
        }
        (None, Termination::TimedOut | Termination::Cancelled | Termination::ReaderFailed) => {
            "unknown".to_owned()
        }
    };
    if !bridge_stderr.bytes.is_empty() {
        let message = String::from_utf8_lossy(&bridge_stderr.bytes);
        let retained = retain_utf8(&message, max_output_bytes - retained_output_bytes);
        output.stderr.push_str(retained);
        output.truncated |= bridge_stderr.truncated || retained.len() < message.len();
    }
    let derived = derive_counts(&tests, suites);
    if termination == Termination::Completed && final_summary.is_none() {
        return Err(EngineError::Protocol(
            "the bridge did not emit a final summary".to_owned(),
        ));
    }
    let summary = final_summary;
    let counts = merge_counts(&derived, summary.as_ref().map(|item| &item.1));
    let native_success = summary.as_ref().is_none_or(|item| item.0);
    let duration_ms = if termination == Termination::Completed {
        summary.map_or(elapsed.as_secs_f64() * 1_000.0, |item| item.2)
    } else {
        elapsed.as_secs_f64() * 1_000.0
    };

    output.truncated |= bridge_stderr.truncated;
    Ok(RunResult {
        engine: "rust".to_owned(),
        node_version,
        protocol_version: PROTOCOL_VERSION,
        success: termination == Termination::Completed
            && counts.failed == 0
            && counts.cancelled == 0
            && !tests
                .iter()
                .any(|test| matches!(test.status, TestStatus::Failed | TestStatus::Cancelled))
            && native_success,
        timed_out: termination == Termination::TimedOut,
        cancelled: termination == Termination::Cancelled,
        duration_ms,
        counts,
        tests,
        output,
    })
}

fn retain_utf8(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut boundary = max_bytes;
    while boundary > 0 && !value.is_char_boundary(boundary) {
        boundary -= 1;
    }
    &value[..boundary]
}

fn derive_counts(tests: &[TestResult], suites: u64) -> ResultCounts {
    let mut counts = ResultCounts {
        tests: tests.iter().filter(|test| !test.is_suite).count() as u64,
        suites,
        ..ResultCounts::default()
    };
    for test in tests {
        if test.is_suite {
            continue;
        }
        match test.status {
            TestStatus::Passed => counts.passed += 1,
            TestStatus::Failed => counts.failed += 1,
            TestStatus::Skipped => counts.skipped += 1,
            TestStatus::Todo => counts.todo += 1,
            TestStatus::Cancelled => counts.cancelled += 1,
        }
    }
    counts
}

fn merge_counts(derived: &ResultCounts, native: Option<&ResultCounts>) -> ResultCounts {
    let Some(native) = native else {
        return derived.clone();
    };
    ResultCounts {
        tests: native.tests.max(derived.tests),
        passed: native.passed.max(derived.passed),
        failed: native.failed.max(derived.failed),
        skipped: native.skipped.max(derived.skipped),
        todo: native.todo.max(derived.todo),
        cancelled: native.cancelled.max(derived.cancelled),
        suites: native.suites.max(derived.suites),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace_root() -> PathBuf {
        dunce::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")).unwrap()
    }

    fn options_for(fixture: &str) -> EngineOptions {
        let root = workspace_root();
        EngineOptions {
            node_path: PathBuf::from("node"),
            bridge_path: root.join("runtime/node-test-bridge.mjs"),
            cwd: root.clone(),
            files: vec![root.join("test/fixtures").join(fixture)],
            glob_patterns: Vec::new(),
            concurrency: Some(1),
            test_timeout_ms: 1_000,
            run_timeout_ms: 5_000,
            max_output_bytes: 1024,
            name_pattern: None,
            skip_pattern: None,
            only: false,
            test_args: Vec::new(),
            node_args: Vec::new(),
        }
    }

    #[test]
    fn validates_mutually_exclusive_inputs() {
        let mut options = options_for("passing.test.mjs");
        options.glob_patterns.push("test/**/*.test.mjs".to_owned());
        let error = options.validate().unwrap_err();
        assert!(error.to_string().contains("mutually exclusive"));
    }

    #[test]
    fn executes_a_passing_node_test() {
        let result = run_tests(
            options_for("passing.test.mjs"),
            Arc::new(RunControl::default()),
        )
        .unwrap();
        assert!(result.success);
        assert_eq!(result.engine, "rust");
        assert_eq!(result.counts.tests, 1);
        assert_eq!(result.counts.passed, 1);
    }

    #[test]
    fn preserves_native_test_states() {
        let result = run_tests(
            options_for("mixed.test.mjs"),
            Arc::new(RunControl::default()),
        )
        .unwrap();
        assert!(!result.success);
        assert_eq!(result.counts.tests, 4);
        assert_eq!(result.counts.failed, 1);
        assert_eq!(result.counts.skipped, 1);
        assert_eq!(result.counts.todo, 1);
    }

    #[test]
    fn enforces_the_global_timeout() {
        let mut options = options_for("hanging.test.mjs");
        options.test_timeout_ms = 5_000;
        options.run_timeout_ms = 100;
        let result = run_tests(options, Arc::new(RunControl::default())).unwrap();
        assert!(result.timed_out);
        assert!(!result.success);
    }

    #[test]
    fn accepts_cancellation_before_the_bridge_handshake() {
        let control = Arc::new(RunControl::default());
        control.cancel();
        let result = run_tests(options_for("hanging.test.mjs"), control).unwrap();
        assert!(result.cancelled);
        assert!(!result.success);
    }

    #[test]
    fn bounds_captured_output() {
        let mut options = options_for("output.test.mjs");
        options.max_output_bytes = 512;
        let result = run_tests(options, Arc::new(RunControl::default())).unwrap();
        assert_eq!(result.output.stdout.len(), 512);
        assert!(result.output.truncated);
    }

    fn bridge_options(name: &str) -> EngineOptions {
        let mut options = options_for("passing.test.mjs");
        options.bridge_path = workspace_root().join("test/bridges").join(name);
        options
    }

    #[test]
    fn rejects_missing_files_before_spawning() {
        let error = options_for("this-file-does-not-exist.test.mjs")
            .validate()
            .unwrap_err();
        assert!(error.to_string().contains("test file"));
        assert!(error.to_string().contains("not accessible"));
    }

    #[test]
    fn bounds_an_unterminated_protocol_line_before_allocating_it() {
        let error = read_protocol(io::repeat(b'x'), 128).unwrap_err();
        assert!(error.to_string().contains("protocol line exceeded"));
    }

    #[test]
    fn aggregates_output_within_budget_as_events_arrive() {
        let mut state = ProtocolState::default();
        state
            .push(
                BridgeEvent::Ready {
                    protocol_version: 1,
                    node_version: "24".to_owned(),
                },
                128,
            )
            .unwrap();
        for _ in 0..1_000 {
            state
                .push(
                    BridgeEvent::Output {
                        stream: OutputStream::Stdout,
                        message: "x".repeat(4096),
                        truncated: false,
                    },
                    128,
                )
                .unwrap();
        }
        assert_eq!(state.output.stdout.len(), 128);
        assert_eq!(state.retained_output_bytes, 128);
        assert!(state.output.truncated);
    }

    #[test]
    fn rejects_a_completed_bridge_without_its_final_summary() {
        let error = run_tests(
            bridge_options("missing-summary.mjs"),
            Arc::new(RunControl::default()),
        )
        .unwrap_err();
        assert!(error.to_string().contains("final summary"));
    }

    #[test]
    fn kills_a_bridge_immediately_when_protocol_reading_fails() {
        let started = Instant::now();
        let error = run_tests(
            bridge_options("invalid.mjs"),
            Arc::new(RunControl::default()),
        )
        .unwrap_err();
        assert!(error.to_string().contains("protocol line exceeded"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn timeout_includes_a_blocked_configuration_writer() {
        let mut options = bridge_options("no-read.mjs");
        options.test_args.push("x".repeat(512 * 1024));
        options.run_timeout_ms = 100;
        let started = Instant::now();
        let result = run_tests(options, Arc::new(RunControl::default())).unwrap();
        assert!(result.timed_out);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn cleans_descendants_holding_pipes_after_the_leader_exits() {
        let started = Instant::now();
        let result = run_tests(
            bridge_options("orphan-pipes.mjs"),
            Arc::new(RunControl::default()),
        )
        .unwrap();
        assert!(result.success);
        assert!(started.elapsed() < Duration::from_secs(3));
    }

    #[test]
    fn rejects_oversized_configuration_before_spawning() {
        let mut options = bridge_options("no-read.mjs");
        options.test_args.push("x".repeat(MAX_INPUT_BYTES));
        let error = options.validate().unwrap_err();
        assert!(error.to_string().contains("configuration exceeds"));
    }

    #[test]
    fn rejects_extreme_nesting_from_the_protocol() {
        let events = concat!(
            "{\"type\":\"ready\",\"protocol_version\":1,\"node_version\":\"24\"}\n",
            "{\"type\":\"test\",\"name\":\"test\",\"status\":\"passed\",\"duration_ms\":0,\"nesting\":4294967295}\n"
        );
        let error = read_protocol(events.as_bytes(), 128).unwrap_err();
        assert!(error.to_string().contains("nesting"));
    }
}
