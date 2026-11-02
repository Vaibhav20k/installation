/** Presentation-only demo roster. Employee records and department memberships are preserved. */
export interface DemoPerson { id: string; business_id: string; name: string; permission_role: string; job_role: string }
export function demoPeopleGroups<T extends DemoPerson>(people: T[]) {
  const sorted = [...people].sort((a,b) => a.business_id.localeCompare(b.business_id));
  const managers = sorted.filter(p => p.permission_role === 'manager').slice(0,4);
  return [
    {id:'admin',label:'Administrator',people:sorted.filter(p=>p.permission_role==='admin').slice(0,1)},
    {id:'manager',label:'Managers',people:managers},
    {id:'supervisor',label:'Site supervisors',people:sorted.filter(p=>p.permission_role==='supervisor').slice(0,3)},
    {id:'employee',label:'Field crew',people:sorted.filter(p=>p.permission_role==='employee' && p.job_role!=='department_staff' && !p.business_id.startsWith('HUB-'))},
    {id:'hub',label:'Department users (HUB)',people:sorted.filter(p=>p.business_id.startsWith('HUB-') && !managers.some(m=>m.id===p.id)).slice(0,3)},
  ];
}
