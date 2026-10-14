import { NextRequest, NextResponse } from "next/server";
import { backend, guard, problem, readBody, safeEqual } from "@/lib/server-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ platform: string }> };

export async function POST(request: NextRequest, context: Context) {
  const denied = guard(request, true);
  if (denied) return denied;
  const { platform } = await context.params;
  if (platform !== "instagram" && platform !== "threads") return problem(404, "지원하지 않는 채널입니다.");
  const body = await readBody(request);
  if (typeof body !== "string") return body;
  try {
    const result = await backend(`connections/${platform.toUpperCase()}/oauth/start`, "POST", "{}");
    if (!result.ok) {
      // Configuration details and provider payloads are never passed through this boundary.
      return problem(result.status, "연결을 시작할 수 없습니다. 채널의 연결 설정을 확인해 주세요.");
    }
    const value = await result.json();
    if (typeof value.state !== "string" || !/^[a-zA-Z0-9_-]{20,512}$/.test(value.state) || typeof value.authorizationUrl !== "string") {
      return problem(502, "연결 응답을 확인할 수 없습니다.");
    }
    const url = new URL(value.authorizationUrl);
    const hosts = platform === "instagram" ? ["instagram.com", "www.instagram.com"] : ["threads.net", "www.threads.net", "threads.com", "www.threads.com"];
    const origin = request.headers.get("origin")!;
    const expectedCallback = `${origin}/api/oauth/${platform}/callback`;
    if (url.protocol !== "https:" || !hosts.includes(url.hostname) || !safeEqual(url.searchParams.get("state") || "", value.state)) {
      return problem(502, "연결 주소를 확인할 수 없습니다.");
    }
    if (url.searchParams.get("redirect_uri") !== expectedCallback) {
      return problem(409, "사이트에 설정된 연결 주소로 접속한 뒤 다시 시도해 주세요. 운영자가 설정한 사이트 주소와 현재 주소가 다릅니다.");
    }
    const response = NextResponse.json({ authorizationUrl: url.toString() }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(`insauto_oauth_${platform}`, value.state, {
      httpOnly: true, secure: true, sameSite: "lax", maxAge: 600,
      path: `/api/oauth/${platform}/callback`,
    });
    return response;
  } catch {
    return problem(502, "연결 서버에 응답이 없습니다. 잠시 후 다시 시도해 주세요.");
  }
}
