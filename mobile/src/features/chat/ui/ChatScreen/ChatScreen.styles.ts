import { radii, spacing, typography } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  assistantMessage: { alignSelf: "stretch", minHeight: 24, paddingHorizontal: spacing[1], paddingVertical: spacing[2] },
  composer: { alignItems: "flex-end", borderRadius: radii.large, borderWidth: StyleSheet.hairlineWidth, flexDirection: "row", gap: spacing[2], marginBottom: spacing[3], marginHorizontal: spacing[3], minHeight: 52, padding: spacing[2], paddingLeft: spacing[4] },
  cursorRow: { alignItems: "flex-start", height: 20, marginTop: -2 },
  emptyMessages: { flexGrow: 1, justifyContent: "center" },
  emptyText: { fontSize: typography.small, textAlign: "center" },
  error: { fontSize: typography.small, paddingBottom: spacing[2], paddingHorizontal: spacing[4] },
  header: { alignItems: "center", borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", height: 54, paddingHorizontal: spacing[2] },
  headerSpacer: { width: 40 },
  input: { flex: 1, fontSize: typography.body, lineHeight: 20, maxHeight: 80, minHeight: 34, paddingBottom: 7, paddingTop: 7 },
  loading: { flex: 1 },
  messageText: { fontSize: typography.chat, lineHeight: 20 },
  menu: { alignItems: "center", borderRadius: radii.medium, borderWidth: StyleSheet.hairlineWidth, height: 38, justifyContent: "center", width: 38 },
  messages: { gap: spacing[3], paddingBottom: spacing[5], paddingHorizontal: spacing[4], paddingTop: spacing[5] },
  screen: { flex: 1 },
  send: { alignItems: "center", borderRadius: radii.pill, height: 36, justifyContent: "center", width: 36 },
  title: { flex: 1, fontSize: typography.body, fontWeight: "600", textAlign: "center" },
  userBubble: { alignSelf: "flex-end", borderRadius: radii.large, maxWidth: "84%", paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
});
