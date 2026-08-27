import { Text, TextInput, View, type TextInputProps } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./FormField.styles";

type Props = TextInputProps & { label: string };

export function FormField({ editable = true, label, style, ...props }: Props) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: editable ? colors.textMuted : colors.textDim }]}>{label}</Text>
      <TextInput
        {...props}
        editable={editable}
        placeholderTextColor={colors.textDim}
        selectionColor={colors.accent}
        style={[
          styles.input,
          editable ? null : styles.inputDisabled,
          {
            backgroundColor: editable ? colors.input : colors.surfaceRaised,
            borderColor: editable ? colors.fieldBorder : colors.border,
            color: editable ? colors.text : colors.textDim,
          },
          style,
        ]}
      />
    </View>
  );
}
