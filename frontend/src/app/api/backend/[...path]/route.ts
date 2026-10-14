import { NextRequest, NextResponse } from "next/server";
import { backend, guard, problem, readBody } from "@/lib/server-api";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
type Context = { params: Promise<{ path: string[] }> };
const READ_PATHS = new Set(["health", "posts", "channels", "activity", "connections", "content-studio/options"]);
const DRAFT_PATH = /^posts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_ACTION = /^posts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/(schedule|cancel-schedule|dry-run|publish)$/i;
const CONNECTION = /^connections\/(INSTAGRAM|THREADS)$/;

async function proxy(request: NextRequest, context: Context) {
  const mutation = request.method !== "GET";
  const denied = guard(request, mutation);
  if (denied) return denied;
  const { path } = await context.params;
  const endpoint = path.join("/");
  const allowed = request.method === "GET" ? READ_PATHS.has(endpoint)
    : request.method === "POST" ? endpoint === "posts" || endpoint === "posts/batch" || endpoint === "content-studio/generate" || endpoint === "fortunes/preview" || POST_ACTION.test(endpoint)
      : request.method === "PATCH" ? DRAFT_PATH.test(endpoint)
        : request.method === "DELETE" && CONNECTION.test(endpoint);
  if (!allowed) return problem(404, "지원하지 않는 API 경로입니다.");
  let body: string | undefined;
  if (mutation) {
    const parsed = await readBody(request, endpoint === "posts/batch" ? 131_072 : 16_384);
    if (typeof parsed !== "string") return parsed;
    body = parsed;
  }
  try {
    const response = await backend(endpoint, request.method, body, endpoint.endsWith("/publish") ? 360_000 : 10_000);
    return new NextResponse(response.status === 204 ? null : await response.text(), {
      status: response.status,
      headers: { "Content-Type": response.headers.get("content-type") || "application/json", "Cache-Control": "no-store" },
    });
  } catch {
    return problem(502, endpoint.endsWith("/publish")
      ? "게시 결과를 확인하지 못했습니다. 다시 게시하지 말고 연결 계정과 콘텐츠 상태를 확인해 주세요."
      : "백엔드에 연결할 수 없습니다. 백엔드를 실행한 뒤 다시 시도해 주세요.");
  }
}
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
