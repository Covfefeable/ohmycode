export function imageReference(source: string, pageUrl: string): { local: boolean; source: string } {
  if (/^data:image\//i.test(source)) return { local: false, source };
  if (/^(?:https?:)?\/\//i.test(source)) {
    const url = new URL(source, pageUrl);
    const page = new URL(pageUrl);
    if (url.origin !== page.origin) return { local: false, source: url.href };
    return { local: true, source: decodeURIComponent(url.pathname).replace(/^\/+/, "") };
  }
  return { local: true, source: /^file:/i.test(source) ? source : decodeURIComponent(source) };
}

export function isLocalImageLink(source: string, pageUrl: string): boolean {
  if (!/\.(?:png|jpe?g|gif|webp|bmp)(?:[?#]|$)/i.test(source)) return false;
  try { return imageReference(source, pageUrl).local; }
  catch { return false; }
}
