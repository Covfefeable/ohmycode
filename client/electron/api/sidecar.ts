import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { app } from "electron";
import { API_URL, isLocalApiUrl } from "../config.js";

let apiProcess: ChildProcess | undefined;
const REQUIRED_CAPABILITIES = ["auth", "projects", "settings", "agent-runs", "token-usage", "multi-agent"];

function apiDirectory(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "api")
    : path.resolve(app.getAppPath(), "../api");
}

function apiLaunch(apiRoot: string): { executable: string; args: string[] } {
  const virtualEnvironmentPython = process.platform === "win32"
    ? path.join(apiRoot, ".venv", "Scripts", "python.exe")
    : path.join(apiRoot, ".venv", "bin", "python");
  const flaskArgs = [
    "-m", "flask", "--app", "manage:app", "run",
    "--host", "127.0.0.1", "--port", "8765", "--no-reload", "--no-debugger",
  ];
  if (existsSync(virtualEnvironmentPython)) {
    return { executable: virtualEnvironmentPython, args: flaskArgs };
  }
  return {
    executable: process.env.OHMYCODE_UV_PATH ?? "uv",
    args: ["run", "python", ...flaskArgs],
  };
}

async function inspectRunningApi(): Promise<"compatible" | "incompatible" | "unresponsive" | "offline"> {
  try {
    const response = await fetch(`${API_URL}/api/health`, { signal: AbortSignal.timeout(3_000) });
    if (!response.ok) return "offline";
    const payload = (await response.json()) as { capabilities?: string[] };
    return REQUIRED_CAPABILITIES.every((capability) => payload.capabilities?.includes(capability))
      ? "compatible"
      : "incompatible";
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") return "unresponsive";
    return "offline";
  }
}

export async function startApiSidecar(): Promise<void> {
  if (process.env.OHMYCODE_MANAGE_API === "false" || !isLocalApiUrl()) return;
  const apiStatus = await inspectRunningApi();
  if (apiStatus === "compatible") {
    console.info(`[api] using existing service at ${API_URL}`);
    return;
  }
  if (apiStatus === "incompatible") {
    console.error(`[api] service at ${API_URL} is incompatible with this client`);
    return;
  }
  if (apiStatus === "unresponsive") {
    console.error(`[api] service at ${API_URL} accepted a connection but did not respond`);
    return;
  }
  if (app.isPackaged) {
    console.info(`[api] external service at ${API_URL} is currently offline`);
    return;
  }
  const apiRoot = apiDirectory();
  const launch = apiLaunch(apiRoot);
  apiProcess = spawn(
    launch.executable,
    launch.args,
    {
      cwd: apiRoot,
      env: { ...process.env, APP_ENV: "development" },
      stdio: "pipe",
      windowsHide: true,
    },
  );
  apiProcess.stdout?.on("data", (data) => console.info(`[api] ${String(data).trimEnd()}`));
  apiProcess.stderr?.on("data", (data) => console.error(`[api] ${String(data).trimEnd()}`));
  apiProcess.on("exit", (code) => console.info(`[api] exited with code ${code ?? "unknown"}`));
}

export function stopApiSidecar(): void {
  if (!apiProcess?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(apiProcess.pid), "/T", "/F"], { windowsHide: true });
  } else {
    apiProcess.kill("SIGTERM");
  }
  apiProcess = undefined;
}
