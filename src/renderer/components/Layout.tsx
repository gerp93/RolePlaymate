import { ReactNode, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useSecurity } from '../context/SecurityContext';
import PinModal from './PinModal';
import './Layout.css';

const NAV_ITEMS = [
  { to: '/chat', label: 'Chat', end: false },
  { to: '/', label: 'Characters', end: true },
  { to: '/personas', label: 'Personas', end: false },
  { to: '/world-books', label: 'World Books', end: false },
  { to: '/prompt-tuning', label: 'Prompt Tuning', end: false },
  { to: '/model-tuning', label: 'Model Tuning', end: false },
  { to: '/settings', label: 'Settings', end: false },
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
        <ul>
          {NAV_ITEMS.map((item) => (
            <li key={item.label}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
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
