import { createContext, useContext, useState } from "react";

export const ExpansionContext = createContext<Map<string, boolean> | null>(null);

export function useActivityExpansion(key: string, initial: boolean) {
  const values = useContext(ExpansionContext);
  const [open, setOpen] = useState(() => values?.get(key) ?? initial);
  return [open, (update: (current: boolean) => boolean) => {
    setOpen((current) => {
      const next = update(current);
      values?.set(key, next);
      return next;
    });
  }] as const;
}
