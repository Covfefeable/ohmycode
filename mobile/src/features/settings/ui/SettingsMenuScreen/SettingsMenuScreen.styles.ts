import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  card: { alignItems: "center", borderRadius: radii.large, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing[4], minHeight: 76, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
  cardCopy: { flex: 1 },
  cardDescription: { fontSize: typography.small, lineHeight: 18, marginTop: spacing[1] },
  cardTitle: { fontSize: typography.body, fontWeight: "700" },
  content: { flex: 1, gap: spacing[3], padding: spacing[5] },
  icon: { alignItems: "center", borderRadius: radii.medium, height: 42, justifyContent: "center", width: 42 },
  logout: { alignItems: "center", borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing[3], justifyContent: "center", marginTop: "auto", minHeight: 48, paddingHorizontal: spacing[4] },
  logoutText: { fontSize: typography.body, fontWeight: "700" },
  screen: { flex: 1 },
});
