import { NextRequest, NextResponse } from "next/server";
import { clearSession, guard } from "@/lib/server-api";
export async function POST(request: NextRequest) {
  const denied = guard(request, true);
  if (denied) return denied;
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  clearSession(response);
  return response;
}
