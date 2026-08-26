import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import './Layout.css';

const NAV_ITEMS = [
  { to: '/', label: 'Characters', end: true },
  { to: '/chat', label: 'Chat', end: false },
  { to: '/lorebooks', label: 'Lorebooks', end: false },
  { to: '/personas', label: 'Personas', end: false },
  { to: '/settings', label: 'Settings', end: false },
];

export default function Layout({ children }: { children: ReactNode }) {
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
            <li key={item.to}>
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
