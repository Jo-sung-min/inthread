"use client";

import { useEffect, useRef, useState } from "react";
import { FortunePanel } from "@/components/fortune-panel";
import { api, ApiError, errorMessage, Platform, Post, platformLabel } from "@/lib/client-api";

type Props = { post: Post | null; onClose: () => void; onSaved: (post: Post) => void; onUnauthorized: () => void };
type Draft = { platform: Platform; text: string; mediaUrl: string | null };
type Attempt = { requestId: string; posts: Draft[] };

export function DraftDialog({ post, onClose, onSaved, onUnauthorized }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lock = useRef(false);
  const request = useRef<Attempt | null>(null);
  const [mode, setMode] = useState<"write" | "fortune">("write");
  const [platform, setPlatform] = useState<Platform>(post?.platform || "THREADS");
  const [text, setText] = useState(post?.text || "");
  const [mediaUrl, setMediaUrl] = useState(post?.mediaUrl || "");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const limit = platform === "THREADS" ? 500 : 2200;
  const count = Array.from(text.trim()).length;
  useEffect(() => { dialog.current?.showModal(); input.current?.focus(); }, []);

  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      let saved: Post;
      if (post) saved = await api<Post>(`posts/${post.id}`, { text: text.trim(), mediaUrl: mediaUrl.trim() || null }, "PATCH");
      else {
        if (!pending || !request.current) request.current = { requestId: crypto.randomUUID(), posts: [{ platform, text: text.trim(), mediaUrl: mediaUrl.trim() || null }] };
        const result = await api<{ posts: Post[] }>("posts/batch", request.current);
        if (result.posts.length !== 1) throw new Error("저장 결과를 확인하지 못했습니다.");
        saved = result.posts[0];
      }
      onSaved(saved);
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) { onUnauthorized(); return; }
      if (!post && (!(failure instanceof ApiError) || failure.status >= 500)) {
        setPending(true); setError("저장 결과를 아직 확인하지 못했습니다. ‘저장 결과 확인’을 누르면 중복 없이 확인합니다.");
      } else { setPending(false); setError(errorMessage(failure)); }
    } finally { lock.current = false; setBusy(false); }
  }
  return <dialog ref={dialog} className="registration-dialog" aria-labelledby="registration-title" onCancel={event => { event.preventDefault(); if (!busy && !pending) onClose(); }}>
    <header className="registration-header"><div><h2 id="registration-title">{post ? "콘텐츠 수정" : "콘텐츠 등록"}</h2><p>{post ? "내용을 다듬고 변경 사항을 저장하세요." : "글을 적고 초안으로 저장하세요."}</p></div><button className="icon-button" aria-label="등록창 닫기" disabled={busy || pending} onClick={onClose}>×</button></header>
    {!post && <div className="registration-modes" aria-label="작성 방법"><button type="button" aria-pressed={mode === "write"} disabled={busy || pending} onClick={() => setMode("write")}>직접 쓰기</button><button type="button" aria-pressed={mode === "fortune"} disabled={busy || pending} onClick={() => setMode("fortune")}>생일로 운세 만들기</button></div>}
    {mode === "fortune" ? <FortunePanel disabled={busy} onUnauthorized={onUnauthorized} onCaption={(channel, caption) => { setPlatform(channel); setText(caption); setMediaUrl(""); setMode("write"); requestAnimationFrame(() => input.current?.focus()); }} /> : <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <fieldset className="registration-platforms" disabled={busy || pending || !!post}><legend>채널</legend>{(["THREADS", "INSTAGRAM"] as Platform[]).map(value => <label key={value} className={platform === value ? "selected" : ""}><input type="radio" name="registration-platform" checked={platform === value} onChange={() => setPlatform(value)} />{platformLabel(value)}</label>)}</fieldset>
      <label className="registration-label" htmlFor="draft-text">내용</label><textarea ref={input} id="draft-text" rows={7} placeholder="게시할 내용을 입력하세요." value={text} onChange={event => setText(event.target.value)} disabled={busy || pending} required aria-describedby="draft-count" />
      <div id="draft-count" className={count > limit ? "registration-count over-limit" : "registration-count"}>{count.toLocaleString()} / {limit.toLocaleString()}자</div>
      {platform === "INSTAGRAM" ? <div className="registration-image"><label className="registration-label" htmlFor="draft-image">이미지 주소 <span>등록 후 추가 가능</span></label><input id="draft-image" type="url" placeholder="https://example.com/image.jpg" value={mediaUrl} onChange={event => setMediaUrl(event.target.value)} disabled={busy || pending} /><p>실제 게시에는 공개된 HTTPS JPEG 이미지가 필요합니다.</p></div> : <details className="registration-image" open={mediaUrl ? true : undefined}><summary>이미지 추가 <span>선택</span></summary><label className="sr-only" htmlFor="draft-image">이미지 주소</label><input id="draft-image" type="url" placeholder="https://example.com/image.jpg" value={mediaUrl} onChange={event => setMediaUrl(event.target.value)} disabled={busy || pending} /></details>}
      {error && <p className="registration-error" role="alert">{error}</p>}
      <footer className="registration-footer"><span>{pending ? "저장 결과를 확인하면 창을 닫을 수 있습니다." : "저장 후 내용을 확인하고 발행합니다."}</span><button type="submit" className="button primary" disabled={busy || !text.trim() || count > limit}>{busy ? "저장 중…" : pending ? "저장 결과 확인" : post ? "변경 저장" : "초안 등록"}</button></footer>
    </form>}
  </dialog>;
}
