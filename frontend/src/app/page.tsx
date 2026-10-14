"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { api, ApiError, Connection, errorMessage, Platform, Post, platformLabel } from "@/lib/client-api";
import { ConnectionsPanel } from "@/components/connections-panel";
import { FortunePanel } from "@/components/fortune-panel";
import { WorkspaceLogin } from "@/components/workspace-login";
import { PublishedLink, PublishDialog } from "@/components/publish-dialog";

type Channel = { platform: Platform; name: string; connected: boolean; mode: "DRY_RUN" | "LIVE_AVAILABLE"; textLimit: number; description: string };
type Activity = { id: string; postId: string; platform: Platform; type: string; message: string; createdAt: string };
type Dashboard = { posts: Post[]; channels: Channel[]; activity: Activity[]; connections: Connection[]; health: { status: string; mode: "DRY_RUN" | "EXPLICIT_LIVE_PUBLISH" } };
type IconName = "grid" | "plus" | "arrow" | "clock" | "check" | "bolt" | "code" | "refresh" | "instagram" | "threads" | "file" | "activity" | "close";

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
    code: <><path d="m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 18" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3" /></>,
    instagram: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r=".6" fill="currentColor" /></>,
    threads: <><path d="M18.5 7.5C17.5 4.5 15.5 3 12 3 6.4 3 4 6.9 4 12s2.4 9 8 9c4.5 0 7.5-2.8 7.5-6.1 0-3.2-3-5.3-7.3-5.3-3 0-4.5 1.5-4.5 3.4 0 1.7 1.1 2.8 3.1 2.8 2.9 0 4.3-2.4 4.3-5.6 0-2.5-1.2-4-3.3-4-1.5 0-2.7.8-3.2 2" /></>,
    file: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9l-6-6Z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    close: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const statusLabel = { DRAFT: "초안", SCHEDULED: "시뮬레이션 예약", SIMULATED: "시뮬레이션 완료", PUBLISHING: "실제 게시 처리 중", PUBLISHED: "실제 게시 완료", PUBLISH_FAILED: "게시 실패", PUBLISH_UNKNOWN: "게시 결과 확인 필요", PUBLISH_PARTIAL: "일부 실제 게시 완료" };
const dateFormat = new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
const formatDate = (value: string) => dateFormat.format(new Date(value));

