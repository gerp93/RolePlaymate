import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { getLastConversationId } from '../utils/lastConversation';
import './Layout.css';

const NAV_ITEMS = [
  { to: '/', label: 'Characters', end: true },
  { to: '/chat', label: 'Chat', end: false },
  { to: '/world-books', label: 'World Books', end: false },
  { to: '/personas', label: 'Personas', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export default function Layout({ children }: { children: ReactNode }) {
  // Re-read on every render (Layout re-renders on every navigation, since `children` changes
  // reference), so switching away from Chat and back always points at whichever conversation
  // was open most recently, not just whichever was open when Layout first mounted.
  const lastConversationId = getLastConversationId();

  const navItems = NAV_ITEMS.map((item) =>
    item.to === '/chat' && lastConversationId ? { ...item, to: `/chat/${lastConversationId}` } : item
  );

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
          {navItems.map((item) => (
            <li key={item.label}>
              <NavLink to={item.to} end={item.end} className={({ isActive }) => (isActive ? 'active' : '')}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="main-content">{children}</main>
    </div>
  );
}
