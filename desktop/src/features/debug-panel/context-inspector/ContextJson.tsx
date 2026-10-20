import { Editor } from "@monaco-editor/react";
import { useMonacoTheme } from "../../../shared/lib/monaco";

export default function ContextJson({ value }: { value: string }) {
  const theme = useMonacoTheme();
  return <Editor height="100%" language="json" theme={theme} value={value} onMount={(editor) => editor.focus()} options={{ readOnly: true, domReadOnly: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, wordWrap: "on", folding: true, fontSize: 12 }} />;
}
