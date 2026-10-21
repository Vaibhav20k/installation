-- 001_core: master data, scope, planning, visits, reservations, travel, clearances, execution.
-- Integrity rules live here so they hold under concurrent requests, not only in the browser.
create extension if not exists btree_gist;

create table app_setting (key text primary key, value jsonb not null, updated_at timestamptz not null default now());

create table employee (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  name text not null,
  job_role text not null check (job_role in ('project_manager','operator','site_supervisor','carpenter','helper','senior_technician','technician','junior_technician','assistant_technician','stone_technician')),
  permission_role text not null check (permission_role in ('employee','supervisor','manager','admin')),
  capabilities text[] not null default '{}',
  manager_id uuid references employee(id),
  base_city text not null,
  calendar_id uuid,
  phone text,
  active boolean not null default true,
  is_demo boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references employee(id), updated_by uuid references employee(id)
);

create table audit_event (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor_id uuid references employee(id),
  action text not null,
  object_type text not null,
  object_id text not null,
  before jsonb, after jsonb,
  reason text,
  correlation_id text not null
);
create index audit_event_object on audit_event(object_type, object_id);
create function forbid_change() returns trigger language plpgsql as $$
begin raise exception 'append-only table % cannot be changed', tg_table_name using errcode = 'P0001'; end $$;
create trigger audit_event_append_only before update or delete on audit_event for each row execute function forbid_change();

create table customer (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  name text not null,
  source_system text, source_ref text,
  lead_ref text, lead_source text, lead_created_at timestamptz, converted_at timestamptz,
  is_demo boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references employee(id), updated_by uuid references employee(id),
  unique (source_system, source_ref)
);

create table project (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  customer_id uuid not null references customer(id),
  name text not null,
  site_address text not null,
  city text not null,
  timezone text not null default 'Asia/Kolkata',
  manager_id uuid references employee(id),
  kitchen_floor_area numeric(18,6) check (kitchen_floor_area >= 0),
  kitchen_floor_area_unit text,
  status text not null default 'active' check (status in ('active','on_hold','closed','cancelled')),
  is_demo boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references employee(id), updated_by uuid references employee(id)
);

create table sales_order (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  external_ref text,
  source_system text,
  status text not null default 'open' check (status in ('open','dispatched','partly_dispatched','installed','closed','cancelled')),
  promised_completion date,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (source_system, external_ref)
);

create table order_item (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  order_id uuid not null references sales_order(id),
  product_type text not null,
  name text not null,
  source_version text,
  created_at timestamptz not null default now()
);

create table component (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  order_item_id uuid not null references order_item(id),
  name text not null,
  quantity numeric(18,6) not null check (quantity >= 0),
  unit text not null,
  quantity_kind text not null,
  drawing_version text,
  dispatched_quantity numeric(18,6) not null default 0 check (dispatched_quantity >= 0),
  available_quantity numeric(18,6) not null default 0 check (available_quantity >= 0),
  created_at timestamptz not null default now()
);

create table installation_task (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  component_id uuid not null references component(id),
  activity text not null check (activity in ('unpack','assemble','install','finish','other')),
  step_order int not null default 1,
  required_quantity numeric(18,6) not null check (required_quantity >= 0),
  unit text not null,
  quantity_kind text not null,
  created_at timestamptz not null default now()
);

create table task_dependency (
  task_id uuid not null references installation_task(id),
  predecessor_id uuid not null references installation_task(id),
  primary key (task_id, predecessor_id),
  check (task_id <> predecessor_id)
);

create table skill (id uuid primary key default gen_random_uuid(), code text not null unique, name text not null);

create table employee_skill (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  skill_id uuid not null references skill(id),
  level smallint not null check (level between 1 and 3),
  verified boolean not null default false,
  verified_by uuid references employee(id),
  verified_at timestamptz,
  valid_from date, valid_to date,
  check (valid_to is null or valid_from is null or valid_to >= valid_from),
  check (not verified or (verified_by is not null and verified_at is not null)),
  created_at timestamptz not null default now()
);

create table team (id uuid primary key default gen_random_uuid(), business_id text not null unique, name text not null, created_at timestamptz not null default now());
create table team_membership (
  team_id uuid not null references team(id), employee_id uuid not null references employee(id),
  valid_from date not null, valid_to date,
  primary key (team_id, employee_id, valid_from)
);

create table work_calendar (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null,
  -- {"1": {"shifts": [{"start":"10:00","end":"19:00"}], "netMinutes": 480}, ...} keyed by weekday 0..6
  week_pattern jsonb not null,
  is_illustrative boolean not null default true,
  version int not null default 1,
  created_at timestamptz not null default now()
);
alter table employee add constraint employee_calendar_fk foreign key (calendar_id) references work_calendar(id);
create table holiday (calendar_id uuid not null references work_calendar(id), date date not null, name text not null, primary key (calendar_id, date));

