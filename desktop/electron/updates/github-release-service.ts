import { app, net, shell } from "electron";

const RELEASES_API_URL = "https://api.github.com/repos/Covfefeable/ohmycode/releases/latest";
const RELEASES_PAGE_URL = "https://github.com/Covfefeable/ohmycode/releases/latest";

type GitHubRelease = {
  tag_name?: unknown;
  html_url?: unknown;
  name?: unknown;
  published_at?: unknown;
};

export type UpdateCheckResult = {
  status: "latest" | "available";
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  publishedAt: string | null;
};

function versionParts(value: string): [number, number, number] {
  const match = value.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!match) throw new Error("invalid_release_version");
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(candidate: string, current: string): boolean {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  for (let index = 0; index < next.length; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

export async function checkForDesktopUpdate(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  // Electron's network stack honors the operating system proxy configuration.
  // Node's global fetch (Undici) does not, which made update checks fail on
  // networks where GitHub is only reachable through the configured proxy.
  const response = await net.fetch(RELEASES_API_URL, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `OhMyCode/${currentVersion}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (response.status === 404) {
    return {
      status: "latest",
      currentVersion,
      latestVersion: currentVersion,
      releaseName: `OhMyCode v${currentVersion}`,
      publishedAt: null,
    };
  }
  if (!response.ok) throw new Error(`github_release_${response.status}`);
  const release = await response.json() as GitHubRelease;
  if (typeof release.tag_name !== "string") throw new Error("invalid_release_response");
  const latestVersion = release.tag_name.replace(/^v/, "");
  return {
    status: isNewer(latestVersion, currentVersion) ? "available" : "latest",
    currentVersion,
    latestVersion,
    releaseName: typeof release.name === "string" && release.name.trim() ? release.name : `OhMyCode ${release.tag_name}`,
    publishedAt: typeof release.published_at === "string" ? release.published_at : null,
  };
}

export async function openDesktopReleases(): Promise<void> {
  await shell.openExternal(RELEASES_PAGE_URL);
}
