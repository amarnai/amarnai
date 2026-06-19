import type { ThreadItem } from "./types.js";

export type DateSection = {
  label: "Today" | "Yesterday" | "Earlier";
  data: ThreadItem[];
};

export function groupThreadsByDate(threads: ThreadItem[]): DateSection[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);

  const today: ThreadItem[] = [];
  const yesterday: ThreadItem[] = [];
  const earlier: ThreadItem[] = [];

  for (const t of threads) {
    if (t.latestAt >= todayStart) {
      today.push(t);
    } else if (t.latestAt >= yesterdayStart) {
      yesterday.push(t);
    } else {
      earlier.push(t);
    }
  }

  const sections: DateSection[] = [];
  if (today.length > 0) sections.push({ label: "Today", data: today });
  if (yesterday.length > 0) sections.push({ label: "Yesterday", data: yesterday });
  if (earlier.length > 0) sections.push({ label: "Earlier", data: earlier });

  return sections;
}
