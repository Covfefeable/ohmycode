import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  brand: { alignItems: "center", flexDirection: "row", gap: spacing[3] },
  brandName: { fontSize: typography.body, fontWeight: "700", letterSpacing: -0.2 },
  content: { alignItems: "center", flex: 1, justifyContent: "center", paddingBottom: 56, paddingHorizontal: spacing[6] },
  error: { fontSize: typography.small, lineHeight: 18 },
  form: { gap: spacing[4], marginTop: spacing[8] },
  glass: { borderRadius: radii.large, borderWidth: 1, maxWidth: 440, overflow: "hidden", padding: spacing[6], width: "100%" },
  heading: { gap: spacing[3] },
  screen: { flex: 1 },
  submit: { alignItems: "center", borderRadius: radii.medium, height: 48, justifyContent: "center", marginTop: spacing[2] },
  submitText: { fontSize: typography.body, fontWeight: "700" },
  subtitle: { fontSize: typography.body, lineHeight: 21 },
  switchText: { fontSize: typography.small, marginTop: spacing[6], textAlign: "center" },
  title: { fontSize: 30, fontWeight: "700", letterSpacing: -1.1, lineHeight: 36 },
  topbar: { alignItems: "center", flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing[5], paddingTop: spacing[3], zIndex: 1 },
});
