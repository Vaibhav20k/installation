import { IdentityDirectory } from "@/components/IdentityDirectory";
import { database } from "@/server/session";
import { demoAuthEnabled } from "@/server/auth/actor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Choose a demo identity" };



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
      <div className="signin-intro">
        <h1>Choose your workspace</h1>
        <p className="muted" style={{ margin: 0 }}>Find your name to see your next actions. This demo selector is not authentication and is switched off in production.</p>
      </div>
      <IdentityDirectory people={people} />
    </main>
  );
}
