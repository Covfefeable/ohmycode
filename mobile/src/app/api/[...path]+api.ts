const target = (process.env.OHMYCODE_DEV_API_URL ?? "http://127.0.0.1:8765").replace(/\/+$/, "");

async function proxy(request: Request, context: { path: string[] }) {
  if (!__DEV__) return new Response(null, { status: 404 });
  const incoming = new URL(request.url);
  const url = `${target}/api/${context.path.join("/")}${incoming.search}`;
  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");
  const response = await fetch(url, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
  });
  return new Response(response.body, { headers: response.headers, status: response.status });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
