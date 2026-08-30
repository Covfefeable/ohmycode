export type PromptTokenOption = {
  id: string;
  kind: "mcp" | "skill";
  label: string;
  detail?: string;
  serializedValue: string;
};

export type PromptMentionOption = {
  id: string;
  label: string;
  detail?: string;
};

export type PromptEditorProps = {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  ariaLabel: string;
  options?: PromptTokenOption[];
  mentions?: PromptMentionOption[];
  disabled?: boolean;
  autoFocus?: boolean;
  compact?: boolean;
  submitOnEnter?: boolean;
  suggestions?: string[];
  onSubmit?(): void;
  onEscape?(): void;
  onAtTrigger?(): void;
  className?: string;
};
