import Feather from "@expo/vector-icons/Feather";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, Text, useWindowDimensions, View } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./LanguageSwitcher.styles";

type Anchor = { height: number; width: number; x: number; y: number };

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { i18n, t } = useTranslation();
  const { colors } = useTheme();
  const { width: viewportWidth } = useWindowDimensions();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const language = i18n.resolvedLanguage?.startsWith("zh") ? "zh-CN" : "en";
  const options = [
    { label: t("language.zhCN"), value: "zh-CN" },
    { label: t("language.en"), value: "en" },
  ] as const;

  const open = () => {
    triggerRef.current?.measureInWindow((x, y, width, height) => {
      setAnchor({ height, width, x, y });
    });
  };

  const menuWidth = Math.max(anchor?.width ?? 0, 144);
  const menuLeft = Math.max(12, Math.min(anchor?.x ?? 0, viewportWidth - menuWidth - 12));

  return (
    <>
      <Pressable
        accessibilityLabel={t("language.label")}
        accessibilityRole="button"
        onPress={open}
        ref={triggerRef}
        style={({ pressed }) => [
          styles.trigger,
          compact ? styles.triggerCompact : styles.triggerFull,
          {
            backgroundColor: pressed ? colors.surfaceHover : compact ? "transparent" : colors.surfaceRaised,
            borderColor: colors.border,
          },
        ]}
      >
        <Text style={[styles.value, { color: colors.text }]}>{options.find((item) => item.value === language)?.label}</Text>
        <Feather color={colors.textDim} name="chevron-down" size={16} />
      </Pressable>
      <Modal animationType="fade" onRequestClose={() => setAnchor(null)} transparent visible={Boolean(anchor)}>
        <View style={styles.modal}>
          <Pressable accessibilityLabel={t("common.close")} onPress={() => setAnchor(null)} style={styles.backdrop} />
          {anchor ? <View style={[styles.menu, { backgroundColor: colors.surface, borderColor: colors.border, left: menuLeft, top: anchor.y + anchor.height + 6, width: menuWidth }]}>
            {options.map((option) => {
              const selected = option.value === language;
              return <Pressable key={option.value} onPress={() => { void i18n.changeLanguage(option.value); setAnchor(null); }} style={({ pressed }) => [styles.option, { backgroundColor: pressed || selected ? colors.surfaceHover : "transparent" }]}>
                <Text style={[styles.optionText, { color: colors.text }]}>{option.label}</Text>
                {selected ? <Feather color={colors.accent} name="check" size={17} /> : null}
              </Pressable>;
            })}
          </View> : null}
        </View>
      </Modal>
    </>
  );
}
