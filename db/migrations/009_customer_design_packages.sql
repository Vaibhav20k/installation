-- 009: customer journey and communication log, design/measurement requests with revisions, and package
-- manifest, scans and receipt exceptions (spec V3 requirements 13-16; phases 10-11).

create table customer_journey (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references project(id),
  owner_id uuid references employee(id),
  stage text not null default 'order_confirmed' check (stage in ('order_confirmed','measurement','design_final','dispatch','site_ready','installation','handover','closed')),
  version int not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid references employee(id)
);

create table journey_obligation (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  stage text not null,
  description text not null,
  owner_id uuid references employee(id),
  due_date date,
  status text not null default 'open' check (status in ('open','done','not_applicable')),
  done_at timestamptz, done_by uuid references employee(id),
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);

-- A logged communication records what someone says happened. It is never proof the customer received it,
-- and the app sends nothing by itself.
create table communication_log (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  channel text not null check (channel in ('call','visit','whatsapp','email','in_person','other')),
  direction text not null check (direction in ('to_customer','from_customer','internal')),
  summary text not null,
  commitment text,
  next_action text,
  due_date date,
  acknowledgement text not null default 'not_requested' check (acknowledgement in ('not_requested','awaiting','acknowledged_by_customer')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);

create table design_request (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  order_item_id uuid references order_item(id),
  kind text not null check (kind in ('design','measurement')),
  origin text not null check (origin in ('customer','sales','site_team','designer')),
  brief text not null,
  appliance_brief text,
  requested_skills text,
  reason text not null,
  status text not null default 'draft' check (status in ('draft','submitted','approved','rejected')),
  decided_by uuid references employee(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);

create table design_revision (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references design_request(id),
  seq int not null,
  cause text not null check (cause in ('customer_change','sales_change','designer_correction','site_measurement')),
  reason text not null,
  needs_escalation boolean not null default false,
  approved_by uuid references employee(id), approved_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  unique (request_id, seq)
);

create table package (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  project_id uuid not null references project(id),
  order_id uuid not null references sales_order(id),
  load_ref text,
  description text not null,
  expected_contents text,
  weight_kg numeric(10,2),
  high_value boolean not null default false,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);

-- Scans are events; repeating the same scan (same client event id) is ignored, so counts never inflate.
create table scan_event (
  id uuid primary key default gen_random_uuid(),
  package_id uuid references package(id),
  scanned_code text not null,
  kind text not null check (kind in ('dispatch','receipt','damage')),
  client_event_id text not null unique,
  method text not null check (method in ('camera','manual')),
  note text,
  actor_id uuid references employee(id),
  scanned_at timestamptz not null
);
create index scan_event_package on scan_event(package_id, kind);

create table package_exception (
  id uuid primary key default gen_random_uuid(),
  business_id text not null unique,
  project_id uuid not null references project(id),
  package_id uuid references package(id),
  scanned_code text,
  kind text not null check (kind in ('receipt_unverified','shortage','damage','unknown_scan','contents_mismatch')),
  description text not null,
  responsible_function text,
  root_cause text,
  replacement_requested boolean not null default false,
  replacement_status text not null default 'none' check (replacement_status in ('none','requested','approved','rejected','delivered')),
  charge_type text check (charge_type in ('chargeable','free_of_charge','not_applicable')),
  status text not null default 'open' check (status in ('open','resolved')),
  issue_id uuid references issue(id),
  decided_by uuid references employee(id), decided_at timestamptz,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);
