export type Platform = "INSTAGRAM" | "THREADS";
export type PostStatus = "DRAFT" | "SCHEDULED" | "SIMULATED" | "PUBLISHING" | "PUBLISHED" | "PUBLISH_FAILED" | "PUBLISH_UNKNOWN" | "PUBLISH_PARTIAL";
export type Post = {
  id: string; platform: Platform; text: string; mediaUrl: string | null; status: PostStatus;
  scheduledAt: string | null; createdAt: string; updatedAt: string;
  publishedId?: string | null; permalink?: string | null; publishError?: string | null;
  segments?: string[]; publishedIds?: string[];
};
export type Connection = {
  platform: Platform; connected: boolean; username: string | null; accountId: string | null;
  expiresAt: string | null; oauthConfigured: boolean; configurationMessage: string | null;
};
export type FortunePreview = {
  date: string; basis: string; notice: string;
  chart: { year: string; month: string; day: string; hour: string | null; dayElement: string };
  reading: { overall: string; relationship: string; work: string; money: string; action: string };
  instagramText: string; threadsText: string;
};
export const platformLabel = (platform: Platform) => platform === "INSTAGRAM" ? "Instagram" : "Threads";
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); this.name = "ApiError"; }
}
export async function api<T>(path: string, body?: unknown, method: "POST" | "PATCH" | "DELETE" = "POST"): Promise<T> {
  const response = await fetch(`/api/backend/${path}`, {
    method: body === undefined ? "GET" : method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store", signal: AbortSignal.timeout(path.endsWith("/publish") ? 365_000 : 15_000),
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json();
  if (!response.ok) throw new ApiError(value.detail || value.title || "요청을 처리하지 못했습니다.", response.status);
  return value;
}
export function errorMessage(error: unknown) {
  return error instanceof Error && error.name === "TimeoutError"
    ? "응답이 지연되고 있습니다. 잠시 후 상태를 확인해 주세요."
    : error instanceof Error ? error.message : "요청을 처리하지 못했습니다.";
}
