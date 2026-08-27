import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  backdrop: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  menu: { borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, padding: spacing[1], position: "absolute", shadowColor: "#000", shadowOffset: { height: 8, width: 0 }, shadowOpacity: 0.18, shadowRadius: 18 },
  modal: { flex: 1 },
  option: { alignItems: "center", borderRadius: radii.small, flexDirection: "row", gap: spacing[3], justifyContent: "space-between", minHeight: 42, paddingHorizontal: spacing[3] },
  optionText: { fontSize: typography.small, fontWeight: "600" },
  trigger: { alignItems: "center", borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing[2], justifyContent: "space-between", paddingHorizontal: spacing[3] },
  triggerCompact: { borderWidth: 0, height: 34, minWidth: 92 },
  triggerFull: { height: 48, width: "100%" },
  value: { fontSize: typography.small, fontWeight: "700" },
});
