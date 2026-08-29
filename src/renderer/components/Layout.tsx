import { ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSecurity } from '../context/SecurityContext';
import PinModal from './PinModal';
import './Layout.css';

interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

interface NavSection {
  label: string;
  items: NavItem[];
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Chat',
    items: [
      { to: '/chat', label: 'Chat' },
      { to: '/prompt-tuning', label: 'Prompt Tuning' },
      { to: '/model-tuning', label: 'Model Tuning' },
    ],
  },
  {
    label: 'Library',
    items: [
      { to: '/characters', label: 'Characters', end: true },
      { to: '/personas', label: 'Personas' },
      { to: '/world-books', label: 'World Books' },
    ],
  },
];

const NAV_TRAILING: NavItem[] = [
  { to: '/about', label: 'About', end: true },
  { to: '/settings', label: 'Settings' },
];

export default function Layout({ children }: { children: ReactNode }) {
  const { hiddenUnlocked, lock } = useSecurity();
  const [pinModalOpen, setPinModalOpen] = useState(false);
  // Chat's own conversation sidebar wants to sit almost flush against the window edge --
  // .main-content's normal 32px left padding is too generous for it, unlike every other page
  // here which relies on that padding for breathing room around a centered form/table.
  const { pathname } = useLocation();
  const isChatRoute = pathname.startsWith('/chat');

  return (
    <div className="app-root">
      <nav className="topbar">
        <div className="topbar-title">
          <img
            src={`${import.meta.env.BASE_URL}logo.png`}
            alt=""
            className="topbar-logo"
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          RolePlaymate
        </div>
        <nav className="topbar-nav" aria-label="Main">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="topbar-section">
              <span className="topbar-section-label">{section.label}</span>
              <ul>
                {section.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) => (isActive ? 'active' : '')}
                    >
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <ul className="topbar-trailing">
            {NAV_TRAILING.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? 'active' : '')}
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
        <span className="topbar-spacer" />
        <button
          type="button"
          className={`btn hidden-toggle${hiddenUnlocked ? ' active' : ''}`}
          title={hiddenUnlocked ? 'Hide hidden items' : 'Show hidden items'}
          onClick={() => (hiddenUnlocked ? void lock() : setPinModalOpen(true))}
        >
          {hiddenUnlocked ? '🔓' : '🔒'}
        </button>
      </nav>
      <main className={`main-content${isChatRoute ? ' main-content-chat' : ''}`}>{children}</main>
      {pinModalOpen && <PinModal onClose={() => setPinModalOpen(false)} />}
    </div>
  );
}
