"use client";
import { useRef, useState } from "react";
import { api, ApiError, Connection, errorMessage, Platform, platformLabel } from "@/lib/client-api";

type Props = { connections: Connection[] | null; disabled: boolean; onChanged: () => Promise<void>; onUnauthorized: () => void };
export function ConnectionsPanel({ connections, disabled, onChanged, onUnauthorized }: Props) {
  const [busy, setBusy] = useState<Platform | null>(null);
  const [error, setError] = useState("");
  const [disconnectTarget, setDisconnectTarget] = useState<Platform | null>(null);
  const lock = useRef(false);
  async function connect(platform: Platform) {
    if (lock.current) return;
    lock.current = true;
    setBusy(platform);
    setError("");
    try {
      const response = await fetch(`/api/oauth/${platform.toLowerCase()}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
      const value = await response.json();
      if (!response.ok) throw new ApiError(value.detail || "연결을 시작하지 못했습니다.", response.status);
      if (typeof value.authorizationUrl !== "string") throw new Error("연결 주소를 확인할 수 없습니다.");
      window.location.assign(value.authorizationUrl);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onUnauthorized();
      setError(errorMessage(failure));
      lock.current = false;
      setBusy(null);
    }
  }
  async function disconnect(platform: Platform) {
    if (lock.current) return;
    lock.current = true;
    setBusy(platform);
    setError("");
    try {
      await api(`connections/${platform}`, {}, "DELETE");
      setDisconnectTarget(null);
      await onChanged();
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onUnauthorized();
      setError(errorMessage(failure));
    } finally { lock.current = false; setBusy(null); }
  }
  return <section className="connections-section" id="connections" aria-labelledby="connections-heading">
    <div className="section-heading"><h2 id="connections-heading">내 계정 연결</h2><span className="section-caption">Meta 공식 로그인으로 직접 연결하세요</span></div>
    <div className="connection-cards">{(["INSTAGRAM", "THREADS"] as Platform[]).map(platform => {
      const connection = connections?.find(item => item.platform === platform);
      return <article className="account-card" key={platform}>
        <div className="account-card-heading"><span className={`channel-icon ${platform.toLowerCase()}`} aria-hidden="true">{platform === "INSTAGRAM" ? "◎" : "@"}</span><div><h3>{platformLabel(platform)}</h3><span className={connection?.connected ? "account-connected" : "account-disconnected"}>{connection ? connection.connected ? "계정 연결됨" : "아직 연결하지 않았어요" : "연결 정보 확인 중"}</span></div></div>
        {connection?.connected ? <><strong className="connected-username">{connection.username ? `@${connection.username.replace(/^@/, "")}` : "연결된 계정"}</strong><p className="account-description">{connection.expiresAt ? `${new Date(connection.expiresAt).toLocaleDateString("ko-KR")}까지 연결 유효` : "이 계정으로 콘텐츠를 게시할 수 있어요."}</p><div className="account-actions"><button className="button secondary small" onClick={() => void connect(platform)} disabled={disabled || busy !== null || !connection.oauthConfigured}>{busy === platform ? "처리 중…" : "다시 연결"}</button><button className="text-button" onClick={() => setDisconnectTarget(platform)} disabled={disabled || busy !== null}>연결 해제</button></div></>
          : <><p className="account-description">{platform === "INSTAGRAM" ? "Instagram 프로페셔널 계정의 게시 권한을 연결합니다." : "Threads 계정을 연결하고 글을 직접 게시해 보세요."}</p><button className="button secondary account-connect" onClick={() => void connect(platform)} disabled={disabled || busy !== null || !connection?.oauthConfigured}>{busy === platform ? "로그인으로 이동 중…" : `${platformLabel(platform)} 연결하기`}</button></>}
        {connection && !connection.oauthConfigured && <p className="account-setup">{connection.configurationMessage || "사이트 운영자의 Meta 연결 설정이 필요합니다. 설정이 완료되면 계정을 연결할 수 있어요."}</p>}
        {disconnectTarget === platform && <div className="disconnect-confirm"><p>이 사이트의 {platformLabel(platform)} 연결을 해제할까요? 이미 게시한 콘텐츠는 그대로 유지됩니다.</p><div><button className="button secondary small" onClick={() => setDisconnectTarget(null)} disabled={busy !== null}>유지하기</button><button className="button danger small" onClick={() => void disconnect(platform)} disabled={busy !== null}>연결 해제</button></div></div>}
      </article>;
    })}</div>
    {error && <p className="connection-action-error" role="alert">{error}</p>}
    {connections?.some(item => !item.oauthConfigured) && <details className="operator-note"><summary>운영자 연결 설정 안내</summary><p>Meta 앱의 Instagram·Threads 로그인 설정, 승인된 HTTPS 콜백 주소, 서버의 앱 인증 정보가 필요합니다. 사이트 사용자는 비밀번호나 액세스 토큰을 이 화면에 입력하지 않습니다.</p><p>설정 순서는 프로젝트의 <code>docs/meta-setup.md</code>를 확인하세요.</p></details>}
  </section>;
}
