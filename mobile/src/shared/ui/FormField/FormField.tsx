import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./FormField.styles";

type Props = TextInputProps & { label: string };

export function FormField({ label, style, ...props }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <TextInput
        {...props}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.accent}
        style={[
          styles.input,
          { backgroundColor: colors.input, borderColor: colors.fieldBorder, color: colors.text },
          style,
        ]}
      />
    </View>
  );
}
