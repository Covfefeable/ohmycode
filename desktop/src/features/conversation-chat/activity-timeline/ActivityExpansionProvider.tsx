import { useState, type ReactNode } from "react";
import { ExpansionContext } from "./expansion-state";

export function ActivityExpansionProvider({ children }: { children: ReactNode }) {
  const [values] = useState(() => new Map<string, boolean>());
  return <ExpansionContext.Provider value={values}>{children}</ExpansionContext.Provider>;
}
