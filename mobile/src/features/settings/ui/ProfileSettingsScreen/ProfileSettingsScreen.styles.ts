import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  content: { gap: spacing[5], padding: spacing[5] },
  description: { fontSize: typography.body, lineHeight: 21 },
  error: { fontSize: typography.small },
  languageRow: { alignItems: "center", borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", justifyContent: "space-between", minHeight: 52, paddingHorizontal: spacing[4] },
  languageText: { fontSize: typography.body, fontWeight: "600" },
  save: { alignItems: "center", borderRadius: radii.medium, height: 48, justifyContent: "center" },
  saveText: { fontSize: typography.body, fontWeight: "700" },
  screen: { flex: 1 },
  success: { fontSize: typography.small },
});
