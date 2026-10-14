import { NextRequest, NextResponse } from "next/server";
import { establishSession, guard, loginAllowed, problem, readBody, safeEqual } from "@/lib/server-api";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  const denied = guard(request, true, false);
  if (denied) return denied;
  if (!loginAllowed(request.headers.get("host") || "")) return problem(429, "잠시 후 다시 시도해 주세요.");
  const body = await readBody(request);
  if (typeof body !== "string") return body;
  const input = JSON.parse(body);
  const expected = process.env.INSAUTO_SITE_PASSWORD || "";
  if (expected.length < 16 || typeof input?.password !== "string" || !safeEqual(input.password, expected)) return problem(401, "로그인할 수 없습니다. 입력 내용을 확인해 주세요.");
  const response = NextResponse.json({ authenticated: true }, { headers: { "Cache-Control": "no-store" } });
  establishSession(response);
  return response;
}
