import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  actions: { alignItems: "center", flexDirection: "row", gap: spacing[2] },
  avatar: { alignItems: "center", borderRadius: radii.pill, height: 34, justifyContent: "center", width: 34 },
  avatarText: { fontSize: typography.small, fontWeight: "700" },
  brand: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
  brandName: { fontSize: typography.body, fontWeight: "700" },
  content: { flex: 1, paddingHorizontal: spacing[5], paddingTop: 52 },
  empty: { alignItems: "center", borderRadius: radii.large, borderWidth: StyleSheet.hairlineWidth, marginTop: 44, paddingHorizontal: spacing[6], paddingVertical: 40 },
  emptyDescription: { fontSize: typography.small, lineHeight: 18, marginTop: spacing[2], maxWidth: 280, textAlign: "center" },
  emptyMark: { alignItems: "center", borderRadius: radii.medium, height: 42, justifyContent: "center", marginBottom: spacing[4], width: 42 },
  emptyMarkText: { fontSize: 24, fontWeight: "400", lineHeight: 26 },
  emptyTitle: { fontSize: typography.body, fontWeight: "700" },
  eyebrow: { fontSize: typography.xs, fontWeight: "700", letterSpacing: 1.3 },
  header: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 58, justifyContent: "space-between", paddingHorizontal: spacing[4] },
  loader: { marginTop: 72 },
  list: { gap: spacing[2], paddingTop: spacing[6] },
  newButton: { alignItems: "center", borderRadius: radii.medium, height: 36, justifyContent: "center", paddingHorizontal: spacing[3] },
  newButtonText: { fontSize: typography.small, fontWeight: "700" },
  row: { alignItems: "center", borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", minHeight: 52, paddingHorizontal: spacing[4] },
  rowTitle: { flex: 1, fontSize: typography.body, fontWeight: "600" },
  chevron: { fontSize: 22 },
  screen: { flex: 1 },
  subtitle: { fontSize: typography.body, lineHeight: 21, marginTop: spacing[3], maxWidth: 320 },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -1, marginTop: spacing[3] },
  titleRow: { alignItems: "flex-end", flexDirection: "row", justifyContent: "space-between" },
});
