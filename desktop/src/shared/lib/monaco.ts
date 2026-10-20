import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import JsonWorker from "monaco-editor/language/json/json.worker?worker";
import "monaco-editor/language/json/monaco.contribution";
import "monaco-editor/editor/contrib/find/browser/findController";
import "monaco-editor/editor/contrib/folding/browser/folding";
import { useEffect, useState } from "react";

self.MonacoEnvironment = { getWorker: (_id, label) => label === "json" ? new JsonWorker() : new EditorWorker() };
loader.config({ monaco });

export function useMonacoTheme(): string {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === "light" ? "light" : "vs-dark");
  useEffect(() => {
    const observer = new MutationObserver(() => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "vs-dark"));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
