-- Admin-only employee skill cards (request of 23 Oct 2026). Cards read the existing employee, skill and
-- planning records; nothing here duplicates an employee or stores an editable availability flag.

-- Supporting notes on a skill record and a version for safe concurrent edits.
alter table employee_skill add column notes text;
alter table employee_skill add column version int not null default 1;

-- Every change to a skill record: who, when, why, and the values before and after. Append-only.
create table employee_skill_change (
  id uuid primary key default gen_random_uuid(),
  employee_skill_id uuid not null references employee_skill(id),
  employee_id uuid not null references employee(id),
  change text not null check (change in ('claimed','level','validity','notes','verified','unverified')),
  before jsonb,
  after jsonb,
  reason text,
  actor_id uuid references employee(id),
  at timestamptz not null default now()
);
create index employee_skill_change_skill on employee_skill_change(employee_skill_id, at desc);
create index employee_skill_change_emp on employee_skill_change(employee_id, at desc);
create trigger employee_skill_change_append_only before update or delete on employee_skill_change for each row execute function forbid_change();

-- Card evidence and portraits: private attachments readable by administrators only.
alter table evidence_link drop constraint evidence_link_parent_type_check;
alter table evidence_link add constraint evidence_link_parent_type_check check (parent_type in ('progress_event','visit_task','attendance_event','shift_instance','attendance_correction',
  'time_entry','ot_request','expense','leave_request','delay_event','readiness_check','schedule_day','quality_case','issue','acceptance',
  'additional_work','package_exception','design_request','communication_log','employee_skill','site_restriction','appliance_dependency',
  'quantity_snapshot','substitution','scan_event','design_revision','employee_skill_change','employee_portrait'));

-- Card filters search by role, city and skill; these keep the directory query bounded.
create index if not exists employee_skill_emp on employee_skill(employee_id);
create index if not exists reservation_emp_span on reservation using gist (employee_id, span) where state in ('held','confirmed');
