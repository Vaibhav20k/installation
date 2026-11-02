import Link from 'next/link';
import { session } from '@/server/session';
import { sitePlans, PLAN_LABELS } from '@/server/services/workforce';
import { projectScopeSql, requireProjectScope } from '@/server/auth/permissions';
import { NewSitePlans } from '@/components/planning/SitePlanForms';
import { PageHeader } from '@/components/ui/Notice';
export default async function SitePlansPage({ searchParams }: {
    searchParams: Promise<{
        complaint?: string;
    }>;
}) {
    const { db, actor } = await session();
    const sp = await searchParams;
    const plans = await sitePlans(db, actor);
    const scope = projectScopeSql(actor, 'p');
    const sites = await db.query<{
        id: string;
        name: string;
    }>(`select p.id,p.name from project p where ${scope.sql} order by p.name`, scope.all ? [] : [actor.id]);
    const orders = await db.query<{
        id: string;
        business_id: string;
        project_id: string;
    }>("select id,business_id,project_id from sales_order where project_id=any($1::uuid[]) and status not in('cancelled','closed')", [sites.map(s => s.id)]);
    let complaintId: string | undefined, initialProject: string | undefined;
    if (sp.complaint && /^[0-9a-f-]{36}$/i.test(sp.complaint)) {
        const [c] = await db.query<{
            id: string;
            project_id: string;
        }>('select id,project_id from complaint where id=$1', [sp.complaint]);
        if (c) {
            await requireProjectScope(db, actor, c.project_id);
            complaintId = c.id;
            initialProject = c.project_id;
        }
    }
    const people = actor.role === 'employee' ? [] : await db.query<{
        id: string;
        name: string;
        designation_code: string | null;
    }>("select id,name,designation_code from employee where active and job_role<>'department_staff' order by name");
    const designations = await db.query<{
        code: string;
        name: string;
    }>('select code,name from designation where active order by name');
    return <div className="stack"><PageHeader title="Site Plans" subtitle="Plan the team, approve the budget, and confirm actual site hours."/>
 {actor.role !== 'employee' && actor.role !== 'supervisor' && <NewSitePlans sites={sites.map(s => ({ ...s, orders: orders.filter(o => o.project_id === s.id) }))} people={people} designations={designations} complaintId={complaintId} initialProject={initialProject}/>}
 <ul className="flow-cards">{plans.map(p => <li className="flow-card" key={p.id}><Link href={`/site-plans/${p.id}`}><strong>{p.business_id} · {p.project}</strong><span>{PLAN_LABELS[p.operations_state]}</span></Link></li>)}</ul>{!plans.length && <p>No site plans in your scope yet.</p>}</div>;
}
