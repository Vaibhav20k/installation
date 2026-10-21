import Link from "next/link";
import { session } from "@/server/session";
import { getSetting } from "@/server/services/context";
import { approvalQueues } from "@/server/queries/time";
import { RailNav, TabBar } from "@/components/Nav";
import { cookies } from "next/headers";
import { signOut } from "../actions";
import { ThemeQuick, ThemeSwitch } from "@/components/ThemeSwitch";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { demoAuthEnabled } from "@/server/auth/actor";
import { PersonSwitch, type Person } from "@/components/PersonSwitch";

export const dynamic = "force-dynamic";

function Wordmark() {
  return <Link href="/" className="wordmark" aria-label="Magppie Installations, home"><b>Magppie</b><span>Installations</span></Link>;
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { db, actor } = await session();
  const demo = await getSetting(db, "demo_mode", false);
  const counts: Record<string, number> = {};
  if (actor.role !== "employee") {
    const q = await approvalQueues(db, actor);
    counts["/approvals"] = q.plans.length + q.time.length + q.overtime.length + q.expenses.length;
  }
  const [drafts] = await db.query<{ n: number }>("select count(*)::int n from time_entry where employee_id = $1 and is_current and state in ('draft','returned')", [actor.id]);
  if (drafts?.n) counts["/timesheets"] = drafts.n;
  const people = demoAuthEnabled() ? await db.query<Person>(
    `select id, business_id, name, permission_role, job_role from employee where active
     order by case permission_role when 'admin' then 0 when 'manager' then 1 when 'supervisor' then 2 else 3 end, business_id`) : [];
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  const initials = actor.name.split(/\s+/).map((p) => p[0]).join("").slice(0, 2).toUpperCase();
  const identity = (
    <>
      <div><strong>{actor.name}</strong> · <span className="code">{actor.businessId}</span></div>
      <div>{actor.jobRole.replace(/_/g, " ")} · {actor.role}{actor.capabilities.length ? ` · ${actor.capabilities.map((c) => c.replace(/_/g, " ")).join(", ")}` : ""}</div>
      <ThemeSwitch initial={theme} />
      {people.length > 0 && <PersonSwitch people={people} currentId={actor.id} variant="field" />}
      <form action={signOut} style={{ marginTop: 8 }}><button type="submit" className="link">Sign out to the people list</button></form>
    </>
  );
  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="appbar">
        <Wordmark />
        <span className="appbar-end">
          <ThemeQuick initial={theme} />
          <span className="whoami" aria-label={`Signed in as ${actor.name}`}>
            <span className="monogram" aria-hidden>{initials}</span>{actor.businessId}
            {people.length > 0 && <PersonSwitch people={people} currentId={actor.id} variant="chip" />}
          </span>
        </span>
      </header>
      <aside className="rail" aria-label="Main navigation">
        <Wordmark />
        <RailNav role={actor.role} counts={counts} />
        <div className="identity">{identity}</div>
      </aside>
      <main id="main" className="main" tabIndex={-1}>
        {demo && <details className="demo-banner" role="note"><summary><strong>Demo data</strong><span className="demo-more">What this means</span></summary><p>People, customers, rates, calendars, policies and targets are fictional or illustrative, not company records or approved payroll settings.</p></details>}
        {children}
      </main>
      <TabBar role={actor.role} counts={counts} identity={identity} />
    </div>
  );
}
