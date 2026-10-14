import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const base = (process.env.BACKEND_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
    const response = await fetch(`${base}/openapi.yaml`, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    return new NextResponse(await response.text(), {
      status: response.status,
      headers: { "Content-Type": "application/yaml; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ detail: "백엔드를 실행한 뒤 API 명세를 열어 주세요." }, { status: 502 });
  }
}
