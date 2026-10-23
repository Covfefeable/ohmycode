export const SENSITIVE_FIELD = /auth|cookie|token|secret|password|api[-_]?key|signature/i;

export function redactUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  for (const key of [...url.searchParams.keys()]) if (SENSITIVE_FIELD.test(key)) url.searchParams.set(key, "[REDACTED]");
  url.hash = "";
  return url.href.slice(0, 4000);
}
