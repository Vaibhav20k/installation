import Link from "next/link";
import { CaretRight } from "@phosphor-icons/react/dist/ssr";
import { session } from "@/server/session";
import { myTasks } from "@/server/queries/work";
import { qty, when } from "@/lib/format";
import { Badge } from "@/components/ui/Badge";
import { Empty, PageHeader } from "@/components/ui/Notice";

export const metadata = { title: "My tasks" };

export default async function MyTasksPage() {
  const { db, actor } = await session();
  const now = Date.now();
  const visits = await myTasks(db, actor, now);
  return (
    <div className="stack" style={{ gap: 16, maxWidth: 820, width: "100%" }}>
      <PageHeader title="My tasks" subtitle="Everything you are booked on from today. Update today's work from My day; quantities count once per task, not once per person." />
      {visits.length === 0 ? <Empty>You are not booked on any upcoming visit.</Empty> : visits.map((v) => {
        const onNow = v.start <= now && v.end > now;
        return (
          <section key={v.id} className="plate" aria-labelledby={`h-${v.id}`}>
            <div className="plate-head"><span className="code-tag">{v.business_id}</span>{v.state === "held" ? <Badge state="held" label="Held" /> : <Badge state={v.exec_status} />}</div>
            <h2 id={`h-${v.id}`} className="plate-title" style={{ fontSize: 19 }}>{v.project}</h2>
            <p className="plate-sub">{v.site_address} · {when(v.start)} to {when(v.end)}</p>
            {v.tasks.length === 0 ? <p className="small muted">No scope committed yet.</p> : (
              <ul className="task-list" style={{ marginTop: 10 }}>
                {v.tasks.map((t) => {
                  const remaining = Math.max(0, t.scoped - t.accepted);
                  const p = t.scoped ? Math.min(100, Math.round((t.accepted / t.scoped) * 100)) : 0;
                  return (
                    <li key={t.id} className="task-row">
                      <div className="spread"><span className="code-tag">{t.task}</span>{t.kind !== "original" && <Badge state="provisional" label={t.kind === "additional" ? "Additional scope" : "Rework"} />}</div>
                      <div className="callout-title" style={{ marginTop: 4 }}>{t.component} · {t.activity}</div>
                      <div className="small muted">{qty(t.accepted)} of {qty(t.scoped)} {t.unit} accepted · {qty(remaining)} remaining</div>
                      <div className="meter" role="img" aria-label={`${p}% done`}><span style={{ transform: `scaleX(${p / 100})` }} /></div>
                    </li>
                  );
                })}
              </ul>
            )}
            {onNow && v.exec_status === "in_progress" && <Link className="button primary" href="/my-day#progress" style={{ marginTop: 12 }}>Update work <CaretRight size={16} aria-hidden /></Link>}
          </section>
        );
      })}
    </div>
  );
}
