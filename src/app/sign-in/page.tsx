import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { database } from "@/server/session";
import { demoAuthEnabled } from "@/server/auth/actor";
import { signInAs } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a demo identity" };

const GROUPS: Array<[string, string]> = [["admin", "Administrator"], ["manager", "Managers"], ["supervisor", "Site supervisors"], ["employee", "Field crew"]];

export default async function SignIn() {
  if (!demoAuthEnabled()) {
    return (
      <main className="main" style={{ maxWidth: 640, paddingBottom: 48 }}>
        <span className="wordmark"><b>Magppie</b><span>Installations</span></span>
        <section className="plate"><h1>Sign-in is not configured</h1><p className="muted" style={{ margin: 0 }}>Demo sign-in is disabled in production. Connect the organisation&apos;s authentication provider at the identity boundary.</p></section>
      </main>
    );
  }
  const db = await database();
  const people = await db.query<{ id: string; business_id: string; name: string; job_role: string; permission_role: string; capabilities: string[]; base_city: string }>(
    `select id, business_id, name, job_role, permission_role, capabilities, base_city from employee where active
     order by case permission_role when 'admin' then 0 when 'manager' then 1 when 'supervisor' then 2 else 3 end, business_id`);
  return (
    <main className="main" style={{ maxWidth: 760, paddingBottom: 48, paddingTop: "calc(env(safe-area-inset-top, 0px) + 20px)" }}>
      <span className="wordmark"><b>Magppie</b><span>Installations</span></span>
      <div>
        <h1>Who is using this phone?</h1>
        <p className="muted" style={{ margin: 0 }}>Choose a demo identity. This selector is not authentication and is switched off in production.</p>
      </div>
      {GROUPS.map(([role, title]) => {
        const group = people.filter((p) => p.permission_role === role);
        return (
          <section key={role} className="plate" aria-labelledby={`h-${role}`}>
            <div className="plate-head"><h2 id={`h-${role}`} style={{ margin: 0 }}>{title}</h2><span className="code-tag">{group.length}</span></div>
            <ul className="callouts">
              {group.map((p) => (
                <li key={p.id}>
                  <form action={signInAs.bind(null, p.id)}>
                    <button type="submit">
                      <span className="monogram" aria-hidden>{p.name.split(/\s+/).map((x) => x[0]).join("").slice(0, 2)}</span>
                      <span>
                        <span className="callout-title">{p.name} <span className="code">{p.business_id}</span></span>
                        <span className="callout-meta">{p.job_role.replace(/_/g, " ")} · {p.base_city}{p.capabilities.length ? ` · ${p.capabilities.map((c) => c.replace(/_/g, " ")).join(", ")}` : ""}</span>
                      </span>
                      <CaretRight size={18} className="callout-go" aria-hidden />
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </main>
  );
}
