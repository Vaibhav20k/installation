import Link from "next/link";
import { CaretLeft } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { flowSetup } from "@/server/queries/dispatch";
import { when } from "@/lib/format";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { DefinitionEditor, RoleMembers } from "@/components/dispatch/FlowSetup";

export const metadata = { title: "Dispatch setup" };

export default async function DispatchSetup() {
  const { db, actor } = await session();
  if (actor.role !== "admin") return <Notice tone="warn" title="Not permitted">Dispatch setup is for administrators.</Notice>;
  const s = await flowSetup(db, actor);
  const active = (flow: string) => s.versions.find((v) => v.flow === flow && v.active)!;
  return (
    <div className="stack flow-page">
      <Link href="/dispatch" className="small back-link"><CaretLeft size={14} aria-hidden /> Dispatch</Link>
      <PageHeader title="Dispatch setup" subtitle="Who does each step, and the steps themselves. Changes apply to new dispatches and complaints; open ones finish on their own version." />
      <section className="plate" aria-labelledby="h-roles"><h2 id="h-roles" className="flow-subhead">Department roles</h2><RoleMembers roles={s.roles} people={s.people} /></section>
      {(["dispatch", "complaint"] as const).map((flow) => {
        const a = active(flow);
        return (
          <section key={flow} className="plate" aria-labelledby={`h-${flow}`}>
            <h2 id={`h-${flow}`} className="flow-subhead">{flow === "dispatch" ? "Dispatch flow" : "Complaint (MND) flow"}</h2>
            <DefinitionEditor flow={flow} version={a.version} current={JSON.stringify(a.definition, null, 2)} />
            <details style={{ marginTop: 10 }}><summary className="small">Versions ({s.versions.filter((v) => v.flow === flow).length})</summary>
              <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>{s.versions.filter((v) => v.flow === flow).map((v) => (
                <li key={v.version}>v{v.version}{v.active ? " (active)" : ""} · {v.note ?? ""} · {v.by ?? "system"} · {when(Number(v.created_at))} · {v.in_use} open record{v.in_use === 1 ? "" : "s"}</li>
              ))}</ul></details>
          </section>
        );
      })}
    </div>
  );
}
