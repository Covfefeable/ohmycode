import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_CRITICAL } from "lexical";
import { Users } from "lucide-react";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { $createMentionTokenNode } from "./MentionTokenNode";
import type { PromptMentionOption } from "./types";
import styles from "./PromptEditor.module.css";

class MentionMenuOption extends MenuOption {
  option: PromptMentionOption;
  constructor(option: PromptMentionOption) { super(option.id); this.option = option; }
}

export function MentionPlugin({ mentions }: { mentions: PromptMentionOption[] }) {
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch("@", { minLength: 0, maxLength: 80, allowWhitespace: false });
  const options = useMemo(() => {
    const needle = (query ?? "").trim().toLocaleLowerCase();
    return mentions.filter((item) => !needle || `${item.label} ${item.detail ?? ""}`.toLocaleLowerCase().includes(needle))
      .map((item) => new MentionMenuOption(item));
  }, [mentions, query]);

  return <LexicalTypeaheadMenuPlugin
    commandPriority={COMMAND_PRIORITY_CRITICAL}
    anchorClassName={styles.menuAnchor}
    triggerFn={trigger}
    options={options}
    onQueryChange={setQuery}
    onClose={() => setQuery(null)}
    onSelectOption={(selected, textNode, closeMenu) => {
      editor.update(() => {
        textNode?.remove();
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        selection.insertNodes([$createMentionTokenNode(selected.option.label), $createTextNode(" ")]);
      });
      closeMenu();
    }}
    menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => anchorRef.current && options.length
      ? createPortal(<div className={`${styles.menu} ${styles.menuBelow}`}>
        {options.map((item, index) => <button key={item.key} type="button" className={index === selectedIndex ? styles.menuSelected : undefined} onMouseEnter={() => setHighlightedIndex(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => selectOptionAndCleanUp(item)}>
          <span className={styles.menuIcon}><Users /></span>
          <span><strong>{item.option.label}</strong>{item.option.detail && <small>{item.option.detail}</small>}</span>
          <em>Agent</em>
        </button>)}
      </div>, anchorRef.current)
      : null}
  />;
}
