import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "insauto_session";
const SESSION_SECONDS = 8 * 60 * 60;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const loginAttempts = new Map<string, { count: number; resetAt: number }>();

export function frontendOrigins(): Set<string> {
  const origins = new Set(["http://127.0.0.1:3001", "http://localhost:3001"]);
  const configured = process.env.FRONTEND_ORIGIN;
  if (configured) {
    try {
      const url = new URL(configured);
      if (url.origin === configured && (url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname)))) origins.add(configured);
    } catch { /* Invalid origins never weaken the default allowlist. */ }
  }
  return origins;
}

export function problem(status: number, detail: string) {
  return NextResponse.json({ title: "요청을 처리할 수 없습니다", status, detail }, {
    status, headers: { "Content-Type": "application/problem+json", "Cache-Control": "no-store" },
  });
}

export function requestOrigin(request: NextRequest): string | null {
  const host = request.headers.get("host");
  const origins = frontendOrigins();
  const configured = process.env.FRONTEND_ORIGIN;
  if (configured && origins.has(configured) && new URL(configured).host === host) return configured;
  return [...origins].find(origin => new URL(origin).host === host) || null;
}

export function passwordRequired() {
  if (process.env.INSAUTO_SITE_PASSWORD) return true;
  const configured = process.env.FRONTEND_ORIGIN;
  if (configured) {
    try { if (!LOOPBACK.has(new URL(configured).hostname)) return true; }
    catch { return true; }
  }
  return [...frontendOrigins()].some(origin => !LOOPBACK.has(new URL(origin).hostname));
}

function sessionSignature(payload: string) {
  return createHmac("sha256", process.env.INSAUTO_SITE_PASSWORD || "").update(payload).digest("base64url");
}

export function safeEqual(left: string, right: string) {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function hasSession(request: NextRequest) {
  if (!passwordRequired()) return true;
  if ((process.env.INSAUTO_SITE_PASSWORD?.length || 0) < 16) return false;
  const value = request.cookies.get(SESSION_COOKIE)?.value;
  if (!value || value.length > 256) return false;
  const pieces = value.split(".");
  if (pieces.length !== 3 || !/^\d{10}$/.test(pieces[0]) || !/^[a-f0-9]{32}$/.test(pieces[1])) return false;
  const age = Math.floor(Date.now() / 1000) - Number(pieces[0]);
  return age >= -30 && age <= SESSION_SECONDS && safeEqual(pieces[2], sessionSignature(`${pieces[0]}.${pieces[1]}`));
}

export function guard(request: NextRequest, mutation = false, requireSession = true): NextResponse | null {
  const origin = requestOrigin(request);
  if (!origin) return problem(403, "허용되지 않은 워크스페이스 주소입니다.");
  if (mutation) {
    const source = request.headers.get("origin");
    if (!source || !frontendOrigins().has(source) || new URL(source).host !== request.headers.get("host")) {
      return problem(403, "동일한 워크스페이스에서 요청해 주세요.");
    }
    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return problem(415, "application/json 형식으로 요청해 주세요.");
    }
  }
  if (requireSession && !hasSession(request)) return problem(401, "워크스페이스에 로그인해 주세요.");
  return null;
}

export async function readBody(request: NextRequest, maxBytes = 16_384): Promise<string | NextResponse> {
  if (Number(request.headers.get("content-length") || 0) > maxBytes) return problem(413, "요청 내용이 너무 큽니다.");
  const reader = request.body?.getReader();
  if (!reader) return problem(400, "JSON 요청이 필요합니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); return problem(413, "요청 내용이 너무 큽니다."); }
    chunks.push(value);
  }
  const body = Buffer.concat(chunks).toString("utf8");
  try { JSON.parse(body); } catch { return problem(400, "올바른 JSON 요청이 필요합니다."); }
  return body;
}

export async function backend(endpoint: string, method = "GET", body?: string, timeout = 8_000) {
  const base = (process.env.BACKEND_URL || "http://127.0.0.1:8081").replace(/\/$/, "");
  return fetch(`${base}/api/v1/${endpoint}`, {
    method,
    headers: { Accept: "application/json", "X-API-Key": process.env.INSAUTO_API_KEY || "local-dev-key", ...(body ? { "Content-Type": "application/json" } : {}) },
    body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(timeout),
  });
}

export function loginAllowed(host: string) {
  const now = Date.now();
  let entry = loginAttempts.get(host);
  if (!entry || entry.resetAt <= now) {
    entry = { count: 0, resetAt: now + 15 * 60_000 };
    loginAttempts.set(host, entry);
  }
  entry.count += 1;
  return entry.count <= 8;
}

export function establishSession(response: NextResponse) {
  const payload = `${Math.floor(Date.now() / 1000)}.${randomBytes(16).toString("hex")}`;
  response.cookies.set(SESSION_COOKIE, `${payload}.${sessionSignature(payload)}`, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_SECONDS,
  });
}

export function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 });
}
