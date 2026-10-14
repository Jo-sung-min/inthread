"use client";
import { FormEvent, useRef, useState } from "react";

export function WorkspaceLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }), signal: AbortSignal.timeout(10_000) });
      if (!response.ok) {
        const value = await response.json();
        throw new Error(value.detail || "로그인할 수 없습니다.");
      }
      setPassword("");
      onSuccess();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "로그인할 수 없습니다.");
    } finally { lock.current = false; setBusy(false); }
  }
  return <main className="login-page"><div className="login-card">
    <span className="eyebrow">INSAUTO / PRIVATE WORKSPACE</span>
    <h1>내 공간으로<br />들어오세요.</h1>
    <p>계정을 연결하고 콘텐츠를 관리하는 비공개 워크스페이스입니다.</p>
    <form onSubmit={signIn}>
      <label htmlFor="workspace-password">워크스페이스 비밀번호</label>
      <input id="workspace-password" type="password" autoComplete="current-password" required value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
      {error && <p className="login-error" role="alert">{error}</p>}
      <button type="submit" className="button primary" disabled={busy || !password}>{busy ? "확인 중…" : "워크스페이스 열기"}</button>
    </form>
    <p className="login-note">이 사이트의 운영자가 정한 비밀번호를 사용하세요. 로그인 후에도 이 화면이 계속 보이면 운영자가 설정한 HTTPS 사이트 주소로 접속해 주세요.</p>
  </div></main>;
}
