import { Fragment, type ReactNode } from "react";
import { Linking, ScrollView, Text, View } from "react-native";

import { useTheme } from "@/shared/theme/ThemeProvider";
import { styles } from "./MarkdownContent.styles";

type Block =
  | { type: "code"; content: string }
  | { type: "heading"; content: string; level: number }
  | { type: "quote"; content: string }
  | { type: "list"; items: string[]; ordered: boolean }
  | { type: "paragraph"; content: string };

function blocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const result: Block[] = [];
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }
    if (line.trimStart().startsWith("```")) {
      const content: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trimStart().startsWith("```")) content.push(lines[index++]);
      index += index < lines.length ? 1 : 0;
      result.push({ type: "code", content: content.join("\n") });
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) { result.push({ type: "heading", level: heading[1].length, content: heading[2] }); index += 1; continue; }
    if (/^>\s?/.test(line)) { result.push({ type: "quote", content: line.replace(/^>\s?/, "") }); index += 1; continue; }
    const list = line.match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/);
    if (list) {
      const ordered = Boolean(list[1]);
      const items: string[] = [];
      while (index < lines.length) {
        const item = lines[index].match(/^\s*(?:(\d+)\.|[-*+])\s+(.+)$/);
        if (!item || Boolean(item[1]) !== ordered) break;
        items.push(item[2]);
        index += 1;
      }
      result.push({ type: "list", ordered, items });
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3})\s|^```|^>|^\s*(?:(?:\d+)\.|[-*+])\s/.test(lines[index])) paragraph.push(lines[index++]);
    result.push({ type: "paragraph", content: paragraph.join("\n") });
  }
  return result;
}

function Inline({ content }: { content: string }) {
  const { colors } = useTheme();
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*]+\*)/g;
  const parts = content.split(pattern).filter(Boolean);
  const nodes: ReactNode[] = parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <Text key={index} style={styles.strong}>{part.slice(2, -2)}</Text>;
    if (part.startsWith("`") && part.endsWith("`")) return <Text key={index} style={[styles.inlineCode, { backgroundColor: colors.surfaceRaised }]}>{part.slice(1, -1)}</Text>;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) return <Text key={index} accessibilityRole="link" onPress={() => void Linking.openURL(link[2])} style={[styles.link, { color: colors.accent }]}>{link[1]}</Text>;
    if (part.startsWith("*") && part.endsWith("*")) return <Text key={index} style={{ fontStyle: "italic" }}>{part.slice(1, -1)}</Text>;
    return <Fragment key={index}>{part}</Fragment>;
  });
  return <>{nodes}</>;
}

export function MarkdownContent({ children }: { children: string }) {
  const { colors } = useTheme();
  return <View style={styles.container}>{blocks(children).map((block, index) => {
    if (block.type === "code") return <ScrollView key={index} horizontal style={[styles.codeBlock, { backgroundColor: colors.surfaceRaised }]} contentContainerStyle={styles.codeContent}><Text selectable style={[styles.codeText, { color: colors.text }]}>{block.content}</Text></ScrollView>;
    if (block.type === "heading") return <Text key={index} selectable style={[block.level === 1 ? styles.heading1 : block.level === 2 ? styles.heading2 : styles.heading3, { color: colors.text }]}><Inline content={block.content} /></Text>;
    if (block.type === "quote") return <View key={index} style={[styles.blockquote, { borderLeftColor: colors.borderStrong }]}><Text selectable style={[styles.paragraph, { color: colors.textMuted }]}><Inline content={block.content} /></Text></View>;
    if (block.type === "list") return <View key={index} style={styles.list}>{block.items.map((item, itemIndex) => <View key={itemIndex} style={styles.listItem}><Text style={[styles.listMarker, { color: colors.textDim }]}>{block.ordered ? `${itemIndex + 1}.` : "•"}</Text><Text selectable style={[styles.listText, styles.paragraph, { color: colors.text }]}><Inline content={item} /></Text></View>)}</View>;
    return <Text key={index} selectable style={[styles.paragraph, { color: colors.text }]}><Inline content={block.content} /></Text>;
  })}</View>;
}
