import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  action: { alignItems: "center", borderRadius: radii.medium, flexDirection: "row", gap: spacing[3], minHeight: 44, paddingHorizontal: spacing[3] },
  actionText: { fontSize: typography.body, fontWeight: "600" },
  backdrop: { backgroundColor: "rgba(0, 0, 0, 0.42)", bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
  brand: { alignItems: "center", flexDirection: "row", gap: spacing[3], paddingHorizontal: spacing[3] },
  brandName: { fontSize: typography.body, fontWeight: "700" },
  close: { alignItems: "center", borderRadius: radii.medium, height: 36, justifyContent: "center", width: 36 },
  conversation: { borderRadius: radii.medium, minHeight: 40, paddingHorizontal: spacing[3], paddingVertical: 10 },
  conversationActive: { borderWidth: StyleSheet.hairlineWidth },
  conversationText: { fontSize: typography.small, fontWeight: "600" },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, marginBottom: spacing[3], marginTop: spacing[2] },
  empty: { fontSize: typography.small, paddingHorizontal: spacing[3], paddingVertical: spacing[4] },
  header: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", marginBottom: spacing[5] },
  list: { gap: spacing[1], paddingBottom: spacing[5] },
  loading: { marginTop: spacing[5] },
  modal: { flex: 1 },
  panel: { borderRightWidth: StyleSheet.hairlineWidth, bottom: 0, left: 0, maxWidth: 340, paddingHorizontal: spacing[3], paddingTop: 54, position: "absolute", top: 0, width: "86%" },
  recentLabel: { fontSize: typography.xs, fontWeight: "800", letterSpacing: 1.2, paddingHorizontal: spacing[3], paddingVertical: spacing[3] },
});
