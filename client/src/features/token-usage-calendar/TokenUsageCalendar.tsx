import { CalendarDays } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Tooltip } from "../../shared/ui/tooltip";
import styles from "./TokenUsageCalendar.module.css";

type DayCell = { date: string; tokens: number } | null;

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function calendarCells(entries: TokenUsageEntry[]): { cells: DayCell[]; max: number; total: number } {
  const usage = new Map(entries.map((entry) => [entry.date, entry.tokens]));
  const end = new Date();
  end.setUTCHours(12, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const cells: DayCell[] = Array.from({ length: start.getUTCDay() }, () => null);
  let max = 0;
  let total = 0;
  for (let cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = isoDate(cursor);
    const tokens = usage.get(date) ?? 0;
    max = Math.max(max, tokens);
    total += tokens;
    cells.push({ date, tokens });
  }
  return { cells, max, total };
}

export function TokenUsageCalendar({ entries }: { entries: TokenUsageEntry[] }) {
  const { t, i18n } = useTranslation();
  const { cells, max, total } = calendarCells(entries);
  const number = new Intl.NumberFormat(i18n.language, { notation: "compact", maximumFractionDigits: 1 });
  return <section className={styles.card}>
    <header><div className={styles.title}><CalendarDays /><div><h3>{t("settings.tokenUsageTitle")}</h3><span>{entries.length ? t("settings.tokenUsageTotal", { count: number.format(total) }) : t("settings.noTokenUsage")}</span></div></div></header>
    <div className={styles.scroller}>
      <div className={styles.calendar} aria-label={t("settings.tokenUsageTitle")}>
        {cells.map((day, index) => day ? <Tooltip key={day.date} content={t("settings.tokenUsageDay", { date: day.date, count: number.format(day.tokens) })}>
          <span className={styles.day} data-level={day.tokens === 0 || max === 0 ? 0 : Math.max(1, Math.ceil(day.tokens / max * 4))} />
        </Tooltip> : <span key={`blank-${index}`} />)}
      </div>
    </div>
  </section>;
}
