export const TERMINAL_CONFIG = {
  bufferLength: 1_000_000,
  resultLength: 64_000,
  resultHeadLength: 8_000,
  maximumYieldMs: 30_000,
  defaultYieldMs: 10_000,
  columns: 120,
  rows: 30,
} as const;
