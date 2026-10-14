import Link from "next/link";

type IconName = "overview" | "studio" | "accounts" | "fortune";
function NavIcon({ name }: { name: IconName }) {
  const shapes: Record<IconName, React.ReactNode> = {
    overview: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
    studio: <><rect x="4" y="4" width="13" height="14" rx="2" /><path d="M8 8h5M8 12h5m-3 9h8a3 3 0 0 0 3-3V9" /></>,
    accounts: <><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><path d="M17 7h.01" /></>,
    fortune: <path d="m13 2-9 12h7l-1 8 10-13h-8l1-7Z" />,
  };
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

export function WorkspaceSidebar({ active }: { active: "dashboard" | "studio" | "accounts" }) {
  return <aside className="sidebar">
    <Link className="brand" href="/" aria-label="insauto 홈"><span className="brand-mark"><NavIcon name="fortune" /></span>insauto<span className="brand-dot">.</span></Link>
    <div className="workspace-label">내 워크스페이스</div>
    <nav className="main-nav" aria-label="주 메뉴">
      <Link href="/" className={active === "dashboard" ? "nav-active" : ""} aria-current={active === "dashboard" ? "page" : undefined}><NavIcon name="overview" />대시보드</Link>
      <Link href="/saju-content" className={active === "studio" ? "nav-active" : ""} aria-current={active === "studio" ? "page" : undefined}><NavIcon name="studio" />사주 콘텐츠</Link>
      <Link href="/connections" className={active === "accounts" ? "nav-active" : ""} aria-current={active === "accounts" ? "page" : undefined}><NavIcon name="accounts" />계정 연결</Link>
    </nav>
  </aside>;
}
