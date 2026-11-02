import { describe,it,expect } from 'vitest';
import { demoPeopleGroups } from '@/lib/demo-people';
describe('demo identity presentation',()=>{
 it('caps admin, managers, supervisors and department users without removing field crew',()=>{
  const people=[...Array.from({length:8},(_,i)=>({id:'hub'+i,business_id:`HUB-00${i+1}`,name:'Department',permission_role:i===4?'manager':'employee',job_role:'department_staff'})),...Array.from({length:3},(_,i)=>({id:'m'+i,business_id:`EMP-00${i+1}`,name:'Manager',permission_role:'manager',job_role:'project_manager'})),{id:'a',business_id:'EMP-004',name:'Admin',permission_role:'admin',job_role:'operator'},...Array.from({length:5},(_,i)=>({id:'s'+i,business_id:`EMP-00${i+5}`,name:'Supervisor',permission_role:'supervisor',job_role:'site_supervisor'})),...Array.from({length:30},(_,i)=>({id:'f'+i,business_id:`EMP-${i+10}`,name:'Crew',permission_role:'employee',job_role:'technician'}))];
  const groups=demoPeopleGroups(people);
  expect(groups.map(g=>g.people.length)).toEqual([1,4,3,30,3]);
  expect(groups[1]!.people.map(p=>p.business_id)).toContain('HUB-005');
  expect(groups[4]!.people.map(p=>p.business_id)).toEqual(['HUB-001','HUB-002','HUB-003']);
  expect(people).toHaveLength(47);
 });
});
