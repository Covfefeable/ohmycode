import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $setSelection, BLUR_COMMAND, COMMAND_PRIORITY_HIGH, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND } from "lexical";
import { useEffect } from "react";
import { CapabilityTokenNode } from "./CapabilityTokenNode";
import { $getPromptValue, $setPromptValue } from "./editor-value";
import { SlashCapabilityPlugin } from "./SlashCapabilityPlugin";
import type { PromptEditorProps } from "./types";
import styles from "./PromptEditor.module.css";

function ValuePlugin({ value, options }: Pick<PromptEditorProps, "value" | "options">) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    const current = editor.getEditorState().read($getPromptValue);
    if (current === value) return;
    editor.update(() => $setPromptValue(value, options ?? []), { tag: "external-value" });
  }, [editor, options, value]);
  return null;
}

function EditablePlugin({ disabled }: { disabled: boolean }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.setEditable(!disabled), [disabled, editor]);
  return null;
}

function SubmitPlugin({ enabled, onSubmit }: { enabled: boolean; onSubmit?: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!enabled || !onSubmit) return;
    return editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
      if (!event || event.shiftKey || event.isComposing) return false;
      event.preventDefault();
      onSubmit();
      return true;
    }, COMMAND_PRIORITY_HIGH);
  }, [editor, enabled, onSubmit]);
  return null;
}

function EscapePlugin({ onEscape }: { onEscape?: () => void }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    if (!onEscape) return;
    return editor.registerCommand(KEY_ESCAPE_COMMAND, () => {
      onEscape();
      return true;
    }, COMMAND_PRIORITY_HIGH);
  }, [editor, onEscape]);
  return null;
}

function BlurPlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(BLUR_COMMAND, () => {
    $setSelection(null);
    return false;
  }, COMMAND_PRIORITY_HIGH), [editor]);
  return null;
}

export function PromptEditor({ value, onChange, placeholder, ariaLabel, options = [], disabled = false, autoFocus = false, compact = false, submitOnEnter = false, onSubmit, onEscape, className = "" }: PromptEditorProps) {
  return <LexicalComposer initialConfig={{
    namespace: "ohmycode-prompt-editor",
    nodes: [CapabilityTokenNode],
    editable: !disabled,
    editorState: () => $setPromptValue(value, options),
    onError: (error) => { throw error; },
  }}>
    <div className={`${styles.root} ${compact ? styles.compact : ""} ${className}`}>
      <RichTextPlugin
        contentEditable={<ContentEditable className={styles.editor} aria-label={ariaLabel} autoFocus={autoFocus} />}
        placeholder={<span className={styles.placeholder}>{placeholder}</span>}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <OnChangePlugin ignoreSelectionChange onChange={(state, editor, tags) => {
        if (tags.has("external-value")) return;
        state.read(() => onChange($getPromptValue()));
      }} />
      <SlashCapabilityPlugin options={options} />
      <ValuePlugin value={value} options={options} />
      <EditablePlugin disabled={disabled} />
      <SubmitPlugin enabled={submitOnEnter} onSubmit={onSubmit} />
      <EscapePlugin onEscape={onEscape} />
      <BlurPlugin />
    </div>
  </LexicalComposer>;
}
