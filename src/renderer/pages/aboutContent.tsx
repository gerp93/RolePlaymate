import { ReactNode } from 'react';

export function AboutLead({ children }: { children: ReactNode }) {
  return <p className="about-prose">{children}</p>;
}

export function AboutSubheading({ children }: { children: ReactNode }) {
  return <h3 className="about-subheading">{children}</h3>;
}

export function AboutList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="about-list">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

export function AboutCallout({ children }: { children: ReactNode }) {
  return <div className="about-callout">{children}</div>;
}

export function AboutFlow({ children }: { children: ReactNode }) {
  return <div className="about-flow">{children}</div>;
}

export function AboutFlowRow({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="about-flow-row">
      <span className="about-flow-label">{label}</span>
      <span className="about-flow-detail text-muted">{detail}</span>
    </div>
  );
}
