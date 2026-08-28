import Feather from "@expo/vector-icons/Feather";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";

import type { MobileActivityStep } from "@/features/chat/api/mobile-chat-api";
import { useTheme } from "@/shared/theme/ThemeProvider";
import { MarkdownContent } from "@/shared/ui/MarkdownContent/MarkdownContent";
import { styles } from "./MobileActivityTimeline.styles";

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value ?? ""); }
}

function Step({ step }: { step: Exclude<MobileActivityStep, { type: "run" | "task_plan" }> }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const running = step.status === "running";
  const label = step.type === "reasoning"
    ? t(running ? "activity.thinking" : "activity.thought")
    : step.type === "tool"
      ? t(running ? "activity.usingTool" : "activity.usedTool", { tool: step.tool })
      : t("activity.progress");
  const detail = step.type === "tool" ? formatValue(step.result ?? step.input) : step.content;
  return <View style={styles.step}>
    <Pressable onPress={() => setOpen((value) => !value)} style={styles.stepHead}>
      <Feather color={running ? colors.accent : colors.textDim} name={running ? "loader" : "check"} size={15} />
      <Text style={[styles.stepLabel, { color: colors.textMuted }]}>{label}</Text>
      <Feather color={colors.textDim} name={open ? "chevron-up" : "chevron-down"} size={16} />
    </Pressable>
    {open && detail ? <View style={styles.detail}>{step.type === "tool" ? <Text selectable style={[styles.detailText, { color: colors.textMuted }]}>{detail}</Text> : <MarkdownContent>{detail}</MarkdownContent>}</View> : null}
  </View>;
}

export function MobileActivityTimeline({ active, durationMs, finalContent, startedAt, steps }: { active: boolean; durationMs?: number | null; finalContent: string; startedAt?: string; steps: MobileActivityStep[] }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const [elapsed, setElapsed] = useState(() => startedAt ? Date.now() - new Date(startedAt).getTime() : 0);
  useEffect(() => {
    if (!active || !startedAt) return;
    const timer = setInterval(() => setElapsed(Date.now() - new Date(startedAt).getTime()), 1000);
    return () => clearInterval(timer);
  }, [active, startedAt]);
  const visible = useMemo(() => steps.filter(
    (step): step is Exclude<MobileActivityStep, { type: "run" }> => step.type !== "run" && !(step.type === "message" && step.content.trim() === finalContent.trim()),
  ), [finalContent, steps]);
  if (!visible.length) return null;
  const seconds = Math.max(0, Math.round((durationMs ?? elapsed) / 1000));
  const summary = active ? t("activity.working") : t("activity.duration", { seconds });
  const open = active || manuallyOpen;
  return <View style={styles.timeline}>
    <Pressable onPress={() => setManuallyOpen((value) => !value)} style={({ pressed }) => [styles.summary, { backgroundColor: pressed ? colors.surfaceHover : "transparent" }]}>
      <Feather color={active ? colors.accent : colors.textDim} name={active ? "loader" : "check"} size={16} />
      <Text style={[styles.summaryText, { color: colors.textMuted }]}>{summary}</Text>
      <Feather color={colors.textDim} name={open ? "chevron-up" : "chevron-down"} size={16} />
    </Pressable>
    {open ? <View>{visible.map((step) => step.type === "task_plan" ? <View key={step.id} style={styles.plan}>{step.tasks.map((task) => <View key={task.id} style={styles.planItem}><Feather color={task.status === "completed" ? colors.accent : colors.textDim} name={task.status === "completed" ? "check-circle" : task.status === "in_progress" ? "loader" : "circle"} size={15} /><Text style={[styles.planText, { color: colors.textMuted }]}>{task.content}</Text></View>)}</View> : <Step key={step.id} step={step} />)}</View> : null}
  </View>;
}
