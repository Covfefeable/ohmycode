import { Text, type StyleProp, type TextStyle } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";

type Props = {
  style?: StyleProp<TextStyle>;
  text: string;
};

const BRAND = "OhMyCode";

export function BrandText({ style, text }: Props) {
  const { colors } = useTheme();
  const index = text.indexOf(BRAND);

  if (index < 0) return <Text style={style}>{text}</Text>;

  return (
    <Text style={style}>
      {text.slice(0, index)}Oh<Text style={{ color: colors.accent }}>My</Text>Code{text.slice(index + BRAND.length)}
    </Text>
  );
}