create table leave_record (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  span tstzrange not null check (not isempty(span)),
  kind text not null,
  status text not null default 'approved' check (status in ('requested','approved','cancelled')),
  created_at timestamptz not null default now()
);
create index leave_record_emp on leave_record using gist (employee_id, span);

create table productivity_rate (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  version int not null,
  activity text not null,
  quantity_kind text not null,
  unit text not null,
  basis text not null check (basis in ('employee_day','team_day','employee_hour')),
  value numeric(18,6) not null check (value > 0),
  crew_size int check (crew_size > 0),
  net_day_minutes int check (net_day_minutes > 0),
  required_roles text[] not null default '{}',
  status text not null check (status in ('illustrative','draft','approved')),
  approved_by uuid references employee(id), approved_at timestamptz,
  effective_from date not null, effective_to date,
  check (status <> 'approved' or (approved_by is not null and approved_at is not null)),
  check (basis = 'employee_hour' or net_day_minutes is not null),
  unique (business_id, version)
);

create table role_template (
  id uuid primary key default gen_random_uuid(),
  activity text not null, quantity_kind text not null, unit text not null,
  role text not null,
  hours_per_unit numeric(18,6) check (hours_per_unit >= 0),
  fixed_hours numeric(18,6) check (fixed_hours >= 0),
  status text not null check (status in ('illustrative','draft','approved')),
  version int not null default 1
);

create table plan (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  baseline_revision_id uuid,
  current_revision_id uuid,
  status text not null default 'active' check (status in ('active','rejected','cancelled','completed')),
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);

create table plan_revision (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plan(id),
  revision_no int not null,
  approval_state text not null default 'draft' check (approval_state in ('draft','submitted','approved','returned')),
  -- Snapshot of scope, staffing, dates, rates, calendars, requirements and estimates at this revision.
  snapshot jsonb not null,
  change_reason text,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  submitted_at timestamptz, submitted_by uuid references employee(id),
  decided_at timestamptz, decided_by uuid references employee(id), decision_note text,
  unique (plan_id, revision_no)
);
alter table plan add constraint plan_baseline_fk foreign key (baseline_revision_id) references plan_revision(id);
alter table plan add constraint plan_current_fk foreign key (current_revision_id) references plan_revision(id);
create function protect_decided_revision() returns trigger language plpgsql as $$
begin
  if old.approval_state in ('approved','returned') then
    raise exception 'plan revision % is %; create a new revision instead', old.id, old.approval_state using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger plan_revision_immutable before update or delete on plan_revision for each row execute function protect_decided_revision();

create table visit (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  plan_id uuid not null references plan(id),
  sequence int not null,
  visit_type text not null check (visit_type in ('fresh','follow_up','final')),
  exec_status text not null default 'unscheduled' check (exec_status in ('unscheduled','scheduled','in_progress','completed','closed','on_hold','cancelled')),
  requested_start date,
  requested_start_meaning text check (requested_start_meaning in ('travel_start','installation_start')),
  planned_start date, planned_end date,
  departure_at timestamptz, return_at timestamptz,
  repeat_reason text check (repeat_reason in ('planned_phasing','material_shortage','customer_change','failed_readiness','rework','other_documented')),
  repeat_reason_note text,
  team_size int not null default 3 check (team_size between 1 and 12),
  continuity text not null default 'preferred' check (continuity in ('none','preferred','mandatory')),
  preferred_team_id uuid references team(id),
  outstation boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (id, project_id),
  unique (plan_id, sequence),
  check (planned_end is null or planned_start is null or planned_end >= planned_start),
  check (visit_type = 'fresh' or repeat_reason is not null)
);

-- Composite keys make a cross-project order link impossible at the database level.
create table visit_order (
  visit_id uuid not null, order_id uuid not null, project_id uuid not null,
  primary key (visit_id, order_id),
  foreign key (visit_id, project_id) references visit(id, project_id),
  foreign key (order_id, project_id) references sales_order(id, project_id)
);

create table visit_task (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  task_id uuid not null references installation_task(id),
  scoped_quantity numeric(18,6) not null check (scoped_quantity > 0),
  kind text not null default 'original' check (kind in ('original','rework','additional')),
  status text not null default 'active' check (status in ('active','transferred','cancelled')),
  status_reason text,
  created_at timestamptz not null default now(),
  unique (visit_id, task_id, kind)
);

