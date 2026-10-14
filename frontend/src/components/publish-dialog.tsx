"use client";
import { useEffect, useRef, useState } from "react";
import { Connection, Platform, Post, platformLabel } from "@/lib/client-api";

type Props = { post: Post; connection: Connection; busy: boolean; onCancel: () => void; onConfirm: () => Promise<void> };
export function PublishDialog({ post, connection, busy, onCancel, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const segments = post.segments?.length ? post.segments : [post.text];
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="publish-dialog" onCancel={event => { event.preventDefault(); if (!busy) onCancel(); }} aria-labelledby="publish-title">
    <div className="publish-dialog-heading"><span className="eyebrow">LIVE PUBLICATION</span><h2 id="publish-title">이 콘텐츠를 실제로 게시할까요?</h2><p>확인하면 연결한 {platformLabel(post.platform)} 계정에 공개됩니다.</p></div>
    <div className="publish-account"><span>게시 계정</span><strong>{platformLabel(post.platform)} · {connection.username ? `@${connection.username.replace(/^@/, "")}` : connection.accountId}</strong></div>
    <div className="publish-preview">{segments.length > 1 ? <><p className="publish-series-note">4개 문단을 순서대로 답글로 연결해 실제 발행합니다. 모두 게시될 때까지 최대 수 분이 걸릴 수 있습니다.</p><ol className="publish-segments">{segments.map((part, index) => <li key={index}><strong>{index + 1}/{segments.length} · {index === 0 ? "첫 게시물" : "이어지는 답글"}</strong><p>{part}</p></li>)}</ol></> : <p>{post.text}</p>}{post.mediaUrl && <div className="publish-media"><strong>이미지 URL</strong><span>{post.mediaUrl}</span><p>연결된 계정으로 이 URL의 이미지가 게시됩니다.</p></div>}</div>
    <label className="publish-consent"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={busy} /><span>게시 계정과 {segments.length > 1 ? "4개 문단 전체" : "내용"}를 확인했으며 실제 공개 게시에 동의합니다.</span></label>
    <div className="publish-dialog-actions"><button className="button secondary" onClick={onCancel} disabled={busy}>돌아가기</button><button className="button live" disabled={busy || !confirmed} onClick={() => void onConfirm()}>{busy ? "게시 결과 확인 중…" : segments.length > 1 ? "확인하고 4부작 발행" : "확인하고 실제 게시"}</button></div>
    {busy && <p className="publish-wait" role="status">{segments.length > 1 ? `실제 게시 확인 ${post.publishedIds?.length || 0}/${segments.length}개 · ` : ""}응답을 기다리고 있습니다. 중복 게시하지 않도록 다시 실행하지 마세요.</p>}
  </dialog>;
}
export function PublishedLink({ href, platform }: { href: string | null | undefined; platform: Platform }) {
  if (!href) return null;
  try {
    const url = new URL(href);
    const hosts = platform === "INSTAGRAM" ? ["instagram.com", "www.instagram.com"] : ["threads.net", "www.threads.net", "threads.com", "www.threads.com"];
    if (url.protocol !== "https:" || !hosts.includes(url.hostname)) return null;
  } catch { return null; }
  return <a href={href} target="_blank" rel="noreferrer" className="text-link">게시물 보기 ↗</a>;
}
