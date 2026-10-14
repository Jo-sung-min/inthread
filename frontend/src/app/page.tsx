"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { DashboardStatistics } from "@/components/dashboard-statistics";
import { DraftDialog } from "@/components/draft-dialog";
import { WorkspaceLogin } from "@/components/workspace-login";
import { PublishedLink, PublishDialog } from "@/components/publish-dialog";
import { api, ApiError, Connection, errorMessage, Platform, Post, platformLabel } from "@/lib/client-api";
import "./dashboard.css";

type Activity = { id: string; postId: string; platform: Platform; type: string; message: string; createdAt: string };
type Dashboard = { posts: Post[]; connections: Connection[]; activity: Activity[] };
const attentionStates = new Set(["PUBLISH_FAILED", "PUBLISH_UNKNOWN", "PUBLISH_PARTIAL"]);
const statusLabel = { DRAFT: "작성 중", SCHEDULED: "모의 실행 예약", SIMULATED: "모의 실행 완료", PUBLISHING: "게시 중", PUBLISHED: "게시 완료", PUBLISH_FAILED: "게시 실패", PUBLISH_UNKNOWN: "결과 확인 필요", PUBLISH_PARTIAL: "일부 게시됨" };
const activityLabel: Record<string, string> = { DRAFT_CREATED: "초안 등록", DRAFT_UPDATED: "초안 수정", POST_SCHEDULED: "모의 실행 예약", SCHEDULE_CANCELLED: "예약 취소", DRY_RUN_STARTED: "모의 실행 시작", DRY_RUN_COMPLETED: "모의 실행 완료", SIMULATION_COMPLETED: "모의 실행 완료", PUBLISH_STARTED: "게시 시작", PUBLISH_PART_CONFIRMED: "문단 게시 확인", PUBLISH_CONFIRMED: "게시 완료", PUBLISH_FAILED: "게시 실패", PUBLISH_UNCERTAIN: "게시 결과 확인 필요" };
const formatDate = (value: string) => new Date(value).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
const previewTitle = (post: Post) => post.text.split("\n").find(line => line.trim()) || "제목 없는 콘텐츠";

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [composer, setComposer] = useState<{ post: Post | null } | null>(null);
  const [publishTarget, setPublishTarget] = useState<{ post: Post; connection: Connection } | null>(null);
  const [uncertainPosts, setUncertainPosts] = useState<Set<string>>(new Set());
  const [channel, setChannel] = useState<"ALL" | Platform>("ALL");
  const [status, setStatus] = useState<"ALL" | "DRAFT" | "ATTENTION">("ALL");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(8);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, string>>({});
  const sequence = useRef(0);
  const actionLock = useRef(false);

  const lockWorkspace = useCallback(() => {
    sequence.current += 1;
    setLocked(true); setData(null); setComposer(null); setPublishTarget(null); setConnectionError("");
  }, []);
  const refresh = useCallback(async (showLoading = false) => {
    const current = ++sequence.current;
    if (showLoading) setLoading(true);
    try {
      const [posts, connections, activity, authentication] = await Promise.all([
        api<Post[]>("posts"), api<Connection[]>("connections"), api<Activity[]>("activity"),
        fetch("/api/auth/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then(response => response.ok ? response.json() as Promise<{ required: boolean }> : { required: false }),
      ]);
      if (current !== sequence.current) return;
      setData({ posts, connections, activity }); setAuthRequired(authentication.required); setConnectionError("");
    } catch (failure) {
      if (current !== sequence.current) return;
      if (failure instanceof ApiError && failure.status === 401) lockWorkspace();
      else setConnectionError(errorMessage(failure));
    } finally { if (current === sequence.current) setLoading(false); }
  }, [lockWorkspace]);
  useEffect(() => {
    // Old section bookmarks open the dashboard at its start instead of selecting a scroll-only menu.
    if (window.location.hash) window.history.replaceState({}, "", window.location.pathname + window.location.search);
    if (locked) return;
    void refresh(true);
    const timer = setInterval(() => void refresh(), 15_000);
    return () => { clearInterval(timer); sequence.current += 1; };
  }, [locked, refresh]);

  async function perform(key: string, action: () => Promise<unknown>, message: string) {
    if (actionLock.current) return;
    actionLock.current = true; setBusy(key); setActionError(""); setNotice("");
    try { await action(); sequence.current += 1; setNotice(message); await refresh(); }
    catch (failure) { if (failure instanceof ApiError && failure.status === 401) lockWorkspace(); else setActionError(errorMessage(failure)); }
    finally { actionLock.current = false; setBusy(null); }
  }
  async function signOut() {
    await perform("logout", async () => {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
      if (!response.ok && response.status !== 401) throw new Error("로그아웃하지 못했습니다.");
      lockWorkspace();
    }, "");
  }
  function saved(post: Post) {
    sequence.current += 1;
    const edited = !!composer?.post;
    setData(previous => previous ? { ...previous, posts: [post, ...previous.posts.filter(item => item.id !== post.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) } : previous);
    setComposer(null); setNotice(edited ? "변경 사항을 저장했습니다." : "초안을 등록했습니다. 내용을 확인하고 발행하세요.");
    setQuery(""); setChannel("ALL"); setStatus("ALL"); setShown(8);
    void refresh();
  }
  async function publish() {
    if (!publishTarget || actionLock.current) return;
    const { post, connection } = publishTarget;
    actionLock.current = true; setBusy(`publish-${post.id}`); setActionError(""); setNotice("");
    try {
      const result = await api<Post>(`posts/${post.id}/publish`, { accountId: connection.accountId, expectedUpdatedAt: post.updatedAt });
      sequence.current += 1;
      setData(previous => previous ? { ...previous, posts: previous.posts.map(item => item.id === result.id ? result : item) } : previous);
      if (result.status === "PUBLISHED") setNotice(`${platformLabel(post.platform)} 게시를 완료했습니다.`);
      else {
        if (result.status !== "PUBLISH_FAILED") setUncertainPosts(previous => new Set(previous).add(post.id));
        setActionError(result.publishError || "게시 결과를 확인해 주세요. 자동으로 재전송하지 않습니다.");
      }
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) lockWorkspace();
      else if (!(failure instanceof ApiError) || failure.status >= 500) {
        setUncertainPosts(previous => new Set(previous).add(post.id));
        setActionError("게시 결과를 확인하지 못했습니다. 다시 발행하기 전에 연결 계정에서 결과를 확인해 주세요.");
      } else setActionError(errorMessage(failure));
    } finally { setPublishTarget(null); await refresh(); actionLock.current = false; setBusy(null); }
  }
  function togglePost(id: string) { setExpanded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  const posts = data?.posts || [];
  const available = !!data && !connectionError;
  const visible = posts.filter(post => (channel === "ALL" || post.platform === channel)
    && (status === "ALL" || (status === "DRAFT" ? post.status === "DRAFT" : attentionStates.has(post.status)))
    && `${post.text} ${post.segments?.join(" ") || ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const connectedCount = data?.connections.filter(item => item.connected).length || 0;
  if (locked) return <WorkspaceLogin onSuccess={() => setLocked(false)} />;

  return <div className="app-shell"><WorkspaceSidebar active="dashboard" /><main className="dashboard-main">
    <header className="topbar"><strong>내 워크스페이스</strong><div className="topbar-actions"><span className={`workspace-health ${available ? "ready" : ""}`}><i />{available ? "연결됨" : loading ? "불러오는 중" : "연결 확인 필요"}</span>{authRequired && <button className="text-button" disabled={busy !== null} onClick={() => void signOut()}>로그아웃</button>}</div></header>
    <div className="content dashboard-content">
      <header className="dashboard-heading"><div><h1>대시보드</h1><p>콘텐츠 현황을 한눈에 확인하세요.</p></div><button className="button primary" disabled={!available || busy !== null} onClick={() => { setComposer({ post: null }); setActionError(""); }}>＋ 콘텐츠 등록</button></header>
      {connectionError && <div className="connection-error" role="alert"><div><strong>연결을 확인해 주세요</strong><p>{connectionError}</p></div><button className="button secondary small" disabled={loading} onClick={() => void refresh(true)}>다시 불러오기</button></div>}
      <div aria-live="polite">{notice && <div className="success-notice">{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}>×</button></div>}</div>
      {actionError && <div className="action-error" role="alert">{actionError}</div>}
      <DashboardStatistics posts={posts} loading={loading && !data} unavailable={!!connectionError || (!loading && !data)} />
      <div className="dashboard-connections"><span><i className={connectedCount ? "connected-dot" : ""} />연결 계정 <strong>{data ? connectedCount : "—"}/2</strong></span><p>{connectedCount === 2 ? "Instagram과 Threads에 발행할 수 있습니다." : "계정을 연결하면 저장한 콘텐츠를 발행할 수 있어요."}</p><Link href="/connections">계정 관리 ↗</Link></div>
      <section className="panel content-library" aria-labelledby="library-title">
        <div className="library-heading"><h2 id="library-title">콘텐츠 <span>{data ? posts.length : "—"}</span></h2><button className="text-button" disabled={loading || busy !== null} onClick={() => void refresh(true)}>{loading ? "불러오는 중…" : "새로고침"}</button></div>
        <div className="library-toolbar"><div className="library-filters" aria-label="상태 필터">{(["ALL", "DRAFT", "ATTENTION"] as const).map(value => <button key={value} type="button" aria-pressed={status === value} onClick={() => { setStatus(value); setShown(8); }}>{value === "ALL" ? "전체" : value === "DRAFT" ? "작성 중" : "확인 필요"}</button>)}</div><div className="library-search"><label className="sr-only" htmlFor="content-search">콘텐츠 검색</label><input id="content-search" type="search" placeholder="내용 검색" value={query} onChange={event => { setQuery(event.target.value); setShown(8); }} /><label className="sr-only" htmlFor="channel-filter">채널 필터</label><select id="channel-filter" value={channel} onChange={event => { setChannel(event.target.value as "ALL" | Platform); setShown(8); }}><option value="ALL">모든 채널</option><option value="THREADS">Threads</option><option value="INSTAGRAM">Instagram</option></select></div></div>
        {!visible.length ? <div className="library-empty"><span aria-hidden="true">▤</span><h3>{!data ? "콘텐츠를 불러오는 중입니다" : posts.length ? "조건에 맞는 콘텐츠가 없어요" : "첫 콘텐츠를 등록해 보세요"}</h3><p>{!data ? "연결 후 저장된 콘텐츠가 표시됩니다." : posts.length ? "검색어나 필터를 바꿔 보세요." : "직접 글을 쓰거나 사주 콘텐츠를 만들어 시작할 수 있어요."}</p>{data && !posts.length && <div><button className="button secondary small" disabled={!available} onClick={() => setComposer({ post: null })}>직접 등록</button><Link className="text-link" href="/saju-content">사주 콘텐츠 만들기 ↗</Link></div>}</div> : <div className="library-rows">{visible.slice(0, shown).map(post => {
          const account = data?.connections.find(item => item.platform === post.platform);
          const isSeries = post.segments?.length === 4;
          const canPublish = post.status === "DRAFT" && account?.connected && account.accountId && !uncertainPosts.has(post.id) && (post.platform !== "INSTAGRAM" || !!post.mediaUrl);
          return <article className="library-item" key={post.id}>
            <div className="library-row"><button className="library-title-button" aria-expanded={expanded.has(post.id)} aria-controls={`content-${post.id}`} onClick={() => togglePost(post.id)}><span className={`library-channel ${post.platform.toLowerCase()}`}>{post.platform === "INSTAGRAM" ? "◎" : "@"}</span><span><strong>{previewTitle(post)}</strong><small>{platformLabel(post.platform)}{isSeries ? " · 4부작" : ""} · {formatDate(post.createdAt)}</small></span></button><span className={`badge post-status ${post.status.toLowerCase()}`}>{statusLabel[post.status]}</span><div className="library-actions">{post.status === "DRAFT" ? <>{isSeries ? <Link className="text-button" href={`/saju-content?edit=${post.id}`}>수정</Link> : <button className="text-button" disabled={busy !== null || !available || uncertainPosts.has(post.id)} onClick={() => setComposer({ post })}>수정</button>}<button className="button live small" disabled={busy !== null || !available || !canPublish} title={!account?.connected ? "계정 연결 후 발행할 수 있습니다" : post.platform === "INSTAGRAM" && !post.mediaUrl ? "이미지 주소를 추가해 주세요" : "전체 내용을 확인한 뒤 실제로 게시합니다"} onClick={() => { if (account && canPublish) setPublishTarget({ post, connection: account }); }}>발행</button></> : <PublishedLink href={post.permalink} platform={post.platform} />}</div></div>
            {expanded.has(post.id) && <div className="library-detail" id={`content-${post.id}`}>
              {(post.segments?.length ? post.segments : [post.text]).map((part, index) => <p className="library-full-text" key={index}>{part}</p>)}
              {post.mediaUrl && <p className="library-media">이미지 · {post.mediaUrl}</p>}
              {post.publishedIds?.length ? <p className="library-receipts">게시 확인 {post.publishedIds.length}개 · {post.publishedIds.join(", ")}</p> : null}
              {(attentionStates.has(post.status) || uncertainPosts.has(post.id)) && post.status !== "PUBLISHED" && <p className="library-warning">{post.publishError || "게시 결과를 연결 계정에서 확인해 주세요. 자동으로 재전송하지 않습니다."}</p>}
              {post.status === "PUBLISHING" && <p className="library-note">게시 중 · {post.publishedIds?.length || 0}/{isSeries ? 4 : 1}개 확인 · 15초마다 갱신됩니다.</p>}
              {post.status === "DRAFT" && <details className="simulation-options"><summary>모의 실행 옵션</summary><p>예약과 모의 실행은 실제 계정에 게시하지 않습니다.</p><div><label htmlFor={`schedule-${post.id}`}>예약 시간 <small>기기 시간대</small></label><input type="datetime-local" id={`schedule-${post.id}`} value={scheduleTimes[post.id] || ""} disabled={busy !== null || !available} onChange={event => setScheduleTimes(previous => ({ ...previous, [post.id]: event.target.value }))} /><button className="button secondary small" disabled={busy !== null || !available || !scheduleTimes[post.id]} onClick={() => void perform(`schedule-${post.id}`, () => { const date = new Date(scheduleTimes[post.id]); if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) throw new Error("현재보다 나중인 시간을 선택해 주세요."); return api(`posts/${post.id}/schedule`, { scheduledAt: date.toISOString() }); }, "모의 실행을 예약했습니다.")}>모의 실행 예약</button><button className="text-button" disabled={busy !== null || !available} onClick={() => void perform(`dryrun-${post.id}`, () => api(`posts/${post.id}/dry-run`, {}), "모의 실행을 완료했습니다. 실제로 게시하지 않았습니다.")}>지금 모의 실행</button></div></details>}
              {post.status === "SCHEDULED" && <div className="library-scheduled"><span>{post.scheduledAt && formatDate(post.scheduledAt)} · 모의 실행 예정</span><button className="text-button" disabled={busy !== null || !available} onClick={() => void perform(`cancel-${post.id}`, () => api(`posts/${post.id}/cancel-schedule`, {}), "예약을 취소했습니다.")}>예약 취소</button></div>}
            </div>}
          </article>;
        })}</div>}
        {visible.length > shown && <button className="library-more" onClick={() => setShown(previous => previous + 8)}>더 보기 · {shown}/{visible.length}</button>}
      </section>
      <details className="dashboard-activity"><summary>최근 활동 <span>{data?.activity.length || 0}</span></summary>{data?.activity.length ? <ol>{data.activity.map(item => <li key={item.id}><span><strong>{activityLabel[item.type] || "콘텐츠 상태 변경"}</strong><small>{platformLabel(item.platform)}</small></span><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></li>)}</ol> : <p>아직 활동이 없습니다.</p>}</details>
      <footer className="dashboard-footer"><span>한국 시간 기준 · 15초마다 갱신</span><span>등록·발행 기록 기준 통계</span></footer>
    </div>
    {composer && <DraftDialog post={composer.post} onClose={() => setComposer(null)} onSaved={saved} onUnauthorized={lockWorkspace} />}
    {publishTarget && <PublishDialog post={posts.find(post => post.id === publishTarget.post.id) || publishTarget.post} connection={publishTarget.connection} busy={busy !== null} onCancel={() => setPublishTarget(null)} onConfirm={publish} />}
  </main></div>;
}
