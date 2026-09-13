use std::sync::{Arc, Mutex};

use napi::{Env, Task, bindgen_prelude::AsyncTask};
use napi_derive::napi;
use node_tester_engine::{EngineOptions, RunControl, RunResult, run_tests};

fn napi_error(error: impl std::fmt::Display) -> napi::Error {
    napi::Error::from_reason(error.to_string())
}

#[napi]
pub struct NativeExecution {
    options: Mutex<Option<EngineOptions>>,
    control: Arc<RunControl>,
}

#[napi]
impl NativeExecution {
    #[napi(constructor)]
    pub fn new(options_json: String) -> napi::Result<Self> {
        if options_json.len() > 1024 * 1024 {
            return Err(napi_error("engine options exceed 1 MiB"));
        }
        let options: EngineOptions = serde_json::from_str(&options_json)
            .map_err(|error| napi_error(format!("invalid engine options JSON: {error}")))?;
        Ok(Self {
            options: Mutex::new(Some(options)),
            control: Arc::new(RunControl::default()),
        })
    }

    #[napi(ts_return_type = "Promise<string>")]
    pub fn execute(&self) -> napi::Result<AsyncTask<ExecuteTask>> {
        let options = self
            .options
            .lock()
            .map_err(|_| napi_error("native execution lock was poisoned"))?
            .take()
            .ok_or_else(|| napi_error("this native execution has already started"))?;
        Ok(AsyncTask::new(ExecuteTask {
            options: Some(options),
            control: Arc::clone(&self.control),
        }))
    }

    #[napi]
    pub fn cancel(&self) {
        self.control.cancel();
    }
}

pub struct ExecuteTask {
    options: Option<EngineOptions>,
    control: Arc<RunControl>,
}

#[napi]
impl Task for ExecuteTask {
    type Output = RunResult;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let options = self
            .options
            .take()
            .ok_or_else(|| napi_error("native execution task was already consumed"))?;
        run_tests(options, Arc::clone(&self.control)).map_err(napi_error)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        serde_json::to_string(&output)
            .map_err(|error| napi_error(format!("cannot encode engine result: {error}")))
    }
}

#[napi]
pub fn engine_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
