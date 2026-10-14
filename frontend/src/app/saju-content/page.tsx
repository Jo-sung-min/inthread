"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { WorkspaceLogin } from "@/components/workspace-login";
import { PublishedLink, PublishDialog } from "@/components/publish-dialog";
import { SegmentEditor } from "@/components/segment-editor";
import { api, ApiError, Connection, errorMessage, Platform, Post } from "@/lib/client-api";
import { BatchAttempt, BatchIdentity, createBatchAttempt, GeneratedSeries, GenerationResult, savedVariantKey, seriesStatusLabel, StudioOptions, validSegments } from "@/lib/content-studio";

type Editor = { post: Post; segments: string[] };
const formatDate = (value: string) => new Date(value).toLocaleString("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

export default function SajuContentPage() {
  const [options, setOptions] = useState<StudioOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [locked, setLocked] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [count, setCount] = useState(4);
  const [tone, setTone] = useState<"DIRECT" | "WARM">("DIRECT");
  const [devices, setDevices] = useState<string[]>([]);
  const [cta, setCta] = useState<"COMMENT" | "SAVE">("COMMENT");
  const [result, setResult] = useState<GenerationResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [savedItems, setSavedItems] = useState<Set<string>>(new Set());
  const [pendingBatch, setPendingBatch] = useState<BatchAttempt | null>(null);
  const [savePlatform, setSavePlatform] = useState<Platform>("THREADS");
  const [posts, setPosts] = useState<Post[]>([]);
  const [connections, setConnections] = useState<Connection[]>([]);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [publishTarget, setPublishTarget] = useState<{ post: Post; connection: Connection } | null>(null);
  const [uncertain, setUncertain] = useState<Set<string>>(new Set());
  const batchIdentity = useRef<BatchIdentity | null>(null);
  const lock = useRef(false);
  const loadSequence = useRef(0);
  const savedSequence = useRef(0);
  const editFromUrl = useRef<string | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const handleFailure = useCallback((failure: unknown) => {
    if (failure instanceof ApiError && failure.status === 401) {
      loadSequence.current += 1;
      savedSequence.current += 1;
      setLocked(true);
      setPosts([]);
      setConnections([]);
      setPublishTarget(null);
    } else setError(errorMessage(failure));
    requestAnimationFrame(() => errorRef.current?.focus());
  }, []);

  const refreshSaved = useCallback(async () => {
    const sequence = ++savedSequence.current;
    const session = loadSequence.current;
    try {
      const [nextPosts, nextConnections] = await Promise.all([api<Post[]>("posts"), api<Connection[]>("connections")]);
      if (sequence === savedSequence.current && session === loadSequence.current) {
        setPosts(nextPosts);
        setConnections(nextConnections);
      }
      return nextPosts;
    } catch (failure) {
      // A response from the previous login must not relock a new session.
      if (session !== loadSequence.current || sequence !== savedSequence.current) return [];
      throw failure;
    }
  }, []);

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setLoadError("");
    try {
      const [catalog, nextPosts, nextConnections, authentication] = await Promise.all([
        api<StudioOptions>("content-studio/options"), api<Post[]>("posts"), api<Connection[]>("connections"),
        fetch("/api/auth/status", { cache: "no-store", signal: AbortSignal.timeout(10_000) }).then(response => response.json() as Promise<{ required: boolean }>),
      ]);
      if (sequence !== loadSequence.current) return;
      setOptions(catalog);
      setTopicIds(previous => previous.length ? previous : catalog.topics.slice(0, 2).map(item => item.id));
      setDevices(previous => previous.length ? previous : catalog.devices.map(item => item.id));
      setPosts(nextPosts);
      setConnections(nextConnections);
      setAuthRequired(authentication.required);
      setLocked(false);
      if (editFromUrl.current) {
        const target = nextPosts.find(post => post.id === editFromUrl.current && post.status === "DRAFT" && post.segments?.length === 4);
        if (target) {
          setEditor({ post: target, segments: [...target.segments!] });
          requestAnimationFrame(() => document.getElementById("saved-series")?.scrollIntoView({ behavior: "smooth" }));
        } else setNotice("이 시리즈는 현재 수정할 수 없습니다. 저장된 시리즈에서 상태를 확인해 주세요.");
        editFromUrl.current = null;
      }
    } catch (failure) {
      if (sequence !== loadSequence.current) return;
      if (failure instanceof ApiError && failure.status === 401) handleFailure(failure);
      else setLoadError(errorMessage(failure));
    } finally { if (sequence === loadSequence.current) setLoading(false); }
  }, [handleFailure]);

  useEffect(() => {
    editFromUrl.current = new URLSearchParams(window.location.search).get("edit");
    void load();
    return () => { loadSequence.current += 1; };
  }, [load]);
  useEffect(() => {
    if (!options || locked) return;
    // Publishing may take several minutes. Keep confirmed-part progress visible.
    const timer = setInterval(() => { void refreshSaved().catch(handleFailure); }, 15_000);
    return () => clearInterval(timer);
  }, [options, locked, refreshSaved, handleFailure]);

  async function run(key: string, operation: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(key);
    setError("");
    setNotice("");
    try { await operation(); }
    catch (failure) { handleFailure(failure); }
    finally { lock.current = false; setBusy(null); }
  }
  async function generate() {
    if (pendingBatch) { setError("이전 저장 요청의 결과를 먼저 확인해 주세요."); return; }
    await run("generate", async () => {
      const generated = await api<GenerationResult>("content-studio/generate", { topicIds, count, tone, devices, cta });
      if (!generated.items.every(item => validSegments(item.segments))) throw new Error("생성된 문단 형식을 확인할 수 없습니다. 다시 생성해 주세요.");
      setResult(generated);
      setSelected(new Set(generated.items.map(item => item.id)));
      setExpanded(new Set(generated.items.slice(0, 1).map(item => item.id)));
      setSavedItems(new Set());
      batchIdentity.current = null;
      setNotice(`${generated.items.length}개의 4부작 초안을 만들었습니다. 내용을 다듬은 뒤 저장하세요.`);
      requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    });
  }
  const selectedItems = result?.items.filter(item => selected.has(item.id)) || [];
  const toSave = selectedItems.filter(item => !savedItems.has(savedVariantKey(item, savePlatform)));
  const canSave = toSave.length > 0 && toSave.length <= 12 && toSave.every(item => validSegments(item.segments));
  const savedSeries = posts.filter(post => post.platform === "THREADS" && post.segments?.length === 4);
  const threads = connections.find(item => item.platform === "THREADS");
  const available = !!options && !loadError;

  async function persistBatch(attempt: BatchAttempt, retrying = false) {
    let response: { posts: Post[] };
    try {
      response = await api<{ posts: Post[] }>("posts/batch", { requestId: attempt.requestId, posts: attempt.posts });
      if (response.posts.length !== attempt.posts.length) throw new Error("저장 결과를 모두 확인하지 못했습니다.");
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) { setPendingBatch(attempt); throw failure; }
      if (retrying || !(failure instanceof ApiError) || failure.status >= 500) {
        setPendingBatch(attempt);
        throw new Error("이전 저장 요청이 처리되었을 수 있습니다. 아래의 저장 결과 확인 버튼으로 같은 요청을 확인해 주세요.");
      }
      throw failure;
    }
    setPendingBatch(null);
    setSavedItems(previous => new Set([...previous, ...attempt.sourceKeys]));
    setSelected(previous => new Set([...previous].filter(id => !attempt.sourceIds.includes(id))));
    setNotice(attempt.platform === "THREADS"
      ? `${response.posts.length}개 시리즈를 초안으로 저장했습니다. 아래에서 계정과 4개 문단을 확인한 뒤 발행하세요.`
      : `${response.posts.length}개 Instagram 초안을 저장했습니다. 오버뷰에서 공개 JPEG 이미지 URL을 추가한 뒤 게시하세요.`);
    await refreshSaved();
  }
  async function saveSelected() {
    if (pendingBatch) { setError("이전 저장 요청의 결과를 먼저 확인해 주세요."); return; }
    await run("save-batch", async () => {
      const attempt = createBatchAttempt(toSave, savePlatform, batchIdentity.current, () => crypto.randomUUID());
      batchIdentity.current = attempt;
      await persistBatch(attempt);
    });
  }
  async function retryBatch() {
    if (!pendingBatch) return;
    const original = pendingBatch;
    await run("retry-batch", () => persistBatch(original, true));
  }
  function updateSegment(id: string, index: number, value: string) {
    setResult(previous => previous ? { ...previous, items: previous.items.map(item => item.id === id ? { ...item, segments: item.segments.map((part, position) => position === index ? value : part) } : item) } : null);
  }
  function toggleSelection(id: string) {
    setSelected(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function copy(items: GeneratedSeries[]) {
    try {
      await navigator.clipboard.writeText(items.map(item => `${item.title}\n\n${item.segments.map((text, index) => `[${index + 1}/4]\n${text}`).join("\n\n")}`).join("\n\n──────────\n\n"));
      setNotice(`${items.length}개 시리즈의 전체 문단을 복사했습니다.`);
    } catch { setError("클립보드에 접근할 수 없습니다. 각 문단을 직접 선택해 복사해 주세요."); }
  }
  async function saveEdited() {
    if (!editor) return;
    await run(`edit-${editor.post.id}`, async () => {
      const segments = editor.segments.map(text => text.trim());
      await api<Post>(`posts/${editor.post.id}`, { text: segments[0], segments, mediaUrl: null }, "PATCH");
      savedSequence.current += 1;
      setEditor(null);
      setNotice("4개 문단의 변경 사항을 저장했습니다.");
      await refreshSaved();
    });
  }
  async function publish() {
    if (!publishTarget || lock.current) return;
    const { post, connection } = publishTarget;
    await run(`publish-${post.id}`, async () => {
      try {
        const response = await api<Post>(`posts/${post.id}/publish`, { accountId: connection.accountId, expectedUpdatedAt: post.updatedAt });
        savedSequence.current += 1;
        setPosts(previous => previous.map(item => item.id === response.id ? response : item));
        if (response.status === "PUBLISHED") setNotice("4개 문단을 연결된 Threads 계정에 이어서 발행했습니다.");
        else if (response.status === "PUBLISH_FAILED") setError(response.publishError || "발행하지 못했습니다. 저장된 시리즈의 상태를 확인해 주세요.");
        else {
          setUncertain(previous => new Set(previous).add(post.id));
          setError(response.status === "PUBLISH_PARTIAL" ? `${response.publishedIds?.length || 0}개 문단이 실제 게시되었습니다. 나머지는 발행하지 못했습니다. 중복 게시하지 말고 계정에서 확인해 주세요.` : "발행 결과를 확인해야 합니다. 다시 발행하지 말고 연결 계정에서 결과를 확인해 주세요.");
        }
      } catch (failure) {
        if (!(failure instanceof ApiError) || failure.status >= 500) {
          setUncertain(previous => new Set(previous).add(post.id));
          setError("응답을 확인하지 못했습니다. 일부 문단이 게시되었을 수 있으므로 다시 발행하지 말고 계정과 상태를 확인해 주세요.");
        } else throw failure;
      } finally {
        setPublishTarget(null);
        await refreshSaved();
      }
    });
  }
  async function signOut() {
    await run("logout", async () => {
      const response = await fetch("/api/auth/logout", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!response.ok && response.status !== 401) throw new Error("로그아웃하지 못했습니다.");
      loadSequence.current += 1;
      savedSequence.current += 1;
      setPosts([]); setConnections([]); setResult(null); setOptions(null); setEditor(null); setPendingBatch(null); batchIdentity.current = null; setLocked(true);
    });
  }

  if (locked) return <WorkspaceLogin onSuccess={() => { setLocked(false); void load(); }} />;
  return <div className="app-shell">
    <WorkspaceSidebar active="studio" />
    <main className="studio-main">
      <header className="topbar"><div><Link href="/" className="breadcrumb">워크스페이스</Link><span className="breadcrumb-divider">/</span><strong>사주 콘텐츠 발행하기</strong></div><div className="topbar-actions"><span className="environment"><span />CONTENT STUDIO</span>{authRequired && <button className="text-button" disabled={busy !== null} onClick={() => void signOut()}>로그아웃</button>}</div></header>
      <div className="content studio-content">
        <section className="studio-hero"><div><span className="eyebrow">ONE IDEA. FOUR CONNECTED POSTS.</span><h1>읽고, 공감하고,<br />다음 문장을 기다리게.</h1><p>사주 이야기를 4부작 콘텐츠로 만드세요.<br />여러 주제를 한 번에 만들고, 내 말투로 다듬은 뒤 직접 발행합니다.</p></div><div className="studio-hero-note"><span className="studio-template-badge">문장 템플릿 조합</span><strong>01 → 02 → 03 → 04</strong><p>한 가지 주제, 이어지는 네 문단.<br />생년월일 입력 없이 시작하세요.</p></div></section>

        {loadError && <div className="connection-error" role="alert"><div><strong>콘텐츠 작업실을 불러오지 못했습니다</strong><p>{loadError}</p></div><button className="button secondary" disabled={loading} onClick={() => void load()}>{loading ? "연결 중…" : "다시 불러오기"}</button></div>}
        {error && <div className="action-error" ref={errorRef} tabIndex={-1} role="alert">{error}</div>}
        {pendingBatch && <section className="studio-batch-recovery" role="alert"><div><strong>이전 저장 결과를 먼저 확인해 주세요</strong><p>{pendingBatch.platform === "THREADS" ? "Threads 시리즈" : "Instagram 초안"} {pendingBatch.posts.length}개의 저장 결과를 기다리고 있습니다. 현재 선택을 바꿔도 처음 저장한 내용 그대로 확인합니다. 결과가 확인될 때까지 새 저장과 발행을 잠시 멈춥니다.</p></div><button className="button secondary" disabled={busy !== null} onClick={() => void retryBatch()}>{busy === "retry-batch" ? "이전 저장 확인 중…" : "이전 저장 결과 확인"}</button></section>}
        <div aria-live="polite">{notice && <div className="success-notice">{notice}<button className="icon-button" aria-label="알림 닫기" onClick={() => setNotice("")}>×</button></div>}</div>

        <section className="panel studio-builder" aria-labelledby="builder-heading">
          <div className="studio-section-heading"><div><span className="eyebrow">01 / SET THE DIRECTION</span><h2 id="builder-heading">어떤 이야기를 만들까요?</h2></div><span className="studio-step-label">주제 선택 → 문장 만들기</span></div>
          {options ? <form onSubmit={event => { event.preventDefault(); void generate(); }}>
            <fieldset className="studio-topics-fieldset" disabled={busy !== null}><legend>이야기 주제 <span>여러 개 선택 가능</span></legend><div className="studio-topics">{options.topics.map((topic, index) => <label className={topicIds.includes(topic.id) ? "studio-topic selected" : "studio-topic"} key={topic.id}><input type="checkbox" checked={topicIds.includes(topic.id)} onChange={() => setTopicIds(previous => previous.includes(topic.id) ? previous.filter(id => id !== topic.id) : [...previous, topic.id])} /><span className="studio-topic-number">{String(index + 1).padStart(2, "0")}</span><strong>{topic.label}</strong><p>{topic.description}</p><span className="studio-topic-check" aria-hidden="true">{topicIds.includes(topic.id) ? "✓" : "+"}</span></label>)}</div></fieldset>
            <div className="studio-preferences">
              <div className="studio-number"><label htmlFor="series-count">만들 시리즈 수</label><div><input id="series-count" type="number" min={1} max={Math.min(12, options.maxBatchSize)} value={count} onChange={event => setCount(Number(event.target.value))} disabled={busy !== null} required /><span>개 <small>· 시리즈마다 4개 문단</small></span></div></div>
              <fieldset disabled={busy !== null}><legend>문장 말투</legend><div className="studio-choice">{options.tones.filter(item => item.id === "DIRECT" || item.id === "WARM").map(item => <label className={tone === item.id ? "selected" : ""} key={item.id}><input type="radio" name="tone" checked={tone === item.id} onChange={() => setTone(item.id as "DIRECT" | "WARM")} />{item.label}</label>)}</div></fieldset>
              <fieldset disabled={busy !== null}><legend>마지막 문단의 행동 유도</legend><div className="studio-choice"><label className={cta === "COMMENT" ? "selected" : ""}><input type="radio" name="cta" checked={cta === "COMMENT"} onChange={() => setCta("COMMENT")} />댓글로 이야기하기</label><label className={cta === "SAVE" ? "selected" : ""}><input type="radio" name="cta" checked={cta === "SAVE"} onChange={() => setCta("SAVE")} />나중에 보도록 저장</label></div></fieldset>
            </div>
            <fieldset className="studio-devices" disabled={busy !== null}><legend>글에 담을 표현 장치 <span>원하는 요소를 골라 주세요</span></legend><div>{options.devices.map(device => <label className={devices.includes(device.id) ? "selected" : ""} key={device.id} title={device.description}><input type="checkbox" checked={devices.includes(device.id)} onChange={() => setDevices(previous => previous.includes(device.id) ? previous.filter(id => id !== device.id) : [...previous, device.id])} /><span aria-hidden="true">{devices.includes(device.id) ? "✓" : "+"}</span>{device.label}</label>)}</div><p>{devices.length ? options.devices.filter(item => devices.includes(item.id)).map(item => item.description).join(" · ") : "선택한 표현 장치가 없습니다."}</p></fieldset>
            <div className="studio-generate-footer"><p>저장과 발행은 내용을 확인한 뒤 각각 진행합니다.<br /><span>문장 템플릿을 조합합니다. 개인의 사주를 분석하거나 AI 모델을 호출하지 않습니다.</span></p><button className="button primary" type="submit" disabled={busy !== null || pendingBatch !== null || !available || !topicIds.length || !Number.isInteger(count) || count < 1 || count > Math.min(12, options.maxBatchSize)}>{busy === "generate" ? "문장 조합 중…" : `${count > 0 ? count : ""}개 시리즈 만들기`}<span aria-hidden="true">↗</span></button></div>
          </form> : <div className="studio-loading">{loading ? "주제와 표현 장치를 불러오고 있습니다…" : "연결 후 콘텐츠 주제를 선택할 수 있습니다."}</div>}
        </section>

        <section className="studio-results" ref={resultRef} aria-labelledby="results-heading">
          <div className="studio-section-heading"><div><span className="eyebrow">02 / MAKE IT YOURS</span><h2 id="results-heading">만든 글, 내 말투로 다듬기 <span className="count-pill">{result?.items.length || 0}</span></h2></div>{result && <span className="section-caption">{formatDate(result.generatedAt)} 생성</span>}</div>
          {result ? <><p className="studio-generation-notice">{result.notice}</p><div className="studio-selection-toolbar"><label><input type="checkbox" checked={result.items.length > 0 && result.items.every(item => selected.has(item.id))} onChange={event => setSelected(event.target.checked ? new Set(result.items.map(item => item.id)) : new Set())} disabled={busy !== null} />전체 선택 <strong>{selected.size}</strong></label><button className="button secondary small" onClick={() => void copy(selectedItems)} disabled={!selectedItems.length}>선택한 글 모두 복사</button></div>
            <div className="studio-generated-list">{result.items.map((item, index) => <article className={selected.has(item.id) ? "panel studio-generated selected" : "panel studio-generated"} key={item.id}><div className="studio-generated-heading"><label><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelection(item.id)} disabled={busy !== null} aria-label={`${item.title} 선택`} /><span className="studio-item-order">{String(index + 1).padStart(2, "0")}</span><div><h3>{item.title}</h3><p>{options?.topics.find(topic => topic.id === item.topicId)?.label || item.topicId} · 4부작 · {item.tone === "DIRECT" ? "직설적인 말투" : "따뜻한 말투"}</p></div></label><button className="text-button" onClick={() => setExpanded(previous => { const next = new Set(previous); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })}>{expanded.has(item.id) ? "접기 ↑" : "4개 문단 편집 ↓"}</button></div>
              {expanded.has(item.id) ? <SegmentEditor segments={item.segments} idPrefix={`generated-${item.id}`} disabled={busy !== null || pendingBatch !== null} onChange={(part, value) => updateSegment(item.id, part, value)} /> : <p className="studio-collapsed-preview">{item.segments[0]}</p>}
              <div className="studio-generated-footer"><span>{savedItems.has(savedVariantKey(item, savePlatform)) ? `${savePlatform === "THREADS" ? "Threads 시리즈" : "Instagram 초안"} 저장 완료` : validSegments(item.segments) ? "문단별 500자 이내 · 저장 준비됨" : "빈 문단 또는 500자를 넘는 문단을 수정해 주세요"}</span><button className="text-button" onClick={() => void copy([item])}>이 시리즈 복사</button></div>
            </article>)}</div>
            <div className="studio-save-panel"><div><h3>선택한 콘텐츠를 초안으로 저장</h3><div className="studio-save-platform"><label><input type="radio" name="save-platform" checked={savePlatform === "THREADS"} onChange={() => setSavePlatform("THREADS")} disabled={busy !== null} />Threads · 연결된 4부작</label><label><input type="radio" name="save-platform" checked={savePlatform === "INSTAGRAM"} onChange={() => setSavePlatform("INSTAGRAM")} disabled={busy !== null} />Instagram · 합친 글 1개</label></div><p>{savePlatform === "THREADS" ? "저장 후 아래에서 4개 문단을 확인하고 연결 계정에 이어서 발행합니다." : "네 문단을 합쳐 하나의 초안으로 저장합니다. 오버뷰에서 공개 JPEG 이미지 URL을 추가해 주세요."}</p></div><button className="button primary" disabled={busy !== null || pendingBatch !== null || !canSave} onClick={() => void saveSelected()}>{busy === "save-batch" ? "초안 저장 중…" : `${toSave.length}개 초안 저장`}</button></div>
          </> : <div className="panel studio-results-empty"><span aria-hidden="true">01 — 04</span><h3>다음 시리즈를 위한 빈자리</h3><p>주제를 고르면 여기에 4부작 문장들이 만들어집니다.<br />문단별로 수정하고, 마음에 드는 글만 선택해 저장하세요.</p></div>}
        </section>

        <section className="studio-saved" id="saved-series" aria-labelledby="saved-heading"><div className="studio-section-heading"><div><span className="eyebrow">03 / REVIEW & PUBLISH</span><h2 id="saved-heading">저장된 Threads 시리즈 <span className="count-pill">{savedSeries.length}</span></h2></div><Link className="text-link" href="/#pipeline">모든 콘텐츠 보기 ↗</Link></div><div className="studio-publish-guidance"><p><strong>{threads?.connected ? `@${threads.username || threads.accountId}에 발행할 수 있어요.` : "발행하려면 내 Threads 계정을 연결하세요."}</strong><span>실제 발행은 네 문단을 순서대로 답글로 연결합니다. 계정과 전체 내용을 다시 확인한 뒤 실행됩니다.</span></p><Link className="button secondary small" href="/#connections">계정 연결 확인</Link></div>
          {savedSeries.length ? <div className="studio-saved-list">{savedSeries.map(post => <article className="panel studio-saved-card" key={post.id}><div className="studio-saved-heading"><span className={`badge post-status ${post.status.toLowerCase()}`}>{seriesStatusLabel[post.status]}</span><span className="studio-series-badge">THREADS · 4부작</span><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></div>
            {editor?.post.id === post.id ? <><SegmentEditor segments={editor.segments} idPrefix={`saved-${post.id}`} disabled={busy !== null || pendingBatch !== null} onChange={(part, value) => setEditor(previous => previous ? { ...previous, segments: previous.segments.map((text, index) => index === part ? value : text) } : null)} /><div className="studio-edit-actions"><button className="button secondary small" disabled={busy !== null} onClick={() => setEditor(null)}>수정 취소</button><button className="button primary small" disabled={busy !== null || pendingBatch !== null || !validSegments(editor.segments)} onClick={() => void saveEdited()}>4개 문단 변경 저장</button></div></> : <><p className="studio-saved-preview">{post.segments?.[0] || post.text}</p><details className="studio-series-details"><summary>4개 문단 전체 보기</summary><ol>{post.segments?.map((part, index) => <li key={index}><span>{index + 1}/4</span><p>{part}</p></li>)}</ol></details></>}
            {!!post.publishedIds?.length && <details className="studio-published-ids"><summary>실제 게시가 확인된 문단 {post.publishedIds.length}개</summary><ol>{post.publishedIds.map((id, index) => <li key={id}>{index + 1}/4 · <code>{id}</code></li>)}</ol></details>}
            {(post.status === "PUBLISH_PARTIAL" || post.status === "PUBLISH_UNKNOWN" || uncertain.has(post.id)) && post.status !== "PUBLISHED" && <div className="publish-uncertain"><strong>추가 발행을 중단했습니다</strong><p>{post.publishError || "일부 문단이 게시되었을 수 있습니다. 중복 발행하지 말고 연결 계정에서 결과를 확인해 주세요."}</p></div>}
            {post.status === "PUBLISH_FAILED" && <div className="publish-uncertain"><strong>발행 실패</strong><p>{post.publishError || "계정과 콘텐츠 상태를 확인해 주세요."}</p></div>}
            {post.status === "PUBLISHING" && <p className="studio-publishing" role="status">발행 처리 중 · {post.publishedIds?.length || 0}/4개 문단 확인 · 15초마다 상태를 확인합니다.</p>}
            <div className="studio-saved-actions"><PublishedLink href={post.permalink} platform="THREADS" />{post.status === "DRAFT" && <><button className="button secondary small" disabled={busy !== null || pendingBatch !== null || uncertain.has(post.id)} onClick={() => setEditor({ post, segments: [...post.segments!] })}>4개 문단 수정</button><button className="button live small" disabled={busy !== null || pendingBatch !== null || !!editor || uncertain.has(post.id) || !threads?.connected || !threads.accountId} onClick={() => { if (threads?.connected) setPublishTarget({ post, connection: threads }); }}>4부작 실제 발행</button></>}</div>
          </article>)}</div> : <div className="studio-saved-empty">선택한 콘텐츠를 Threads 초안으로 저장하면 이곳에 시리즈가 모입니다.</div>}
        </section>
        <footer className="page-footer"><span>insauto<span className="brand-dot">.</span><span className="footer-tagline">한 문장 다음에, 더 좋은 연결.</span></span><Link className="text-link" href="/">오버뷰로 돌아가기 ↗</Link></footer>
      </div>
    </main>
    {publishTarget && <PublishDialog post={posts.find(post => post.id === publishTarget.post.id) || publishTarget.post} connection={publishTarget.connection} busy={busy?.startsWith("publish-") || false} onCancel={() => setPublishTarget(null)} onConfirm={publish} />}
  </div>;
}
