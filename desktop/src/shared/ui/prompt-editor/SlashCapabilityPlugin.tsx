import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { LexicalTypeaheadMenuPlugin, MenuOption, useBasicTypeaheadTriggerMatch } from "@lexical/react/LexicalTypeaheadMenuPlugin";
import { $createTextNode, $getSelection, $isRangeSelection, COMMAND_PRIORITY_CRITICAL } from "lexical";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Wrench } from "lucide-react";
import { useTranslation } from "react-i18next";
import { $createCapabilityTokenNode } from "./CapabilityTokenNode";
import type { PromptTokenOption } from "./types";
import styles from "./PromptEditor.module.css";

class CapabilityMenuOption extends MenuOption {
  option: PromptTokenOption;
  constructor(option: PromptTokenOption) {
    super(option.id);
    this.option = option;
  }
}

export function SlashCapabilityPlugin({ options }: { options: PromptTokenOption[] }) {
  const { t } = useTranslation();
  const [editor] = useLexicalComposerContext();
  const [query, setQuery] = useState<string | null>(null);
  const trigger = useBasicTypeaheadTriggerMatch("/", { minLength: 0, maxLength: 80, allowWhitespace: false });
  const menuOptions = useMemo(() => {
    const needle = (query ?? "").trim().toLocaleLowerCase();
    return options.filter((item) => !needle || `${item.label} ${item.detail ?? ""} ${item.kind}`.toLocaleLowerCase().includes(needle))
      .slice(0, 12).map((item) => new CapabilityMenuOption(item));
  }, [options, query]);

  return <LexicalTypeaheadMenuPlugin
    commandPriority={COMMAND_PRIORITY_CRITICAL}
    anchorClassName={styles.menuAnchor}
    onClose={() => setQuery(null)}
    triggerFn={trigger}
    options={menuOptions}
    onQueryChange={setQuery}
    onSelectOption={(selected, textNode, closeMenu) => {
      editor.update(() => {
        textNode?.remove();
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const token = $createCapabilityTokenNode(selected.option.kind, selected.option.label, selected.option.serializedValue);
        selection.insertNodes([token, $createTextNode(" ")]);
      });
      closeMenu();
    }}
    menuRenderFn={(anchorRef, { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }) => anchorRef.current && menuOptions.length
      ? createPortal(<div className={`${styles.menu} ${anchorRef.current.getBoundingClientRect().bottom + 330 > window.innerHeight ? styles.menuAbove : styles.menuBelow}`}>
        {(["mcp", "skill"] as const).map((kind) => {
          const items = menuOptions.filter((item) => item.option.kind === kind);
          if (!items.length) return null;
          return <section className={styles.menuGroup} key={kind}>
            <div className={styles.menuHint}>{t(kind === "mcp" ? "promptEditor.mcpTools" : "promptEditor.skills")}</div>
            {items.map((item) => {
              const index = menuOptions.indexOf(item);
              return <button
                type="button"
                key={item.key}
                className={index === selectedIndex ? styles.menuSelected : undefined}
                onMouseEnter={() => setHighlightedIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectOptionAndCleanUp(item)}
              >
                <span className={styles.menuIcon}>{kind === "mcp" ? <Wrench /> : <Box />}</span>
                <span><strong>{item.option.label}</strong>{item.option.detail && <small>{item.option.detail}</small>}</span>
                <em>{kind === "mcp" ? "MCP" : "Skill"}</em>
              </button>;
            })}
          </section>;
        })}
      </div>, anchorRef.current)
      : null}
  />;
}
