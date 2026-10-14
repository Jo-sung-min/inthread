"use client";
import { segmentCount } from "@/lib/content-studio";
const labels = ["시선을 잡는 첫 문장", "공감과 구체적인 상황", "사주로 풀어보는 관점", "행동을 부르는 마무리"];
export function SegmentEditor({ segments, onChange, idPrefix, disabled }: { segments: string[]; onChange: (index: number, value: string) => void; idPrefix: string; disabled?: boolean }) {
  return <div className="studio-segment-grid">{segments.map((segment, index) => {
    const count = segmentCount(segment);
    return <div className="studio-segment" key={index}>
      <label htmlFor={`${idPrefix}-${index}`}><span>{String(index + 1).padStart(2, "0")}</span>{labels[index] || `${index + 1}번째 문단`}</label>
      <textarea id={`${idPrefix}-${index}`} value={segment} onChange={event => onChange(index, event.target.value)} disabled={disabled} rows={6} aria-describedby={`${idPrefix}-count-${index}`} />
      <div id={`${idPrefix}-count-${index}`} className={count > 500 || count === 0 ? "studio-segment-count invalid" : "studio-segment-count"}><span>{index + 1}/4 · Threads 한 게시물</span><span>{count} / 500자</span></div>
    </div>;
  })}</div>;
}