export default function Home() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [publishTarget, setPublishTarget] = useState<{ post: Post; connection: Connection } | null>(null);
  const [uncertainPosts, setUncertainPosts] = useState<Set<string>>(new Set());
  const [connectionError, setConnectionError] = useState("");
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<"ALL" | Platform>("ALL");
  const [platform, setPlatform] = useState<Platform>("THREADS");
  const [text, setText] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [scheduleTimes, setScheduleTimes] = useState<Record<string, string>>({});
  const requestSequence = useRef(0);
  const actionLock = useRef(false);
  const textInput = useRef<HTMLTextAreaElement>(null);
  const errorBox = useRef<HTMLDivElement>(null);

  const lockWorkspace = useCallback(() => {
    setLocked(true);
    setData(null);
    setPublishTarget(null);
    setConnectionError("");
  }, []);

  const refresh = useCallback(async (showLoading = false) => {
    const sequence = ++requestSequence.current;
    if (showLoading) setLoading(true);
    try {
      const [health, posts, channels, activity, connections, authentication] = await Promise.all([
        api<Dashboard["health"]>("health"), api<Post[]>("posts"), api<Channel[]>("channels"), api<Activity[]>("activity"), api<Connection[]>("connections"),
        fetch("/api/auth/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then(response => response.ok ? response.json() as Promise<{ required: boolean }> : { required: false }),
      ]);
      if (sequence === requestSequence.current) {
        setData({ health, posts, channels, activity, connections });
        setAuthRequired(authentication.required);
        setConnectionError("");
      }
    } catch (error) {
      if (sequence === requestSequence.current) {
        if (error instanceof ApiError && error.status === 401) lockWorkspace();
        else setConnectionError(errorMessage(error));
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [lockWorkspace]);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    if (query.has("connection")) {
      const name = query.get("platform") === "instagram" ? "Instagram" : "Threads";
      if (query.get("connection") === "success") setNotice(`${name} 계정 연결을 완료했습니다.`);
      else setActionError(query.get("reason") === "session" ? "로그인 후 계정 연결을 다시 시작해 주세요." : "계정 연결을 완료하지 못했습니다. 사이트에서 연결하기를 다시 눌러 주세요.");
      query.delete("connection"); query.delete("platform"); query.delete("reason");
      window.history.replaceState({}, "", `${window.location.pathname}${query.size ? `?${query}` : ""}${window.location.hash}`);
    }
    void refresh(true);
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => { clearInterval(timer); requestSequence.current += 1; };
  }, [refresh]);

  async function perform(key: string, action: () => Promise<unknown>, success: string) {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy(key);
    setNotice("");
    setActionError("");
    try {
      await action();
      setNotice(success);
      await refresh();
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) lockWorkspace();
      setActionError(errorMessage(error));
      requestAnimationFrame(() => errorBox.current?.focus());
    } finally {
      actionLock.current = false;
      setBusy(null);
    }
  }

  async function signOut() {
    if (actionLock.current) return;
    actionLock.current = true;
    setBusy("logout");
    try {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(10_000) });
      if (!response.ok && response.status !== 401) throw new Error("로그아웃하지 못했습니다. 다시 시도해 주세요.");
      requestSequence.current += 1;
      resetComposer();
      lockWorkspace();
    } catch (error) { setActionError(errorMessage(error)); }
    finally { actionLock.current = false; setBusy(null); }
  }

  function resetComposer() {
    setActionError("");
    setEditingId(null);
    setText("");
    setMediaUrl("");
    setPlatform("THREADS");
  }

  function editDraft(post: Post) {
    setEditingId(post.id);
    setPlatform(post.platform);
    setText(post.text);
    setMediaUrl(post.mediaUrl || "");
    setActionError("");
    setNotice("");
    textInput.current?.focus();
    document.getElementById("composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function loadFortuneCaption(target: Platform, caption: string) {
    resetComposer();
    setPlatform(target);
    setText(caption);
    setNotice("운세 글을 작성창에 가져왔습니다. 내용을 확인한 뒤 초안으로 저장하세요.");
    document.getElementById("composer")?.scrollIntoView({ behavior: "smooth", block: "start" });
    textInput.current?.focus();
  }

  async function publishConfirmed() {
    if (!publishTarget || actionLock.current) return;
    const { post, connection } = publishTarget;
    actionLock.current = true;
    setBusy(`publish-${post.id}`);
    setActionError("");
    setNotice("");
    try {
      const result = await api<Post>(`posts/${post.id}/publish`, { accountId: connection.accountId, expectedUpdatedAt: post.updatedAt });
      if (result.status === "PUBLISHED") setNotice(`${platformLabel(post.platform)}에 실제 게시했습니다.`);
      else if (result.status === "PUBLISH_FAILED") setActionError(result.publishError || "게시하지 못했습니다. 계정과 콘텐츠 상태를 확인해 주세요.");
      else {
        setUncertainPosts(previous => new Set(previous).add(post.id));
        setActionError("게시 결과 확인이 필요합니다. 중복 게시하지 말고 연결된 계정에서 결과를 확인해 주세요.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) lockWorkspace();
      if (!(error instanceof ApiError) || error.status >= 500) {
        setUncertainPosts(previous => new Set(previous).add(post.id));
        setActionError("게시 결과를 확인하지 못했습니다. 다시 게시하지 말고 연결 계정과 콘텐츠 상태를 확인해 주세요.");
      } else setActionError(errorMessage(error));
    } finally {
      setPublishTarget(null);
      await refresh();
      actionLock.current = false;
      setBusy(null);
    }
  }

  const limit = platform === "THREADS" ? 500 : 2200;
  const characterCount = Array.from(text.trim()).length;
  const posts = data?.posts ?? [];
  const visiblePosts = posts.filter(post => filter === "ALL" || post.platform === filter);
  const available = !!data && !connectionError;
  const counts = [
    { label: "작성 중인 초안", value: posts.filter(post => post.status === "DRAFT").length, icon: "file" as const, note: "아이디어를 콘텐츠로" },
    { label: "예약된 콘텐츠", value: posts.filter(post => post.status === "SCHEDULED").length, icon: "clock" as const, note: "예약 시간에 자동 시뮬레이션" },
    { label: "시뮬레이션 완료", value: posts.filter(post => post.status === "SIMULATED").length, icon: "check" as const, note: "실제 게시 없이 흐름 확인" },
    { label: "실제 게시 완료", value: posts.filter(post => post.status === "PUBLISHED").length, icon: "arrow" as const, note: "연결된 계정에 공개됨" },
  ];

  if (locked) return <WorkspaceLogin onSuccess={() => { setLocked(false); void refresh(true); }} />;

  return (
    <div className="app-shell">
      <WorkspaceSidebar active="dashboard" />

      <main id="overview">
        <header className="topbar"><div><span className="breadcrumb">워크스페이스</span><span className="breadcrumb-divider">/</span><strong>오버뷰</strong></div><div className="topbar-actions"><span className="environment"><span />{authRequired ? "PRIVATE WORKSPACE" : "LOCAL WORKSPACE"}</span>{authRequired && <button className="text-button" disabled={busy !== null} onClick={() => void signOut()}>로그아웃</button>}</div></header>
        <div className="content">
          <section className="page-heading"><div><span className="eyebrow">LESS REPETITION. MORE CREATION.</span><h1>나의 오늘을,<br className="mobile-break" /> 콘텐츠로.</h1><p>계정을 연결하고, 나만의 오늘 운세를 Instagram과 Threads에 나눠 보세요.</p></div><a href="#composer" className="button primary" onClick={resetComposer}><Icon name="plus" size={18} />새 콘텐츠</a></section>

          <section className="mode-banner" aria-label="현재 운영 모드"><span className="mode-icon"><Icon name="bolt" size={19} /></span><div><strong>실제 게시는 계정과 내용을 확인한 뒤에.</strong><p>계정을 연결한 뒤 실제 게시로 공개할 수 있습니다. 예약과 드라이런은 실제 게시 없이 시뮬레이션으로만 실행됩니다.</p></div><span className="badge dry-run"><span />확인 후 게시</span></section>

          {connectionError && <div className="connection-error" role="alert"><div><strong>백엔드 연결을 확인해 주세요</strong><p>{connectionError}{data ? " 마지막으로 불러온 데이터를 표시하고 있습니다." : " 연결되면 콘텐츠와 채널 상태가 표시됩니다."}</p></div><button className="button secondary" onClick={() => void refresh(true)} disabled={loading}><Icon name="refresh" size={16} />{loading ? "연결 중…" : "다시 연결"}</button></div>}
          <div className="action-feedback" aria-live="polite">{notice && <div className="success-notice"><Icon name="check" size={17} />{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}><Icon name="close" size={16} /></button></div>}</div>
          {actionError && <div ref={errorBox} className="action-error" role="alert" tabIndex={-1}>{actionError}</div>}

          <section className="metrics metrics-four" aria-label="콘텐츠 현황">{counts.map((item, index) => <article className="metric" key={item.label}><div className="metric-top"><span>{item.label}</span><Icon name={item.icon} size={19} /></div><div className="metric-value">{data ? String(item.value).padStart(2, "0") : "—"}<span>개</span></div><div className="metric-bottom"><span className={`metric-dot metric-dot-${index}`} />{item.note}</div></article>)}</section>

          <ConnectionsPanel connections={data?.connections ?? null} disabled={!available || busy !== null} onChanged={() => refresh()} onUnauthorized={lockWorkspace} />
          <FortunePanel disabled={!available || busy !== null} onCaption={loadFortuneCaption} onUnauthorized={lockWorkspace} />

          <div className="work-grid">
            <section className="panel composer-panel" id="composer" aria-labelledby="composer-heading"><div className="panel-heading"><div><span className="eyebrow">{editingId ? "01 / EDIT" : "01 / CREATE"}</span><h2 id="composer-heading">{editingId ? "초안을 다듬어 보세요" : "다음 콘텐츠를 준비하세요"}</h2></div><span className="panel-heading-icon"><Icon name="plus" /></span></div><form onSubmit={event => { event.preventDefault(); void perform(editingId ? "edit" : "create", async () => { if (editingId) { await api<Post>(`posts/${editingId}`, { text: text.trim(), mediaUrl: mediaUrl.trim() || null }, "PATCH"); } else { await api<Post>("posts", { platform, text: text.trim(), ...(mediaUrl.trim() ? { mediaUrl: mediaUrl.trim() } : {}) }); } resetComposer(); textInput.current?.focus(); }, editingId ? "초안 변경 사항을 저장했습니다." : "새 초안을 저장했습니다. 콘텐츠 목록에서 예약하거나 드라이런을 실행하세요."); }}>
              <fieldset className="platform-fieldset" disabled={busy !== null || editingId !== null}><legend>게시할 채널</legend><div className="platform-picker">{(["THREADS", "INSTAGRAM"] as Platform[]).map(value => <label key={value} className={platform === value ? "platform-option selected" : "platform-option"}><input type="radio" name="platform" value={value} checked={platform === value} onChange={() => setPlatform(value)} /><Icon name={value === "INSTAGRAM" ? "instagram" : "threads"} size={18} />{platformLabel(value)}{platform === value && <span className="option-check"><Icon name="check" size={12} /></span>}</label>)}</div></fieldset>
              {editingId && <div className="editing-note"><span>초안 수정 중 · 채널은 변경할 수 없습니다.</span><button className="text-button" type="button" disabled={busy !== null} onClick={resetComposer}>수정 취소</button></div>}<div className="field-group"><label htmlFor="post-text">어떤 이야기를 나누고 싶으세요?</label><textarea ref={textInput} id="post-text" placeholder={"오늘의 아이디어를 적어보세요.\n작은 생각이 다음 콘텐츠의 시작이 됩니다."} value={text} onChange={event => setText(event.target.value)} required rows={6} disabled={busy !== null} aria-describedby="text-help" /><div className="field-meta" id="text-help"><span>{platformLabel(platform)} · 앞뒤 공백 제외</span><span className={characterCount > limit ? "over-limit" : ""}>{characterCount.toLocaleString()} / {limit.toLocaleString()}</span></div></div>
              <div className="field-group"><label htmlFor="media-url">이미지 URL <span className="optional">선택</span></label><input id="media-url" type="url" placeholder="https://example.com/image.jpg" value={mediaUrl} onChange={event => setMediaUrl(event.target.value)} disabled={busy !== null} aria-describedby="media-help" /><p className="field-help" id="media-help">Instagram 실제 게시에는 외부에서 접근 가능한 HTTPS JPEG 이미지 URL이 필요합니다. 예약·드라이런에도 HTTPS URL을 넣어 주세요.</p></div>
              <div className="composer-footer"><span><Icon name="file" size={15} />초안으로 먼저 저장됩니다</span><button className="button primary" type="submit" disabled={!available || busy !== null || !text.trim() || characterCount > limit}>{busy === "create" || busy === "edit" ? "저장 중…" : editingId ? "변경 저장" : "초안 저장"}<Icon name="arrow" size={17} /></button></div>
            </form></section>

            <section className="panel workflow-panel" aria-labelledby="workflow-heading"><span className="eyebrow">BUILT FOR YOUR FLOW</span><h2 id="workflow-heading">반복은 줄이고,<br />연결은 더 쉽게.</h2><p className="workflow-intro">내가 만든 콘텐츠도, AI가 만든 초안도.<br />같은 흐름으로 관리하세요.</p><ol className="workflow-steps"><li><span>01</span><div><strong>아이디어를 초안으로</strong><p>채널에 맞는 글과 이미지를 준비하세요.</p></div></li><li><span>02</span><div><strong>시간을 정하고 확인</strong><p>예약·드라이런은 시뮬레이션으로 검증하세요.</p></div></li><li><span>03</span><div><strong>계정을 확인하고 실제 게시</strong><p>연결 계정과 공개할 내용을 직접 확인하세요.</p></div></li></ol><a className="api-link" href="/api/schema" target="_blank" rel="noreferrer"><span><Icon name="code" size={19} />API 명세 살펴보기</span><Icon name="arrow" size={19} /></a><span className="workflow-watermark" aria-hidden="true">a.</span></section>
          </div>

          <section className="panel pipeline-panel" id="pipeline" aria-labelledby="pipeline-heading"><div className="pipeline-header"><div><span className="eyebrow">02 / MANAGE</span><h2 id="pipeline-heading">콘텐츠 파이프라인 <span className="count-pill">{data ? posts.length : "—"}</span></h2></div><div className="pipeline-tools"><div className="filter-tabs" role="group" aria-label="채널 필터">{(["ALL", "INSTAGRAM", "THREADS"] as const).map(value => <button type="button" key={value} aria-pressed={filter === value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{value === "ALL" ? "전체" : platformLabel(value)}</button>)}</div><button type="button" className="icon-button refresh-button" title="새로고침" aria-label="콘텐츠 새로고침" disabled={loading || busy !== null} onClick={() => void refresh(true)}><Icon name="refresh" size={18} /></button></div></div>
            {visiblePosts.length === 0 ? <div className="empty-state"><div className="empty-icon"><Icon name="file" size={27} /><span><Icon name="plus" size={12} /></span></div><h3>{loading && !data ? "워크스페이스를 불러오고 있어요" : !data ? "백엔드 연결을 기다리고 있어요" : "다음 콘텐츠를 위한 빈자리"}</h3><p>{!data ? "백엔드가 연결되면 저장된 콘텐츠가 여기에 표시됩니다." : filter === "ALL" ? "첫 초안을 만들고, 자동화의 첫 단계를 시작해 보세요." : `${platformLabel(filter)} 초안을 만들면 이곳에서 관리할 수 있어요.`}</p>{data && <a className="text-link" href="#composer">첫 콘텐츠 만들기 <Icon name="arrow" size={16} /></a>}</div> : <div className="post-list">{visiblePosts.map(post => <article className="post-card" key={post.id}><div className="post-top"><span className="post-platform"><Icon name={post.platform === "INSTAGRAM" ? "instagram" : "threads"} size={17} />{platformLabel(post.platform)}</span><span className={`badge post-status ${post.status.toLowerCase()}`}>{statusLabel[post.status]}</span><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></div>{post.segments?.length === 4 && <Link className="studio-series-badge dashboard-series-badge" href={`/saju-content?edit=${post.id}`}>4부작 시리즈 · 전체 문단 보기 ↗</Link>}<p className="post-text">{post.text}</p>{post.mediaUrl && <p className="post-media"><span>이미지</span><span>{post.mediaUrl}</span></p>}
              {post.status === "DRAFT" && <div className="post-actions">{post.segments?.length === 4 ? <Link className="button secondary small" href={`/saju-content?edit=${post.id}`}>4부작 수정</Link> : <button className="button secondary small" type="button" disabled={busy !== null || !available} onClick={() => editDraft(post)}>수정</button>}<div className="schedule-control"><label htmlFor={`schedule-${post.id}`}>예약 시간 <span>(내 기기 시간대)</span></label><input id={`schedule-${post.id}`} type="datetime-local" value={scheduleTimes[post.id] || ""} disabled={busy !== null || !available} onChange={event => setScheduleTimes(previous => ({ ...previous, [post.id]: event.target.value }))} /></div><button type="button" className="button secondary small" disabled={busy !== null || !available || !scheduleTimes[post.id]} onClick={() => void perform(`schedule-${post.id}`, () => { const scheduled = new Date(scheduleTimes[post.id]); if (Number.isNaN(scheduled.getTime()) || scheduled.getTime() <= Date.now()) throw new Error("현재보다 나중인 예약 시간을 선택해 주세요."); return api(`posts/${post.id}/schedule`, { scheduledAt: scheduled.toISOString() }); }, "예약했습니다. 지정된 시간에 시뮬레이션이 자동 실행됩니다.")}><Icon name="clock" size={15} />{busy === `schedule-${post.id}` ? "예약 중…" : "시뮬레이션 예약"}</button><button type="button" className="button soft small" disabled={busy !== null || !available} onClick={() => void perform(`dryrun-${post.id}`, () => api(`posts/${post.id}/dry-run`, {}), "시뮬레이션을 완료했습니다. 실제 Instagram·Threads 계정에는 게시되지 않았습니다.")}><Icon name="bolt" size={15} />{busy === `dryrun-${post.id}` ? "실행 중…" : "드라이런"}</button></div>}
              {post.status === "DRAFT" && <div className="live-publish-row"><p>{data?.connections.find(item => item.platform === post.platform)?.connected ? "연결된 계정에 실제 공개됩니다. 게시 전에 계정과 내용을 확인하세요." : "실제 게시하려면 위에서 내 계정을 먼저 연결해 주세요."}</p><button className="button live small" disabled={busy !== null || !available || uncertainPosts.has(post.id) || !data?.connections.find(item => item.platform === post.platform)?.connected} onClick={() => { const connection = data?.connections.find(item => item.platform === post.platform); if (connection?.connected && connection.accountId) setPublishTarget({ post, connection }); }}>실제 게시</button></div>}
              {post.status === "SCHEDULED" && <div className="scheduled-footer"><span><Icon name="clock" size={15} />{post.scheduledAt ? formatDate(post.scheduledAt) : "예약 시간 확인 중"} · 자동 시뮬레이션 예정</span><button type="button" className="text-button" disabled={busy !== null || !available} onClick={() => void perform(`cancel-${post.id}`, () => api(`posts/${post.id}/cancel-schedule`, {}), "예약을 취소했습니다. 콘텐츠가 초안으로 돌아왔습니다.")}>{busy === `cancel-${post.id}` ? "취소 중…" : "예약 취소"}</button></div>}
              {post.status === "PUBLISHED" && <div className="published-footer"><span><Icon name="check" size={15} />연결 계정에 실제 게시 완료</span><PublishedLink href={post.permalink} platform={post.platform} /></div>}
              {(post.status === "PUBLISHING" || post.status === "PUBLISH_UNKNOWN" || post.status === "PUBLISH_PARTIAL" || uncertainPosts.has(post.id)) && post.status !== "PUBLISHED" && <div className="publish-uncertain"><strong>{post.status === "PUBLISHING" ? "실제 게시 처리 중" : post.status === "PUBLISH_PARTIAL" ? `일부 게시 완료 · ${post.publishedIds?.length || 0}개 확인` : "게시 결과 확인 필요"}</strong><p>중복 게시를 막기 위해 다시 실행하지 않습니다. 연결된 계정에서 결과를 확인해 주세요.</p></div>}
              {post.status === "PUBLISH_FAILED" && <div className="publish-uncertain"><strong>실제 게시 실패</strong><p>{post.publishError || "게시하지 못했습니다. 계정과 콘텐츠 상태를 확인해 주세요."}</p></div>}
              {post.status === "SIMULATED" && <div className="simulated-footer"><Icon name="check" size={15} />실제 게시 없이 시뮬레이션 완료 · {formatDate(post.updatedAt)}</div>}
            </article>)}</div>}
          </section>

          <section className="activity-section" id="activity" aria-labelledby="activity-heading"><div className="section-heading"><h2 id="activity-heading">최근 활동</h2><span className="section-caption">최근 50건 · 15초마다 자동 갱신</span></div>{data?.activity.length ? <ol className="activity-list">{data.activity.map(item => <li key={item.id}><span className="activity-mark"><Icon name={item.type.includes("SIMULAT") || item.type.includes("DRY_RUN") ? "check" : item.type.includes("SCHEDULE") ? "clock" : "file"} size={16} /></span><div><p>{item.message}</p><span>{platformLabel(item.platform)}</span></div><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></li>)}</ol> : <div className="activity-empty"><Icon name="activity" size={20} /><p>{data ? "콘텐츠를 만들면 이곳에 작업 이력이 차곡차곡 쌓입니다." : "연결 후 최근 활동을 확인할 수 있습니다."}</p></div>}</section>
          <footer className="page-footer"><span>insauto<span className="brand-dot">.</span> <span className="footer-tagline">만들고, 연결하고, 나아가세요.</span></span><span className="backend-status"><span className={available ? "status-up" : "status-down"} />{available ? "백엔드 연결됨" : loading ? "연결 확인 중" : "백엔드 연결 대기"}</span></footer>
        </div>
      </main>
      {publishTarget && <PublishDialog post={posts.find(post => post.id === publishTarget.post.id) || publishTarget.post} connection={publishTarget.connection} busy={busy !== null} onCancel={() => setPublishTarget(null)} onConfirm={publishConfirmed} />}
    </div>
  );
}