create table skill_requirement (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  skill_id uuid not null references skill(id),
  min_level smallint not null check (min_level between 1 and 3),
  headcount int not null default 1 check (headcount > 0),
  mode text not null default 'collective' check (mode in ('collective','per_person')),
  applies_to_roles text[] not null default '{}',
  concurrency_group text default 'site',
  source_complexity_label text
);

create table daily_target (
  id uuid primary key default gen_random_uuid(),
  visit_task_id uuid not null references visit_task(id),
  plan_date date not null,
  step text not null,
  target_quantity numeric(18,6) not null check (target_quantity >= 0),
  frozen_at timestamptz, frozen_by uuid references employee(id),
  supersedes_id uuid references daily_target(id),
  is_current boolean not null default true,
  change_reason text,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);
create unique index daily_target_current on daily_target(visit_task_id, plan_date, step) where is_current;

create table reservation (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  employee_id uuid not null references employee(id),
  role text not null,
  span tstzrange not null check (not isempty(span)),
  state text not null check (state in ('proposed','held','confirmed','released','cancelled')),
  hold_expires_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (state <> 'held' or hold_expires_at is not null),
  -- No double booking of blocking commitments, under any concurrency.
  exclude using gist (employee_id with =, span with &&) where (state in ('held','confirmed'))
);
create index reservation_hold_expiry on reservation(hold_expires_at) where state = 'held';
create index reservation_visit on reservation(visit_id);

create table reservation_activity (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references reservation(id),
  kind text not null check (kind in ('work','travel')),
  span tstzrange not null check (not isempty(span))
);

create table travel_leg (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  kind text not null check (kind in ('outbound','inter_site','return')),
  origin text not null, destination text not null,
  planned_depart timestamptz not null, planned_arrive timestamptz not null,
  actual_depart timestamptz, actual_arrive timestamptz,
  certainty text not null default 'tentative' check (certainty in ('tentative','confirmed')),
  check (planned_arrive > planned_depart)
);
create table travel_participant (
  leg_id uuid not null references travel_leg(id), employee_id uuid not null references employee(id), visit_id uuid not null references visit(id),
  primary key (leg_id, employee_id, visit_id)
);

create table clearance (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  gate text not null check (gate in ('accounts','site','installation')),
  status text not null default 'pending' check (status in ('pending','cleared','rejected','expired','revoked')),
  approver_id uuid references employee(id), decided_at timestamptz,
  expected_date date, valid_until date,
  evidence text,
  version int not null default 1,
  unique (visit_id, gate)
);
create table clearance_exception (
  id uuid primary key default gen_random_uuid(),
  clearance_id uuid not null references clearance(id),
  reason text not null, conditions text not null,
  approved_by uuid not null references employee(id), approved_at timestamptz not null default now(),
  valid_until date not null,
  revoked boolean not null default false
);

create table readiness_check (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  component_id uuid references component(id),
  check_code text not null check (check_code in ('site_access','materials','drawings','tools','customer_confirmation','skill_coverage')),
  required boolean not null default true,
  result text not null default 'pending' check (result in ('pending','pass','fail','na')),
  na_reason text,
  verifier_id uuid references employee(id), checked_at timestamptz, evidence text, valid_until date,
  check (result <> 'na' or na_reason is not null)
);
create unique index readiness_check_unique on readiness_check(visit_id, check_code, coalesce(component_id, '00000000-0000-0000-0000-000000000000'));

create table delay_event (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  task_id uuid references installation_task(id),
  span tstzrange not null check (not isempty(span)),
  cause text not null check (cause in ('materials','site_access','equipment','customer','other_function','weather','employee','unknown')),
  impact text,
  responsible_function text check (responsible_function in ('Factory','Purchase','Logistics','Services','Site','Installation','Customer','Unknown')),
  employee_fault text not null default 'not_assessed' check (employee_fault in ('not_assessed','no','yes')),
  state text not null default 'reported' check (state in ('reported','verified')),
  evidence text,
  reported_by uuid references employee(id), reported_at timestamptz not null default now()
);

create table progress_event (
  id uuid primary key default gen_random_uuid(),
  visit_task_id uuid not null references visit_task(id),
  step text not null,
  quantity_delta numeric(18,6) not null check (quantity_delta <> 0),
  reverses_event_id uuid references progress_event(id),
  accepted boolean not null default false,
  accepted_by uuid references employee(id),
  actor_id uuid references employee(id), at timestamptz not null default now(),
  evidence text,
  check (quantity_delta > 0 or reverses_event_id is not null)
);
create trigger progress_event_append_only before delete on progress_event for each row execute function forbid_change();

create table acceptance (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  order_item_id uuid references order_item(id),
  signed_off boolean not null,
  signed_by_name text,
  accepted_on date,
  evidence text,
  recorded_by uuid references employee(id), recorded_at timestamptz not null default now()
);
