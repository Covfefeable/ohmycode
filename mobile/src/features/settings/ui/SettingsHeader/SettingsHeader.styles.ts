import { spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  back: { alignItems: "center", height: 40, justifyContent: "center", width: 40 },
  header: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 56, paddingHorizontal: spacing[2] },
  spacer: { width: 40 },
  title: { flex: 1, fontSize: typography.body, fontWeight: "700", textAlign: "center" },
});
