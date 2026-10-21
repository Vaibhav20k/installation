import { session } from "@/server/session";
import { ADAPTERS } from "@/integrations/source-adapter";
import { Notice, PageHeader } from "@/components/ui/Notice";
import { ImportPanel } from "@/components/project/ImportPanel";

export const metadata = { title: "Import orders" };

export default async function ImportPage() {
  const { db, actor } = await session();
  if (actor.role !== "manager" && actor.role !== "admin") return <Notice tone="warn" title="Not permitted">Source imports are for managers and administrators.</Notice>;
  const history = await db.query<{ source_system: string; external_id: string; revision: string; applied_at: number; applied_by: string | null }>(
    "select s.source_system, s.external_id, s.revision, s.applied_at, e.name applied_by from source_import s left join employee e on e.id = s.applied_by order by s.applied_at desc limit 50");
  return (
    <>
      <PageHeader title="Import orders from a source system" subtitle="Preview every mapping first. Imports are idempotent per source system, external ID and revision, reject inconsistent units or relationships, and never rewrite approved plan revisions." />
      <Notice tone="warn">No external CRM, estimator, PDA or dispatch API is connected. The only adapter is a labelled demo fixture; a live adapter must implement <code>src/integrations/source-adapter.ts</code> against a documented contract.</Notice>
      <ImportPanel adapters={Object.values(ADAPTERS).map((a) => ({ system: a.system, label: a.label, live: a.live }))} history={history} />
    </>
  );
}
