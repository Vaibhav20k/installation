-- 007: customer contacts, net/gross quantity snapshots, multi-driver effort, site restrictions, appliance
-- dependencies and explicit staff substitution (spec V3 board-meeting requirements 1-7, 17).

create table customer_contact (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customer(id),
  name text not null,
  relationship text not null,
  is_primary boolean not null default false,
  phone text,
  email text,
  source text not null default 'manual',
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);
-- One primary contact per account; a phone or name is never the account key.
create unique index customer_contact_primary on customer_contact(customer_id) where is_primary and active;

-- Net installed quantity and gross/material quantity are separate, sourced records; never derived from each other.
create table quantity_snapshot (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references component(id),
  basis text not null check (basis in ('net','gross')),
  quantity numeric(18,6) not null check (quantity >= 0),
  unit text not null,
  quantity_kind text not null,
  wastage_basis text,
  source text not null,
  source_revision text,
  is_current boolean not null default true,
  recorded_at timestamptz not null default now(), recorded_by uuid references employee(id)
);
create unique index quantity_snapshot_current on quantity_snapshot(component_id, basis) where is_current;

-- Separate effort drivers (linear length, cut-outs, joints, trims...) for disjoint activity scope.
create table effort_driver (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references component(id),
  driver text not null check (driver in ('area','linear','cutout','joint','trim','island','lighting','drawer','handling','other')),
  activity text not null,
  quantity numeric(18,6) not null check (quantity >= 0),
  unit text not null,
  quantity_kind text not null,
  note text,
  source text not null default 'site_review',
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);

create table site_restriction (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  allowed_weekdays int[] not null,
  start_time time not null,
  end_time time not null,
  restricted_activities text[] not null default '{}',
  valid_from date,
  valid_to date,
  note text,
  source text not null default 'site_review',
  active boolean not null default true,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (end_time > start_time)
);

create table appliance_dependency (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references project(id),
  order_item_id uuid references order_item(id),
  task_id uuid references installation_task(id),
  appliance text not null,
  state text not null default 'selected' check (state in ('selected','spec_final','on_site','inspected')),
  brand_technician text not null default 'not_needed' check (brand_technician in ('not_needed','needed','booked','unavailable')),
  install_scope text,
  depends_on text,
  exception_reason text,
  exception_by uuid references employee(id),
  version int not null default 1,
  updated_at timestamptz not null default now(), updated_by uuid references employee(id)
);

create table substitution (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  outgoing_employee_id uuid not null references employee(id),
  incoming_employee_id uuid not null references employee(id),
  effective_at timestamptz not null,
  reason text not null,
  outgoing_reservation_id uuid not null references reservation(id),
  incoming_reservation_id uuid not null references reservation(id),
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (outgoing_employee_id <> incoming_employee_id)
);
