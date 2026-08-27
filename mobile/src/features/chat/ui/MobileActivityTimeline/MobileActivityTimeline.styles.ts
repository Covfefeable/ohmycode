import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  detail: { marginBottom: spacing[2], marginLeft: 26, marginTop: spacing[1] },
  detailText: { fontFamily: "monospace", fontSize: typography.xs, lineHeight: 17 },
  plan: { gap: spacing[2], marginBottom: spacing[2], marginLeft: 26 },
  planItem: { flexDirection: "row", gap: spacing[2] },
  planText: { flex: 1, fontSize: typography.small, lineHeight: 18 },
  step: { marginBottom: spacing[2] },
  stepHead: { alignItems: "center", flexDirection: "row", gap: spacing[2], minHeight: 28 },
  stepLabel: { flex: 1, fontSize: typography.small, fontWeight: "600" },
  summary: { alignItems: "center", alignSelf: "flex-start", borderRadius: radii.medium, flexDirection: "row", gap: spacing[2], minHeight: 30, paddingHorizontal: spacing[2] },
  summaryText: { fontSize: typography.small, fontWeight: "600" },
  timeline: { marginBottom: spacing[2], paddingHorizontal: spacing[1] },
});
