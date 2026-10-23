/** Address-bar input only; agent navigation continues to require an explicit URL. */
export function browserAddress(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  const hostWithPort = /^[^/\s:]+:\d+(?:[/?#]|$)/.test(value);
  if (/^[a-z][a-z\d+.-]*:/i.test(value) && !hostWithPort) return value;
  const authority = value.split(/[/?#]/, 1)[0];
  if (!/\s/.test(value) && (authority.includes(".") || /^localhost(?::\d+)?$/i.test(authority) || authority.startsWith("["))) {
    try { return new URL(`https://${value}`).href; }
    catch { /* Not a valid address: search the original input. */ }
  }
  return `https://www.baidu.com/s?wd=${encodeURIComponent(value)}`;
}
