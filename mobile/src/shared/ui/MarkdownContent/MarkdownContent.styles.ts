import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  blockquote: { borderLeftWidth: 3, marginVertical: spacing[2], paddingLeft: spacing[3] },
  codeBlock: { borderRadius: radii.medium, fontFamily: "monospace", fontSize: typography.small, lineHeight: 19, marginVertical: spacing[2], overflow: "hidden", padding: spacing[3] },
  heading1: { fontSize: 24, fontWeight: "800", lineHeight: 30, marginBottom: spacing[2], marginTop: spacing[4] },
  heading2: { fontSize: 20, fontWeight: "700", lineHeight: 26, marginBottom: spacing[2], marginTop: spacing[4] },
  heading3: { fontSize: 17, fontWeight: "700", lineHeight: 23, marginBottom: spacing[1], marginTop: spacing[3] },
  inlineCode: { borderRadius: radii.small, fontFamily: "monospace", fontSize: typography.small, paddingHorizontal: 4 },
  link: { textDecorationLine: "underline" },
  listItem: { flexDirection: "row", gap: spacing[2], marginVertical: 2 },
  listMarker: { fontSize: typography.body, lineHeight: 21, width: 18 },
  paragraph: { fontSize: typography.chat, lineHeight: 21, marginVertical: spacing[1] },
  strong: { fontWeight: "700" },
});
