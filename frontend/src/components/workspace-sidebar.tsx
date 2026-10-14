import Link from "next/link";

type IconName = "overview" | "studio" | "accounts" | "fortune" | "create" | "clock" | "activity";
function NavIcon({ name }: { name: IconName }) {
  const shapes: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    studio: <><rect x="4" y="4" width="13" height="14" rx="2" /><path d="M8 8h5M8 12h5m-3 9h8a3 3 0 0 0 3-3V9" /></>,
    accounts: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17 7h.01" /></>,
    fortune: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
    create: <path d="M12 5v14M5 12h14" />,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

export function WorkspaceSidebar({ active }: { active: "dashboard" | "studio" }) {
  return <aside className="sidebar">
    <Link className="brand" href="/" aria-label="insauto 홈"><span className="brand-mark"><NavIcon name="fortune" /></span>insauto<span className="brand-dot">.</span></Link>
    <div className="workspace-label">YOUR WORKSPACE</div>
    <nav className="main-nav" aria-label="주 메뉴">
      <Link href="/" className={active === "dashboard" ? "nav-active" : ""} aria-current={active === "dashboard" ? "page" : undefined}><NavIcon name="overview" />오버뷰{active === "dashboard" && <span className="nav-dot" />}</Link>
      <Link href="/saju-content" className={active === "studio" ? "nav-active" : ""} aria-current={active === "studio" ? "page" : undefined}><NavIcon name="studio" />사주 콘텐츠 발행하기{active === "studio" && <span className="nav-dot" />}</Link>
      <Link href="/#connections"><NavIcon name="accounts" />계정 연결</Link>
      <Link href="/#fortune"><NavIcon name="fortune" />오늘의 운세</Link>
      <Link href="/#composer"><NavIcon name="create" />콘텐츠 만들기</Link>
      <Link href="/#pipeline"><NavIcon name="clock" />콘텐츠 관리</Link>
      <Link href="/#activity"><NavIcon name="activity" />활동 기록</Link>
    </nav>
    <div className="sidebar-bottom">
      <div className="ai-note"><span className="small-icon">↗</span><strong>아이디어에서 발행까지.</strong><p>문장을 다듬고, 순서를 확인하고,<br />내 계정에 직접 발행하세요.</p><a href="/api/schema" target="_blank" rel="noreferrer">OpenAPI 명세 ↗</a></div>
      <div className="workspace-profile"><span className="avatar">W</span><div><strong>내 워크스페이스</strong><span>Personal workspace</span></div><span className="profile-dot" /></div>
    </div>
  </aside>;
}
