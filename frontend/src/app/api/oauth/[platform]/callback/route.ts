import { NextRequest, NextResponse } from "next/server";
import { backend, guard, problem, requestOrigin, safeEqual } from "@/lib/server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ platform: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { platform } = await context.params;
  if (platform !== "instagram" && platform !== "threads") return problem(404, "지원하지 않는 채널입니다.");
  const origin = requestOrigin(request);
  if (!origin) return problem(403, "허용되지 않은 워크스페이스 주소입니다.");
  const finish = (success: boolean, reason?: string) => {
    const target = new URL("/connections", origin);
    target.searchParams.set("connection", success ? "success" : "error");
    target.searchParams.set("platform", platform);
    if (reason) target.searchParams.set("reason", reason);
    const response = NextResponse.redirect(target, 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.cookies.set(`insauto_oauth_${platform}`, "", {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 0,
      path: `/api/oauth/${platform}/callback`,
    });
    return response;
  };
  if (guard(request)) return finish(false, "session");
  const query = request.nextUrl.searchParams;
  const state = query.get("state");
  const cookie = request.cookies.get(`insauto_oauth_${platform}`)?.value;
  if (query.getAll("state").length !== 1 || !state || !cookie || state.length > 512 || !safeEqual(state, cookie)) return finish(false, "state");
  if (query.has("error")) return finish(false, "denied");
  const code = query.get("code");
  if (query.getAll("code").length !== 1 || !code || code.length > 4096) return finish(false, "failed");
  try {
    const response = await backend(`connections/${platform.toUpperCase()}/oauth/complete`, "POST", JSON.stringify({ code, state }), 40_000);
    return finish(response.ok, response.ok ? undefined : "failed");
  } catch {
    return finish(false, "failed");
  }
}
