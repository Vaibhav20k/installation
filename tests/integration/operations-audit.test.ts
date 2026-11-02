/** Regression tests for the four defects found during the manual QA review. */
import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { freshDb, actor } from './helpers';
import type { Db } from '@/server/db/client';
import { makeCtx } from '@/server/services/context';
import { saveOperationsPolicy } from '@/server/services/operations-policy';
import { createSitePlans, transitionSitePlan, sitePlanDetail, sitePlans } from '@/server/services/workforce';
import { siteCheckIn, siteCheckOut, correctPresence } from '@/server/services/site-presence';
import { updateVisitDates } from '@/server/services/planning';

describe('QA review regression fixes', () => {
 let db: Db;
 const now=Date.parse('2026-11-02T04:00:00Z');
 const policy={tier1Max:'1000',tier2Max:'5000',planApprover:'installation_head',regularizationApprover:'installation_head',readinessReminderDays:1,installation:{dailyMinutes:480,hourlyRate:'100'},complaint:{dailyMinutes:240,hourlyRate:'150'}};
 const ctx=async(bid:string,time=now)=>makeCtx(db,await actor(db,bid),time);
 beforeEach(async()=>{db=await freshDb();await db.query("insert into flow_role_member(role_code,employee_id) select 'installation_head',id from employee where business_id='HUB-005'");await saveOperationsPolicy(await ctx('EMP-004'),policy);});
 afterEach(async()=>db.close());
 async function plan(){
  const [o]=await db.query<{id:string;project_id:string}>("select o.id,o.project_id from sales_order o join project p on p.id=o.project_id join employee e on e.id=p.manager_id where e.business_id='EMP-001' limit 1");
  return (await createSitePlans(await ctx('EMP-001'),{sites:[{projectId:o!.project_id,orderIds:[o!.id],start:'2026-11-02',end:'2026-11-02',employeeIds:[(await actor(db,'EMP-020')).id],budgetMinutes:2000}]})).plans[0]!;
 }
 async function approve(id:string){await transitionSitePlan(await ctx('EMP-001'),{planId:id,action:'submit',comment:'Ready for review'});await transitionSitePlan(await ctx('HUB-005'),{planId:id,action:'approve',comment:'Reviewed and approved'});}
 it('BUG-01: Installation Head must retain site-plan visibility when another role approves',async()=>{
  await saveOperationsPolicy(await ctx('EMP-004'),{...policy,planApprover:'owners',regularizationApprover:'owners'});
  const p=await plan();
  await db.query("insert into flow_role_member(role_code,employee_id) select 'installation_head',id from employee where business_id='EMP-021'");
  const head=await actor(db,'EMP-021');
  const listed=await sitePlans(db,head);
  let denied=false;try{await sitePlanDetail(db,head,p.id);}catch{denied=true;}
  expect({listed:listed.some(x=>x.id===p.id),denied}).toEqual({listed:true,denied:false});
  const detail=await sitePlanDetail(db,head,p.id);
  expect(detail.canManage).toBe(false);
  expect(detail.canReview).toBe(false);
  await expect(sitePlanDetail(db,await actor(db,'EMP-022'),p.id)).rejects.toThrow();
 });
 it('BUG-02: confirm hours must reject a reopened punch after plan completion',async()=>{
  const p=await plan();await approve(p.id);
  const location=(at:number)=>({latitude:28.6,longitude:77.2,accuracy:10,capturedAt:new Date(at).toISOString()});
  const punch=await siteCheckIn(await ctx('EMP-020'),{visitId:p.visitId,location:location(now)});
  await siteCheckOut(await ctx('EMP-020',now+3600000),{presenceId:punch.presenceId,location:location(now+3600000)});
  await transitionSitePlan(await ctx('EMP-001',now+3600000),{planId:p.id,action:'complete',comment:'Work completed'});
  const [row]=await db.query<{version:number}>('select version from site_presence where id=$1',[punch.presenceId]);
  await correctPresence(await ctx('EMP-001',now+3600000),{presenceId:punch.presenceId,version:row!.version,checkOut:null,reason:'Recorded exit time was incorrect'});
  const before=await sitePlanDetail(db,(await ctx('EMP-001')).actor,p.id);
  expect(before.summary.openPunches).toBe(1);
  await expect(transitionSitePlan(await ctx('EMP-001',now+3600000),{planId:p.id,action:'confirm_hours',comment:'Confirm actual hours'})).rejects.toThrow('Resolve open or missed');
  expect((await sitePlanDetail(db,(await ctx('EMP-001')).actor,p.id)).operations_state).toBe('completed');
  await correctPresence(await ctx('EMP-001',now+3600000),{presenceId:punch.presenceId,version:row!.version+1,checkOut:{date:'2026-11-02',time:'10:30'},reason:'Verified actual exit time'});
  await transitionSitePlan(await ctx('EMP-001',now+3600000),{planId:p.id,action:'confirm_hours',comment:'Confirm corrected hours'});
  expect((await sitePlanDetail(db,(await ctx('EMP-001')).actor,p.id)).confirmed_minutes).toBe(60);
 });
 it('BUG-03: accepted daily-minutes policy must allow creating a site plan',async()=>{
  for (const key of ['installation','complaint'])
    await expect(saveOperationsPolicy(await ctx('EMP-004'),{...policy,[key]:{dailyMinutes:960,hourlyRate:'100'}})).rejects.toThrow();
  await saveOperationsPolicy(await ctx('EMP-004'),{...policy,installation:{dailyMinutes:900,hourlyRate:'100'}});
  const p=await plan();
  expect((await sitePlanDetail(db,(await ctx('EMP-001')).actor,p.id)).summary.plannedMinutes).toBe(900);
 });
 it('BUG-04: date edits must not allow activating a plan with its staff silently removed',async()=>{
  const p=await plan();
  await updateVisitDates(await ctx('EMP-001'),{visitId:p.visitId,plannedStart:'2026-11-03',plannedEnd:'2026-11-03',changeReason:'Site moved work by one day'});
  await approve(p.id);
  const detail=await sitePlanDetail(db,(await ctx('EMP-001')).actor,p.id);
  expect(detail.people.length).toBe(1);
  expect(detail.summary.plannedMinutes).toBe(480);
  const [reservation]=await db.query<{planned_day:string}>("select (lower(span) at time zone 'Asia/Kolkata')::date::text as planned_day from reservation where visit_id=$1 and state='confirmed'",[p.visitId]);
  expect(reservation!.planned_day).toBe('2026-11-03');
 });
 it('rejects submission and approval of previously emptied plans',async()=>{
  const p=await plan();
  await db.query("update reservation set state='cancelled' where visit_id=$1",[p.visitId]);
  await expect(transitionSitePlan(await ctx('EMP-001'),{planId:p.id,action:'submit',comment:'Submit empty team'})).rejects.toThrow('Assign staff');
  const other=await plan();
  await transitionSitePlan(await ctx('EMP-001'),{planId:other.id,action:'submit',comment:'Team ready for review'});
  await db.query("update reservation set state='cancelled' where visit_id=$1",[other.visitId]);
  await expect(transitionSitePlan(await ctx('HUB-005'),{planId:other.id,action:'approve',comment:'Review empty team'})).rejects.toThrow('Assign staff');
 });
});
