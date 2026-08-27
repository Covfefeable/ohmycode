import { useEffect, useRef } from "react";
import { Animated } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";

export function StreamingCursor() {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(opacity, { duration: 480, toValue: 0, useNativeDriver: true }),
      Animated.timing(opacity, { duration: 480, toValue: 1, useNativeDriver: true }),
    ]));
    animation.start();
    return () => animation.stop();
  }, [opacity]);
  return <Animated.Text style={{ color: colors.accent, fontSize: 17, lineHeight: 20, opacity }}>▍</Animated.Text>;
}
