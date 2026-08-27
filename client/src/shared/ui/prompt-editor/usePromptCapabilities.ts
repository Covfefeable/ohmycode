import { useEffect, useState } from "react";
import type { PromptTokenOption } from "./types";

let cache: PromptTokenOption[] | null = null;
let pending: Promise<PromptTokenOption[]> | null = null;
const listeners = new Set<(options: PromptTokenOption[]) => void>();
let subscribed = false;

function ensureChangeSubscription() {
  if (subscribed) return;
  subscribed = true;
  window.ohmycode.capabilities.onChanged(() => {
    cache = null;
    void loadOptions().catch(() => undefined);
  });
}

async function loadOptions() {
  if (cache) return cache;
  if (pending) return pending;
  pending = Promise.all([window.ohmycode.capabilities.listMcp(), window.ohmycode.capabilities.listSkills()])
    .then(([servers, skills]) => {
      cache = [
        ...servers.filter((server) => server.enabled).flatMap((server) => server.tools.map((tool) => ({
          id: `mcp:${server.id}:${tool.name}`,
          kind: "mcp" as const,
          label: `${server.name} / ${tool.name}`,
          detail: tool.description,
          serializedValue: `[[mcp:${server.identifier}/${tool.name}]]`,
        }))),
        ...skills.filter((skill) => skill.enabled && skill.installed).map((skill) => ({
          id: `skill:${skill.id}`,
          kind: "skill" as const,
          label: skill.name,
          detail: skill.description,
          serializedValue: `[[skill:${skill.name}]]`,
        })),
      ];
      for (const listener of listeners) listener(cache);
      return cache;
    })
    .finally(() => { pending = null; });
  return pending;
}

export function usePromptCapabilities() {
  const [options, setOptions] = useState<PromptTokenOption[]>(cache ?? []);
  useEffect(() => {
    let active = true;
    listeners.add(setOptions);
    ensureChangeSubscription();
    void loadOptions().then((items) => { if (active) setOptions(items); }).catch(() => undefined);
    return () => {
      active = false;
      listeners.delete(setOptions);
    };
  }, []);
  return options;
}
