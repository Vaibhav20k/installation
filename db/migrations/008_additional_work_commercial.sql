-- 008: approved additional work (chargeable / free of charge / waived) and quoted installation charges,
-- kept separate from internal estimates, approved budgets and actual costs (spec V3 requirements 8, 9, 11).

create table additional_work (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  order_id uuid not null references sales_order(id),
  visit_id uuid references visit(id),
  description text not null,
  requested_by text not null check (requested_by in ('customer','sales','site_team','design','other')),
  reason text not null,
  estimated_minutes int check (estimated_minutes >= 0),
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  charge_type text check (charge_type in ('chargeable','free_of_charge','waived')),
  quoted_amount_minor bigint check (quoted_amount_minor >= 0),
  commercial_ref text,
  planned_cost_minor bigint check (planned_cost_minor >= 0),
  decided_by uuid references employee(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (status <> 'approved' or charge_type is not null),
  check (charge_type <> 'chargeable' or quoted_amount_minor is not null or status <> 'approved')
);

-- Customer-facing installation charge per order. A zero charge never implies zero effort.
create table installation_charge (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  order_id uuid not null references sales_order(id),
  quoted_minor bigint not null check (quoted_minor >= 0),
  waived_minor bigint not null default 0 check (waived_minor >= 0),
  currency text not null default 'INR',
  source text not null,
  reference text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (waived_minor <= quoted_minor)
);
create unique index installation_charge_current on installation_charge(order_id) where is_current;

-- Time on approved additional work links to it; the same minutes are never recorded twice.
alter table time_entry add column additional_work_id uuid references additional_work(id);

alter table evidence_link drop constraint evidence_link_parent_type_check;
alter table evidence_link add constraint evidence_link_parent_type_check check (parent_type in ('progress_event','visit_task','attendance_event','shift_instance','attendance_correction',
  'time_entry','ot_request','expense','leave_request','delay_event','readiness_check','schedule_day','quality_case','issue','acceptance',
  'additional_work','package_exception','design_request','communication_log','employee_skill','site_restriction','appliance_dependency'));

-- Work brought forward from a future day, authorised by a supervisor, is distinct from catch-up on today's target.
alter table ot_request drop constraint ot_request_verified_reason_check;
alter table ot_request add constraint ot_request_verified_reason_check check (verified_reason in ('original_target_catch_up','authorized_additional_scope','authorized_future_task','external_delay','other_documented'));
