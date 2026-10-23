/** Keep Chromium's platform/version, removing only Electron's added product tokens. */
export function browserUserAgent(userAgent: string, applicationName: string): string {
  const product = applicationName.replaceAll(" ", "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return userAgent.replace(new RegExp(`\\s(?:Electron|${product})/\\S+`, "g"), "");
}
