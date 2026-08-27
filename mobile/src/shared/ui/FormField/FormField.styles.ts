import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  field: { gap: spacing[2] },
  input: {
    borderRadius: radii.medium,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: typography.body,
    height: 48,
    paddingHorizontal: spacing[4],
  },
  inputDisabled: { opacity: 0.72 },
  label: { fontSize: typography.small, fontWeight: "600" },
});
