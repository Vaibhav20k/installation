-- 002: time recording, monthly reconciliation, expenses, quality, issues and KPI reference data.

create table time_policy (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  name text not null,
  status text not null default 'draft' check (status in ('draft','approved','superseded')),
  illustrative boolean not null default true,
  effective_month date not null check (extract(day from effective_month) = 1),
  normal_basis text not null check (normal_basis in ('calendar','fixed')),
  fixed_monthly_minutes int check (fixed_monthly_minutes > 0),
  credited_activities text[] not null,
  catch_up_threshold_credit text not null default 'unset' check (catch_up_threshold_credit in ('unset','include','exclude')),
  candidate_rule text not null default 'outside_schedule_only' check (candidate_rule in ('outside_schedule_only','authorized_any')),
  external_delay_eligibility text not null default 'unset' check (external_delay_eligibility in ('unset','eligible','ineligible')),
  other_documented_eligibility text not null default 'unset' check (other_documented_eligibility in ('unset','eligible','ineligible')),
  allocation_method text not null default 'unset' check (allocation_method in ('unset','chronological','manager_selected')),
  leave_adjustment text not null default 'unset' check (leave_adjustment in ('unset','subtract_scheduled_net')),
  settlement_timezone text not null,
  approved_by uuid references employee(id), approved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (status <> 'approved' or (approved_by is not null and approved_at is not null))
);

create table time_entry (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  project_id uuid references project(id),
  visit_id uuid references visit(id),
  task_id uuid references installation_task(id),
  order_id uuid references sales_order(id),
  overhead_category text,
  activity text not null check (activity in ('installation','additional','rework','travel','waiting','other')),
  span tstzrange not null check (not isempty(span)),
  state text not null default 'draft' check (state in ('draft','submitted','accepted','returned','voided')),
  revision_no int not null default 1,
  supersedes_id uuid references time_entry(id),
  is_current boolean not null default true,
  is_exception boolean not null default false,
  exception_note text,
  exception_resolved boolean not null default false,
  note text,
  first_submitted_at timestamptz,
  reviewed_by uuid references employee(id), reviewed_at timestamptz, review_note text,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (project_id is not null or overhead_category is not null),
  check (task_id is null or visit_id is not null),
  -- No overlapping current entries for the same employee; adjacent entries are valid.
  exclude using gist (employee_id with =, span with &&) where (is_current and state <> 'voided')
);
create index time_entry_emp_span on time_entry using gist (employee_id, span);

create function check_entry_task_scope() returns trigger language plpgsql as $$
begin
  if new.task_id is not null and not exists (select 1 from visit_task vt where vt.visit_id = new.visit_id and vt.task_id = new.task_id) then
    raise exception 'task is not in the selected visit scope' using errcode = '23514';
  end if;
  if new.visit_id is not null and new.project_id is not null and not exists (select 1 from visit v where v.id = new.visit_id and v.project_id = new.project_id) then
    raise exception 'visit belongs to another project' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger time_entry_scope before insert or update on time_entry for each row execute function check_entry_task_scope();

create table break_interval (
  id uuid primary key default gen_random_uuid(),
  time_entry_id uuid not null references time_entry(id),
  span tstzrange not null check (not isempty(span)),
  exclude using gist (time_entry_id with =, span with &&)
);

create table ot_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  time_entry_id uuid not null references time_entry(id),
  span tstzrange not null check (not isempty(span)),
  claimed_reason text not null,
  verified_reason text check (verified_reason in ('original_target_catch_up','authorized_additional_scope','external_delay','other_documented')),
  authorization_ref text,
  decision text not null default 'requested' check (decision in ('requested','eligible','ineligible','pending_policy')),
  decision_code text, decision_explanation text,
  reviewer_id uuid references employee(id), reviewed_at timestamptz,
  policy_id uuid references time_policy(id),
  created_at timestamptz not null default now()
);

create table month_reconciliation (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  month date not null check (extract(day from month) = 1),
  revision int not null,
  policy_id uuid references time_policy(id),
  state text not null check (state in ('provisional','final','invalidated')),
  totals jsonb not null,
  source_entry_ids uuid[] not null default '{}',
  calc_version text not null,
  blockers jsonb not null default '[]',
  finalized_by uuid references employee(id), finalized_at timestamptz,
  invalidated_reason text,
  created_at timestamptz not null default now(),
  unique (employee_id, month, revision)
);
create unique index month_reconciliation_one_final on month_reconciliation(employee_id, month) where state = 'final';

create table reconciliation_allocation (
  id uuid primary key default gen_random_uuid(),
  reconciliation_id uuid not null references month_reconciliation(id),
  employee_id uuid not null references employee(id),
  ot_request_id uuid not null references ot_request(id),
  time_entry_id uuid not null references time_entry(id),
  project_id uuid references project(id),
  span tstzrange not null check (not isempty(span)),
  minutes int not null check (minutes > 0),
  active boolean not null default true,
  -- The same minutes can never be allocated twice, even by concurrent approvals.
  exclude using gist (employee_id with =, span with &&) where (active)
);

