"use client";
import { FormEvent, useRef, useState } from "react";
import { downloadFortuneCard } from "@/lib/fortune-card";
import { api, ApiError, errorMessage, FortunePreview, Platform } from "@/lib/client-api";

type Props = { disabled: boolean; onCaption: (platform: Platform, text: string) => void; onUnauthorized: () => void };
export function FortunePanel({ disabled, onCaption, onUnauthorized }: Props) {
  const [birthDate, setBirthDate] = useState("");
  const [birthTime, setBirthTime] = useState("");
  const [calendarType, setCalendarType] = useState<"SOLAR" | "LUNAR">("SOLAR");
  const [leapMonth, setLeapMonth] = useState(false);
  const [preview, setPreview] = useState<FortunePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const resultRef = useRef<HTMLDivElement>(null);

  function invalidate() { setPreview(null); setError(""); }
  async function generate(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const value = await api<FortunePreview>("fortunes/preview", { birthDate, birthTime: birthTime || null, calendarType, leapMonth: calendarType === "LUNAR" && leapMonth });
      setPreview(value);
      requestAnimationFrame(() => resultRef.current?.focus());
    } catch (failure) {
      if (failure instanceof ApiError && failure.status === 401) onUnauthorized();
      setError(errorMessage(failure));
    } finally { lock.current = false; setBusy(false); }
  }
  const readings = preview ? [
    ["오늘의 흐름", preview.reading.overall], ["사람과 관계", preview.reading.relationship],
    ["일과 배움", preview.reading.work], ["돈과 소비", preview.reading.money], ["오늘의 작은 실천", preview.reading.action],
  ] : [];

  return <section className="panel fortune-panel" id="fortune" aria-labelledby="fortune-heading">
    <div className="fortune-heading"><div><span className="eyebrow">A LITTLE INSIGHT, JUST FOR YOU</span><h2 id="fortune-heading">오늘, 나를 위한 한 문장.</h2><p>생년월일로 나의 오늘을 살펴보고, 나누고 싶은 문장을 콘텐츠로 만들어 보세요.</p></div><span className="fortune-symbol" aria-hidden="true">✳</span></div>
    <form onSubmit={generate} className="fortune-form">
      <fieldset disabled={busy || disabled}><legend>생일 기준</legend><div className="calendar-options">
        <label><input type="radio" name="calendar-type" checked={calendarType === "SOLAR"} onChange={() => { setCalendarType("SOLAR"); setLeapMonth(false); invalidate(); }} />양력</label>
        <label><input type="radio" name="calendar-type" checked={calendarType === "LUNAR"} onChange={() => { setCalendarType("LUNAR"); invalidate(); }} />음력</label>
        {calendarType === "LUNAR" && <label><input type="checkbox" checked={leapMonth} onChange={event => { setLeapMonth(event.target.checked); invalidate(); }} />윤달</label>}
      </div></fieldset>
      <div className="fortune-inputs">
        <div><label htmlFor="birth-date">생년월일</label><input id="birth-date" type={calendarType === "SOLAR" ? "date" : "text"} inputMode={calendarType === "LUNAR" ? "numeric" : undefined} placeholder="YYYY-MM-DD" pattern={calendarType === "LUNAR" ? "[0-9]{4}-[0-9]{2}-[0-9]{2}" : undefined} required value={birthDate} onChange={event => { setBirthDate(event.target.value); invalidate(); }} disabled={busy || disabled} aria-describedby="birth-help" /></div>
        <div><label htmlFor="birth-time">태어난 시각 <span>선택</span></label><input id="birth-time" type="time" value={birthTime} onChange={event => { setBirthTime(event.target.value); invalidate(); }} disabled={busy || disabled} /></div>
        <button className="button primary" type="submit" disabled={busy || disabled || !birthDate}>{busy ? "오늘의 운세를 살펴보는 중…" : "내 오늘의 운세 보기"}</button>
      </div>
      <p className="fortune-privacy" id="birth-help">{calendarType === "LUNAR" ? "음력 날짜는 YYYY-MM-DD로 입력하세요. " : ""}태어난 시각을 모르면 비워 두세요. 생년월일과 시각은 게시글에 포함되지 않습니다.</p>
      {error && <p className="fortune-error" role="alert">{error}</p>}
    </form>
    {preview && <div className="fortune-result" ref={resultRef} tabIndex={-1} aria-label="운세 미리보기 결과">
      <div className="fortune-result-top"><h3>{preview.date} · 오늘의 운세</h3><span>나의 일간 · {preview.chart.dayElement}</span></div>
      <dl className="fortune-chart">{([["년주", preview.chart.year], ["월주", preview.chart.month], ["일주", preview.chart.day], ["시주", preview.chart.hour || "시간 미입력"]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className="fortune-basis">{preview.basis}</p>
      <div className="fortune-readings">{readings.map(([label, value]) => <article key={label}><h4>{label}</h4><p>{value}</p></article>)}</div>
      <p className="fortune-notice">{preview.notice}</p>
      <div className="fortune-download"><button type="button" className="button soft" onClick={() => void downloadFortuneCard(preview).catch(failure => setError(errorMessage(failure)))}>운세 카드 JPEG 저장</button><p>생년월일 없이 1080×1350 이미지로 저장합니다. Instagram에 게시하려면 이미지를 업로드한 뒤 공개 HTTPS URL을 작성창에 넣어 주세요.</p></div><div className="fortune-caption-actions"><div><strong>나누고 싶은 오늘의 문장</strong><p>채널에 맞는 글을 작성창으로 가져옵니다. 내용을 확인한 뒤 초안으로 저장하세요.</p></div><div><button type="button" className="button secondary" disabled={disabled} onClick={() => onCaption("THREADS", preview.threadsText)}>Threads 글 만들기</button><button type="button" className="button secondary" disabled={disabled} onClick={() => onCaption("INSTAGRAM", preview.instagramText)}>Instagram 글 만들기</button></div></div>
    </div>}
  </section>;
}

