import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: spacing[2] },
  add: { alignItems: "center", borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing[2], height: 44, justifyContent: "center" },
  addText: { fontSize: typography.body, fontWeight: "700" },
  card: { borderRadius: radii.large, borderWidth: StyleSheet.hairlineWidth, gap: spacing[4], padding: spacing[4] },
  cardHeader: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
  cardName: { flex: 1, fontSize: typography.body, fontWeight: "700" },
  content: { gap: spacing[4], padding: spacing[5] },
  description: { fontSize: typography.body, lineHeight: 21 },
  error: { fontSize: typography.small },
  iconButton: { alignItems: "center", borderRadius: radii.medium, height: 36, justifyContent: "center", minWidth: 36, paddingHorizontal: spacing[2] },
  save: { alignItems: "center", borderRadius: radii.medium, height: 48, justifyContent: "center" },
  saveText: { fontSize: typography.body, fontWeight: "700" },
  screen: { flex: 1 },
  success: { fontSize: typography.small },
  switchRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", minHeight: 44 },
  switchText: { fontSize: typography.body, fontWeight: "600" },
});
