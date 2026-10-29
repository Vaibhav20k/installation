-- Dispatch-to-installation flow and the Missing & Damaged (MND) complaint loop (request of 27 Oct 2026).
-- Reuses sales_order (order), component (BOM line), employee (users), audit_event, notification and evidence.
-- Stages, fields and owners live in flow_config so the flow can be edited without code changes.

-- Department users of the hub (Factory, Accounts, QC ...) are not installers: a separate job role keeps them
-- off crew boards and team suggestions.
alter table employee drop constraint employee_job_role_check;
alter table employee add constraint employee_job_role_check check (job_role in ('project_manager','operator','site_supervisor','carpenter','helper',
  'senior_technician','technician','junior_technician','assistant_technician','stone_technician','department_staff'));

-- Which dispatch type a BOM line ships with. Set by the factory BOM; null lines can still be picked by hand.
alter table component add column dispatch_group text check (dispatch_group in ('carcass','shutters','countertop','backsplash','other'));
update component set dispatch_group = case quantity_kind when 'carcass_count' then 'carcass' when 'shutter_count' then 'shutters' when 'counter_surface_area' then 'countertop' else null end;

create table flow_role (code text primary key, name text not null, description text not null, sort int not null);
insert into flow_role(code, name, description, sort) values
  ('factory_dispatch', 'Factory / Dispatch', 'Marks orders ready for dispatch and records the vehicle', 1),
  ('installation_manager', 'Installation Manager', 'Site readiness, receipt with missing and damaged items, installation', 2),
  ('accounts', 'Accounts', 'Tax invoice and e-way bill', 3),
  ('qc', 'QC', 'Reviews complaints and runs incoming quality checks', 4),
  ('planning', 'Planning', 'Costs and plans replacements', 5),
  ('management', 'Management', 'Approves or rejects complaint cost', 6),
  ('store', 'Store', 'Checks stock and issues material', 7),
  ('purchase', 'Purchase', 'Orders material', 8),
  ('production', 'Production', 'Makes replacement items', 9),
  ('packaging', 'Packaging', 'Packs replacement items', 10);

create table flow_role_member (
  role_code text not null references flow_role(code),
  employee_id uuid not null references employee(id),
  added_by uuid references employee(id),
  added_at timestamptz not null default now(),
  primary key (role_code, employee_id)
);
create index flow_role_member_emp on flow_role_member(employee_id);

-- Versioned flow definitions; exactly one active version per flow. Each record keeps the version it started on.
create table flow_config (
  id uuid primary key default gen_random_uuid(),
  flow text not null check (flow in ('dispatch','complaint')),
  version int not null,
  definition jsonb not null,
  active boolean not null default false,
  note text,
  created_by uuid references employee(id),
  created_at timestamptz not null default now(),
  unique (flow, version)
);
create unique index flow_config_one_active on flow_config(flow) where active;

create sequence dispatch_number;
create sequence complaint_number;

create table dispatch (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  order_id uuid not null,
  project_id uuid not null,
  types text[] not null check (cardinality(types) > 0),
  factory text not null,
  replacement_for uuid,
  stage text not null,
  stage_entered_at timestamptz not null,
  config_version int not null,
  status text not null default 'open' check (status in ('open','completed','cancelled')),
  hold_reason text,
  hold_until date,
  partial boolean not null default false,
  version int not null default 1,
  created_by uuid references employee(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (order_id, project_id) references sales_order(id, project_id),
  check ((hold_reason is null) = (hold_until is null))
);
create index dispatch_order on dispatch(order_id);
create index dispatch_open_stage on dispatch(stage) where status = 'open';

-- A dispatch carries only its own BOM lines.
create table dispatch_item (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references dispatch(id),
  component_id uuid not null references component(id),
  quantity numeric(18,6) not null check (quantity > 0),
  received_ok boolean,
  unique (dispatch_id, component_id)
);

-- One complaint per affected BOM line, grouped under the dispatch it arrived on.
create table complaint (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  dispatch_id uuid not null references dispatch(id),
  dispatch_item_id uuid not null references dispatch_item(id),
  order_id uuid not null references sales_order(id),
  project_id uuid not null references project(id),
  component_id uuid not null references component(id),
  kind text not null check (kind in ('missing','damaged')),
  quantity numeric(18,6) not null check (quantity > 0),
  reason text not null,
  stage text not null,
  stage_entered_at timestamptz not null,
  config_version int not null,
  status text not null default 'open' check (status in ('open','closed')),
  outcome text check (outcome in ('replaced','superseded')),
  cost numeric(14,2) check (cost >= 0),
  costed_by uuid references employee(id),
  cost_approved_by uuid references employee(id),
  item_source text,
  replacement_dispatch_id uuid references dispatch(id),
  superseded_by uuid references complaint(id),
  version int not null default 1,
  created_by uuid references employee(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (dispatch_item_id),
  check ((status = 'closed') = (outcome is not null))
);
create index complaint_open_stage on complaint(stage) where status = 'open';
alter table dispatch add constraint dispatch_replacement_for_fk foreign key (replacement_for) references complaint(id);

-- Every stage change, hold, reminder and close: who, what, when; attachments link to the row.
create table stage_history (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('dispatch','complaint')),
  subject_id uuid not null,
  from_stage text,
  to_stage text not null,
  kind text not null check (kind in ('create','forward','back','hold','close')),
  data jsonb not null default '{}',
  reason text,
  actor_id uuid references employee(id),
  at timestamptz not null default now()
);
create index stage_history_subject on stage_history(subject_type, subject_id, at);
create trigger stage_history_append_only before update or delete on stage_history for each row execute function forbid_change();

-- Reminders (site "not ready" expected date). One row per reminder, so a retry never sends twice.
create table flow_reminder (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('dispatch','complaint')),
  subject_id uuid not null,
  kind text not null,
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  sent_at timestamptz,
  unique (subject_type, subject_id, kind, due_at)
);
create index flow_reminder_pending on flow_reminder(due_at) where status = 'pending';

-- In-app notifications open the record they are about.
alter table notification add column href text;

-- Tax invoices and e-way bills are documents (PDF), and stage attachments link to their history row.
alter table evidence_asset drop constraint evidence_asset_media_type_check;
alter table evidence_asset add constraint evidence_asset_media_type_check check (media_type in ('image','video','document'));
alter table evidence_link drop constraint evidence_link_parent_type_check;
alter table evidence_link add constraint evidence_link_parent_type_check check (parent_type in ('progress_event','visit_task','attendance_event','shift_instance','attendance_correction',
  'time_entry','ot_request','expense','leave_request','delay_event','readiness_check','schedule_day','quality_case','issue','acceptance',
  'additional_work','package_exception','design_request','communication_log','employee_skill','site_restriction','appliance_dependency',
  'quantity_snapshot','substitution','scan_event','design_revision','employee_skill_change','employee_portrait','stage_history'));
