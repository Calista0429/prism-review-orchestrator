import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  GitPullRequest,
  LayoutDashboard,
  ShieldCheck,
  SlidersHorizontal,
  Triangle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function Layout() {
  const health = useQuery({
    queryKey: ['health'],
    queryFn: () =>
      api<{ status: string; provider: 'demo' | 'openrouter' }>('/health'),
    refetchInterval: 30000,
  });
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink to="/" className="brand" aria-label="PRISM home">
          <Triangle size={26} strokeWidth={1.5} />
          <span>PRISM</span>
        </NavLink>
        <div className="workspace">
          <span className="workspace-icon">M</span>
          <span>
            Mobility engineering{' '}
            <span className="subtle">/ Review workspace</span>
          </span>
        </div>
        <span
          className={`provider-indicator ${health.isError ? 'offline' : ''}`}
        >
          <span className="status-dot" />
          {health.data?.provider === 'demo'
            ? 'Demo assessment'
            : health.data?.provider === 'openrouter'
              ? 'Live assessment'
              : health.isError
                ? 'Service unavailable'
                : 'Connecting'}
        </span>
      </header>
      <aside className="sidebar">
        <div className="sidebar-context">
          <GitPullRequest size={17} />
          <span>Review operations</span>
        </div>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>
            <LayoutDashboard size={18} />
            Command center
          </NavLink>
          <NavLink to="/policies">
            <SlidersHorizontal size={18} />
            Policy simulator
          </NavLink>
          <NavLink to="/audit">
            <Activity size={18} />
            Audit trail
          </NavLink>
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={21} />
          <strong>Every route has a reason.</strong>
          <p>Evidence, policy, and human judgment in one trace.</p>
          <span>No merge actions</span>
        </div>
      </aside>
      <main id="main">
        <Outlet />
      </main>
      <footer className="mobile-footer">PRISM · Review orchestration</footer>
    </div>
  );
}
