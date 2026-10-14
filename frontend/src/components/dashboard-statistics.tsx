import type { Post } from "@/lib/client-api";
import { platformLabel } from "@/lib/client-api";
import { buildDashboardStats } from "@/lib/dashboard-stats";

type Props = { posts: Post[]; loading: boolean; unavailable?: boolean };
const number = (value: number) => value.toLocaleString("ko-KR");

export function DashboardStatistics({ posts, loading, unavailable = false }: Props) {
  const stats = buildDashboardStats(posts);
  const pending = loading || unavailable;
  const placeholder = loading ? "통계를 불러오는 중입니다." : "통계를 불러오지 못했습니다.";
  const metrics = [
    { label: "전체 콘텐츠", value: stats.total, detail: "등록한 콘텐츠" },
    { label: "게시 완료", value: stats.published, detail: "실제 발행 완료" },
    { label: "작성 중", value: stats.drafts, detail: "저장된 초안" },
    { label: "확인 필요", value: stats.attention, detail: "실패 · 일부 발행 · 결과 미확인" },
  ];
  const maxDailyCount = Math.max(1, ...stats.last7Days.map(day => day.count));

  return <section className="stats-overview" aria-label="콘텐츠 통계" aria-busy={loading}>
    <div className="stats-metrics">
      {metrics.map(metric => <article className={`stats-metric${metric.label === "확인 필요" && metric.value > 0 && !pending ? " stats-metric-attention" : ""}`} key={metric.label}>
        <span className="stats-metric-label">{metric.label}</span>
        <strong className="stats-metric-value">{pending ? "—" : number(metric.value)}</strong>
        <span className="stats-metric-detail">{metric.detail}</span>
      </article>)}
    </div>
    <div className="stats-chart-row">
      <article className="stats-trend">
        <div className="stats-chart-heading"><div><h2>최근 7일 등록</h2><p>한국 시간 기준 · 콘텐츠 단위</p></div><strong>{pending ? "—" : number(stats.createdLast7Days)}<span>개</span></strong></div>
        {pending ? <div className="stats-placeholder" role="status">{placeholder}</div> : <>
          <ol className="stats-bars" aria-label="날짜별 등록한 콘텐츠 수">
            {stats.last7Days.map((day, index) => <li className={`stats-bar-column${index === 6 ? " stats-bar-today" : ""}`} key={day.date} aria-label={`${day.date}, ${day.count}개`}>
              <span className="stats-bar-count" aria-hidden="true">{day.count}</span>
              <div className="stats-bar-track" aria-hidden="true"><div className="stats-bar-fill" style={{ height: `${day.count / maxDailyCount * 100}%` }} /></div>
              <span className="stats-bar-label" aria-hidden="true">{day.label}</span>
            </li>)}
          </ol>
          {stats.createdLast7Days === 0 && <p className="stats-empty-hint">새 콘텐츠를 등록하면 여기에 표시됩니다.</p>}
        </>}
      </article>
      <article className="stats-channels">
        <div className="stats-chart-heading"><div><h2>채널별 콘텐츠</h2><p>전체 등록 기준</p></div></div>
        {pending ? <div className="stats-placeholder" role="status">{placeholder}</div> : <>
          <ul className="stats-channel-list">
            {stats.channels.map(channel => <li className={`stats-channel-row stats-channel-${channel.platform.toLowerCase()}`} key={channel.platform}>
              <div className="stats-channel-heading"><span><i className="stats-channel-dot" aria-hidden="true" />{platformLabel(channel.platform)}</span><strong>{number(channel.count)}<span>개</span></strong></div>
              <div className="stats-channel-track" aria-hidden="true"><div className="stats-channel-fill" style={{ width: `${channel.percentage}%` }} /></div>
              <span className="stats-channel-percentage">{Math.round(channel.percentage)}%</span>
            </li>)}
          </ul>
          <p className="stats-chart-note">4부작도 콘텐츠 1개로 집계합니다.</p>
        </>}
      </article>
    </div>
  </section>;
}
