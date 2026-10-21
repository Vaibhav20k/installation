import type { ReactNode } from "react";

export function Notice({ tone = "info", title, children, items, live }: { tone?: "info" | "ok" | "warn" | "bad"; title?: string; children?: ReactNode; items?: string[]; live?: boolean }) {
  return (
    <div className="notice" data-tone={tone} role={live ? (tone === "bad" ? "alert" : "status") : undefined}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
      {items && items.length > 0 && <ul>{items.map((i) => <li key={i}>{i}</li>)}</ul>}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="spread">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted small">{subtitle}</p>}
      </div>
      {actions && <div className="row no-print">{actions}</div>}
    </div>
  );
}

export function Tabs({ items, current }: { items: Array<{ id: string; label: string; href: string }>; current: string }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {items.map((t) => <a key={t.id} href={t.href} aria-current={t.id === current ? "page" : undefined}>{t.label}</a>)}
    </nav>
  );
}
