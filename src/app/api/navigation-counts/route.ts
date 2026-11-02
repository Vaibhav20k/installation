import { cookies } from 'next/headers';
import { database } from "@/server/session";
import { DEMO_COOKIE, resolveActor } from '@/server/auth/actor';
import { HTTP_STATUS, toAppError } from '@/server/errors';
import { approvalQueues } from '@/server/queries/time';
import { attendanceExceptions } from '@/server/queries/attendance';
import { pendingAdditionalWork } from '@/server/services/commercial';
import { myPending } from '@/server/queries/dispatch';
import { reportsToDecide } from '@/server/services/site-mnd';
import { actorRoles } from '@/server/services/flow-core';
export const dynamic='force-dynamic';
export async function GET(){
 try {
  const db=await database();
  const actor=await resolveActor(db,(await cookies()).get(DEMO_COOKIE)?.value);
  const counts:Record<string,number>={};
  await Promise.all([
   (async()=>{if(actor.role==='employee')return;const [q,x,aw]=await Promise.all([approvalQueues(db,actor),attendanceExceptions(db,actor,Date.now()),pendingAdditionalWork(db,actor)]);counts['/approvals']=q.plans.length+q.time.length+q.overtime.length+q.expenses.length+x.missed.length+x.corrections.length+x.leave.length+aw.length;})(),
   (async()=>{const [drafts]=await db.query<{n:number}>("select count(*)::int n from time_entry where employee_id=$1 and is_current and state in ('draft','returned')",[actor.id]);counts['/timesheets']=drafts?.n??0;})(),
   (async()=>{if(!(await actorRoles(db,actor.id)).length)return;const [pending,reports]=await Promise.all([myPending(db,actor,Date.now()),reportsToDecide(db,actor)]);counts['/dispatch']=pending.items.length+reports.length;})()
  ]);
  return Response.json(counts,{headers:{'cache-control':'private, no-store'}});
 }catch(e){const err=toAppError(e);return Response.json({message:err.message},{status:HTTP_STATUS[err.kind]});}
}
