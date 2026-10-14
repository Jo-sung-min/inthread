import type { Platform, Post } from "@/lib/client-api";

export const DASHBOARD_TIME_ZONE = "Asia/Seoul";
export type DailyRegistration = { date: string; label: string; count: number };
export type ChannelCount = { platform: Platform; count: number; percentage: number };
export type DashboardStats = {
  total: number;
  published: number;
  drafts: number;
  attention: number;
  createdLast7Days: number;
  last7Days: DailyRegistration[];
  channels: ChannelCount[];
};

const koreanDate = new Intl.DateTimeFormat("en-CA", {
  timeZone: DASHBOARD_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

function dateKey(date: Date) {
  const parts = koreanDate.formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function buildDashboardStats(posts: readonly Post[], now = new Date()): DashboardStats {
  const today = dateKey(now);
  const [year, month, day] = today.split("-").map(Number);
  const last7Days = Array.from({ length: 7 }, (_, index) => {
    // Iterate calendar dates rather than host-local midnights.
    const date = new Date(Date.UTC(year, month - 1, day - 6 + index)).toISOString().slice(0, 10);
    const [, monthLabel, dayLabel] = date.split("-");
    return { date, label: `${Number(monthLabel)}.${Number(dayLabel)}`, count: 0 };
  });
  const days = new Map(last7Days.map(item => [item.date, item]));
  const counts: Record<Platform, number> = { INSTAGRAM: 0, THREADS: 0 };
  let published = 0;
  let drafts = 0;
  let attention = 0;

  for (const post of posts) {
    counts[post.platform]++;
    if (post.status === "PUBLISHED") published++;
    if (post.status === "DRAFT") drafts++;
    if (["PUBLISH_FAILED", "PUBLISH_PARTIAL", "PUBLISH_UNKNOWN"].includes(post.status)) attention++;
    const timestamp = new Date(post.createdAt);
    if (!Number.isFinite(timestamp.getTime()) || timestamp.getTime() > now.getTime()) continue;
    const bucket = days.get(dateKey(timestamp));
    if (bucket) bucket.count++;
  }

  return {
    total: posts.length, published, drafts, attention,
    createdLast7Days: last7Days.reduce((total, item) => total + item.count, 0),
    last7Days,
    channels: (["INSTAGRAM", "THREADS"] as const).map(platform => ({
      platform, count: counts[platform], percentage: posts.length ? counts[platform] / posts.length * 100 : 0,
    })),
  };
}
