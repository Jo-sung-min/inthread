import { NextRequest, NextResponse } from "next/server";
import { guard, hasSession, passwordRequired } from "@/lib/server-api";
export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const denied = guard(request, false, false);
  if (denied) return denied;
  return NextResponse.json({ required: passwordRequired(), authenticated: hasSession(request) }, { headers: { "Cache-Control": "no-store" } });
}
