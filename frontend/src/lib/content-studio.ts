import type { Platform } from "@/lib/client-api";
export type StudioOptions = {
  topics: { id: string; label: string; description: string }[];
  devices: { id: string; label: string; description: string }[];
  tones: { id: string; label: string }[];
  maxBatchSize: number;
};
export type GeneratedSeries = {
  id: string; topicId: string; title: string; segments: string[];
  instagramCaption: string; devices: string[]; tone: "DIRECT" | "WARM";
};
export type GenerationResult = { generator: "TEMPLATE"; generatedAt: string; items: GeneratedSeries[]; notice: string };
export type BatchPost = { platform: Platform; text: string; segments?: string[]; mediaUrl: null };
export type BatchIdentity = { fingerprint: string; requestId: string };
export const segmentCount = (text: string) => Array.from(text.trim()).length;
export function validSegments(segments: string[]) {
  return segments.length === 4 && segments.every(text => segmentCount(text) > 0 && segmentCount(text) <= 500);
}
export function batchPosts(items: GeneratedSeries[], platform: Platform): BatchPost[] {
  return items.map(item => {
    if (!validSegments(item.segments)) throw new Error("네 문단을 모두 1~500자로 작성해 주세요.");
    const segments = item.segments.map(text => text.trim());
    return platform === "THREADS"
      ? { platform, text: segments[0], segments, mediaUrl: null }
      : { platform, text: segments.join("\n\n"), mediaUrl: null };
  });
}
export function identifyBatch(previous: BatchIdentity | null, posts: BatchPost[], newId: () => string): BatchIdentity {
  const fingerprint = JSON.stringify(posts);
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, requestId: newId() };
}
export const seriesStatusLabel: Record<string, string> = {
  DRAFT: "저장된 초안", SCHEDULED: "시뮬레이션 예약", SIMULATED: "시뮬레이션 완료",
  PUBLISHING: "실제 발행 중", PUBLISHED: "실제 발행 완료", PUBLISH_FAILED: "발행 실패",
  PUBLISH_PARTIAL: "일부 발행 완료", PUBLISH_UNKNOWN: "결과 확인 필요",
};

export type BatchAttempt = BatchIdentity & {
  posts: BatchPost[];
  platform: Platform;
  sourceIds: string[];
  sourceKeys: string[];
};
export function savedVariantKey(item: Pick<GeneratedSeries, "id" | "segments">, platform: Platform) {
  return `${item.id}:${platform}:${JSON.stringify(item.segments.map(part => part.trim()))}`;
}
export function createBatchAttempt(items: GeneratedSeries[], platform: Platform, previous: BatchIdentity | null, newId: () => string): BatchAttempt {
  const posts = batchPosts(items, platform);
  return {
    ...identifyBatch(previous, posts, newId),
    posts,
    platform,
    sourceIds: items.map(item => item.id),
    sourceKeys: items.map(item => savedVariantKey(item, platform)),
  };
}
