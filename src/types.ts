export type TestStatus = "passed" | "failed" | "skipped" | "todo" | "cancelled";

export interface TestLocation {
  file?: string;
  line?: number;
  column?: number;
}

export interface TestResult {
  name: string;
  status: TestStatus;
  durationMs: number;
  nesting: number;
  location: TestLocation;
  error?: string;
  /** Failed suites are rendered but are not added to the test count. */
  isSuite?: boolean;
}

export interface CapturedOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export interface ResultCounts {
  tests: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  cancelled: number;
  suites: number;
}

export interface TestRunResult {
  engine: "rust";
  nodeVersion: string;
  protocolVersion: number;
  success: boolean;
  timedOut: boolean;
  cancelled: boolean;
  durationMs: number;
  counts: ResultCounts;
  tests: TestResult[];
  output: CapturedOutput;
}

export interface RunTestsOptions {
  files?: readonly string[];
  globPatterns?: readonly string[];
  concurrency?: number;
  testTimeoutMs?: number;
  runTimeoutMs?: number;
  namePattern?: string;
  skipPattern?: string;
  only?: boolean;
  testArgs?: readonly string[];
  maxOutputBytes?: number;
  nodePath?: string;
  nodeArgs?: readonly string[];
  cwd?: string;
  signal?: AbortSignal;
}