create table reviewed_missing_day (
  employee_id uuid not null references employee(id), date date not null,
  reason text not null check (reason in ('no_work','leave','reviewed_missing')),
  note text, reviewed_by uuid not null references employee(id), reviewed_at timestamptz not null default now(),
  primary key (employee_id, date)
);

create table estimate (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  project_id uuid not null references project(id),
  visit_id uuid references visit(id),
  source text not null default 'internal',
  version int not null,
  currency text not null default 'INR',
  created_at timestamptz not null default now(),
  unique (business_id, version)
);
create table estimate_line (
  id uuid primary key default gen_random_uuid(),
  estimate_id uuid not null references estimate(id),
  category text not null,
  basis text not null check (basis in ('per_person_day','per_person_night','per_team_night','per_trip','per_unit','per_room_night','fixed')),
  factors jsonb not null,
  unit_rate_minor bigint not null check (unit_rate_minor >= 0),
  amount_minor bigint not null check (amount_minor >= 0),
  scope text
);

create table budget (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  approved_total_minor bigint not null check (approved_total_minor >= 0),
  currency text not null default 'INR',
  approved_by uuid not null references employee(id), approved_at timestamptz not null default now(),
  is_current boolean not null default true
);
create unique index budget_current on budget(project_id) where is_current;

create table expense (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  claimant_id uuid not null references employee(id),
  project_id uuid not null references project(id),
  visit_id uuid references visit(id),
  category text not null,
  vendor text,
  load_ref text,
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null default 'INR',
  incurred_on date not null,
  receipt_ref text,
  reverses_expense_id uuid references expense(id),
  is_credit boolean not null default false,
  state text not null default 'submitted' check (state in ('submitted','approved','rejected')),
  reviewed_by uuid references employee(id), reviewed_at timestamptz, review_note text,
  estimate_line_id uuid references estimate_line(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  check (not is_credit or reverses_expense_id is not null)
);

create table quality_case (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  order_id uuid references sales_order(id),
  component_id uuid references component(id),
  visit_id uuid references visit(id),
  kind text not null check (kind in ('complaint','rework')),
  category text not null,
  reported_on date not null,
  root_cause text,
  responsible_function text,
  corrective_action text,
  owner_id uuid references employee(id),
  status text not null default 'open' check (status in ('open','closed','reopened')),
  closed_on date, closure_evidence text,
  reopened_from uuid references quality_case(id),
  created_at timestamptz not null default now()
);

create table expense_allocation (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references expense(id),
  project_id uuid not null references project(id),
  visit_id uuid references visit(id),
  quality_case_id uuid references quality_case(id),
  order_id uuid references sales_order(id),
  amount_minor bigint not null check (amount_minor >= 0)
);

create table issue (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  raised_on date not null,
  project_id uuid not null references project(id),
  order_id uuid references sales_order(id),
  delay_event_id uuid references delay_event(id),
  quality_case_id uuid references quality_case(id),
  function text not null,
  category text not null,
  impact text,
  delay_days numeric(18,6),
  estimated_cost_minor bigint,
  description text not null,
  owner_id uuid references employee(id),
  escalation_owner_id uuid references employee(id),
  next_action text,
  due_date date,
  status text not null default 'open' check (status in ('open','in_progress','closed')),
  closed_on date, closure_evidence text,
  recurrence_of uuid references issue(id),
  version int not null default 1,
  created_at timestamptz not null default now(),
  check (status <> 'closed' or (closed_on is not null and closure_evidence is not null))
);

create table kpi_definition (
  id uuid primary key default gen_random_uuid(),
  code text not null, version int not null,
  name text not null, formula text not null, grain text, unit text not null,
  direction text not null check (direction in ('higher_better','lower_better')),
  window_text text, cohort text,
  status text not null default 'reference' check (status in ('reference','approved')),
  approved_by uuid references employee(id), approved_at timestamptz,
  unique (code, version)
);
create table kpi_target (
  id uuid primary key default gen_random_uuid(),
  kpi_code text not null,
  baseline_text text, target_text text,
  baseline_value numeric(18,6), target_value numeric(18,6),
  source text not null,
  status text not null default 'provisional' check (status in ('provisional','approved')),
  owner_text text,
  approved_by uuid references employee(id), approved_at timestamptz
);

create table savings_claim (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references project(id),
  load_ref text, scope text not null, period text not null,
  baseline_minor bigint, actual_minor bigint, proposed_saving_minor bigint,
  finance_verified boolean not null default false,
  verified_by uuid references employee(id), verified_at timestamptz, evidence text,
  check (not finance_verified or (verified_by is not null and baseline_minor is not null and actual_minor is not null))
);

create table source_import (
  id uuid primary key default gen_random_uuid(),
  source_system text not null, external_id text not null, revision text not null,
  object_type text not null, object_id uuid,
  applied_at timestamptz not null default now(), applied_by uuid references employee(id),
  unique (source_system, external_id, revision)
);

create table idempotency_key (
  key text primary key, operation text not null, result jsonb, created_at timestamptz not null default now()
);
