import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
} from "lexical";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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

function TabApplyPlugin({ activeSuggestionRef }: { activeSuggestionRef: React.MutableRefObject<string | null> }) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => editor.registerCommand(KEY_TAB_COMMAND, (event) => {
    const text = activeSuggestionRef.current;
    if (!text) return false;
    const empty = editor.getEditorState().read(() => $getRoot().getTextContent().trim() === "");
    if (!empty) return false;
    event?.preventDefault();
    editor.update(() => {
      const root = $getRoot();
      root.clear();
      const paragraph = $createParagraphNode().append($createTextNode(text));
      root.append(paragraph);
      paragraph.selectEnd();
    });
    return true;
  }, COMMAND_PRIORITY_HIGH), [editor, activeSuggestionRef]);
  return null;
}

const TYPE_INTERVAL_MS = 45;
const ERASE_INTERVAL_MS = 10;
const HOLD_MS = 5000;
const CYCLE_GAP_MS = 250;

function useSuggestionCarousel(suggestions: string[], value: string) {
  const [typed, setTyped] = useState("");
  const activeSuggestionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!suggestions.length || value) {
      activeSuggestionRef.current = null;
      return;
    }
    let cancelled = false;
    let index = 0;
    function tick(target: string) {
      if (cancelled) return;
      let chars = 0;
      const step = () => {
        if (cancelled) return;
        chars += 1;
        setTyped(target.slice(0, chars));
        if (chars < target.length) window.setTimeout(step, TYPE_INTERVAL_MS);
        else window.setTimeout(() => erase(target), HOLD_MS);
      };
      step();
    }
    function erase(target: string) {
      let chars = target.length;
      const step = () => {
        if (cancelled) return;
        chars -= 1;
        setTyped(target.slice(0, Math.max(0, chars)));
        if (chars > 0) window.setTimeout(step, ERASE_INTERVAL_MS);
        else advance();
      };
      step();
    }
    function advance() {
      if (cancelled) return;
      index = (index + 1) % suggestions.length;
      activeSuggestionRef.current = null;
      window.setTimeout(run, CYCLE_GAP_MS);
    }
    function run() {
      if (cancelled) return;
      const target = suggestions[index % suggestions.length];
      activeSuggestionRef.current = target;
      tick(target);
    }
    run();
    return () => { cancelled = true; };
  }, [suggestions, value]);
  return { typed, activeSuggestionRef };
}

export function PromptEditor({ value, onChange, placeholder, ariaLabel, options = [], disabled = false, autoFocus = false, compact = false, submitOnEnter = false, suggestions = [], onSubmit, onEscape, className = "" }: PromptEditorProps) {
  const { t } = useTranslation();
  const { typed, activeSuggestionRef } = useSuggestionCarousel(suggestions, value);
  const showSuggestions = suggestions.length > 0 && !value;
  const placeholderNode = showSuggestions
    ? <span className={`${styles.placeholder} ${styles.suggestionActive}`}>
        <span className={styles.suggestionText}>{typed}<span className={styles.suggestionCaret} /></span>
        <span className={styles.suggestionHint}>{t("agent.applySuggestion")}</span>
      </span>
    : <span className={styles.placeholder}>{placeholder}</span>;
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
        placeholder={placeholderNode}
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
      <TabApplyPlugin activeSuggestionRef={activeSuggestionRef} />
    </div>
  </LexicalComposer>;
}
