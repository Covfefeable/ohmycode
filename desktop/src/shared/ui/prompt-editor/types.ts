export type PromptTokenOption = {
  id: string;
  kind: "mcp" | "skill";
  label: string;
  detail?: string;
  serializedValue: string;
};

export type PromptEditorProps = {
  value: string;
  onChange(value: string): void;
  placeholder?: string;
  ariaLabel: string;
  options?: PromptTokenOption[];
  capabilityTriggers?: Array<"/" | "@">;
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
