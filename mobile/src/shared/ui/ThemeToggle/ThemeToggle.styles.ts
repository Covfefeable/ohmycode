import { radii } from "@ohmycode/design-tokens";
import { StyleSheet } from "react-native";

export const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radii.medium,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  icon: { fontSize: 18, lineHeight: 20 },
});
