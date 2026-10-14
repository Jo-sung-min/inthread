"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionsPanel } from "@/components/connections-panel";
import { WorkspaceLogin } from "@/components/workspace-login";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { api, ApiError, Connection, errorMessage } from "@/lib/client-api";
import "./connections.css";

export default function ConnectionsPage() {
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const sequence = useRef(0);
  const logoutLock = useRef(false);

  const lockWorkspace = useCallback(() => {
    sequence.current += 1;
    setConnections(null);
    setLocked(true);
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const [nextConnections, authentication] = await Promise.all([
        api<Connection[]>("connections"),
        fetch("/api/auth/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) })
          .then(response => {
            if (!response.ok) throw new Error("로그인 상태를 확인하지 못했습니다.");
            return response.json() as Promise<{ required: boolean }>;
          }),
      ]);
      if (request !== sequence.current) return;
      setConnections(nextConnections);
      setAuthRequired(authentication.required);
      setLocked(false);
    } catch (failure) {
      if (request !== sequence.current) return;
      if (failure instanceof ApiError && failure.status === 401) lockWorkspace();
      else setError(errorMessage(failure));
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [lockWorkspace]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has("connection")) {
      const platform = query.get("platform") === "instagram" ? "Instagram" : "Threads";
      if (query.get("connection") === "success") setNotice(`${platform} 계정을 연결했습니다.`);
      else setNotice(query.get("reason") === "session"
        ? "로그인 후 계정 연결을 다시 시작해 주세요."
        : "계정을 연결하지 못했습니다. 연결하기를 다시 눌러 주세요.");
      query.delete("connection"); query.delete("platform"); query.delete("reason");
      window.history.replaceState({}, "", `${window.location.pathname}${query.size ? `?${query}` : ""}`);
    }
    void refresh();
    return () => { sequence.current += 1; };
  }, [refresh]);

  async function signOut() {
    if (logoutLock.current) return;
    logoutLock.current = true;
    setSigningOut(true);
    setError("");
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok && response.status !== 401) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      setNotice("");
      lockWorkspace();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { logoutLock.current = false; setSigningOut(false); }
  }

  if (locked) return <WorkspaceLogin onSuccess={() => { setLocked(false); void refresh(); }} />;
  return <div className="app-shell">
    <WorkspaceSidebar active="accounts" />
    <main className="connections-main">
      <header className="topbar"><strong>계정 연결</strong><div className="topbar-actions">
        <button className="text-button" disabled={loading || signingOut} onClick={() => void refresh()}>{loading ? "확인 중…" : "새로고침"}</button>
        {authRequired && <button className="text-button" disabled={signingOut} onClick={() => void signOut()}>로그아웃</button>}
      </div></header>
      <div className="content connections-content">
        <div className="connections-page-heading"><h1>계정 연결</h1><p>게시할 계정을 선택하고 공식 로그인으로 연결하세요.</p></div>
        {notice && <div className="connections-notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}>×</button></div>}
        {error && <div className="connection-error" role="alert"><p>{error}</p><button className="button secondary small" disabled={loading || signingOut} onClick={() => void refresh()}>다시 확인</button></div>}
        <ConnectionsPanel connections={connections} disabled={loading || signingOut || !!error} onChanged={refresh} onUnauthorized={lockWorkspace} />
      </div>
    </main>
  </div>;
}
