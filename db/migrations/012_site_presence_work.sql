-- Site presence and dated site work (recording "gursaharan sir notes installation", 27 Oct 2026).
-- Site presence is a record of being at one site. It is linked to, never a replacement for, the daily
-- 8-hour attendance session: nothing here starts, resets or ends a shift.

create table site_presence (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  visit_id uuid not null references visit(id),
  project_id uuid not null references project(id),
  check_in_at timestamptz not null,
  -- Null while open. A missed check-out stays open until a supervisor corrects it; nothing invents an end.
  check_out_at timestamptz,
  -- The daily attendance session open at check-in, if any (link only).
  shift_id uuid references shift_instance(id),
  source text not null default 'live' check (source in ('live','correction')),
  -- Left open past its site-local date: kept open and uncounted until a supervisor enters the real time.
  missed_checkout boolean not null default false,
  voided boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  check (check_out_at is null or check_out_at > check_in_at),
  check (not missed_checkout or check_out_at is null),
  -- One open session per person and no overlapping sessions at all, under any concurrency.
  exclude using gist (employee_id with =, tstzrange(check_in_at, coalesce(check_out_at, 'infinity'::timestamptz), '[)') with &&) where (not voided and not missed_checkout)
);
create unique index site_presence_one_open on site_presence(employee_id) where check_out_at is null and not voided and not missed_checkout;
create index site_presence_visit on site_presence(visit_id, check_in_at);
create index site_presence_emp on site_presence(employee_id, check_in_at desc);

-- Corrections of a site session: who changed what, when and why. Append-only.
create table site_presence_change (
  id uuid primary key default gen_random_uuid(),
  presence_id uuid not null references site_presence(id),
  change text not null check (change in ('check_in','check_out','corrected','voided','added','missed_checkout')),
  before jsonb, after jsonb,
  reason text,
  actor_id uuid references employee(id),
  at timestamptz not null default now()
);
create index site_presence_change_presence on site_presence_change(presence_id, at);
create trigger site_presence_change_append_only before update or delete on site_presence_change for each row execute function forbid_change();

-- Manager's breakdown of a visit's work into dated tasks.
create table site_work_task (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  title text not null,
  description text,
  start_date date not null,
  due_date date not null,
  status text not null default 'open' check (status in ('open','cancelled')),
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid references employee(id),
  updated_at timestamptz, updated_by uuid references employee(id),
  check (due_date >= start_date)
);
create index site_work_task_visit on site_work_task(visit_id, start_date);

create table site_work_assignee (
  task_id uuid not null references site_work_task(id),
  employee_id uuid not null references employee(id),
  primary key (task_id, employee_id)
);
create index site_work_assignee_emp on site_work_assignee(employee_id);

-- Dated checklist items. Items are shared by the task's team: one tick counts once, whoever makes it.
create table site_work_item (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references site_work_task(id),
  item_date date not null,
  -- The date the plan first gave it; a reschedule keeps this so a missed day stays visible.
  original_date date not null,
  text text not null,
  -- Worker-reported only. Site acceptance stays with the visit's existing acceptance step.
  reported_done_at timestamptz, reported_done_by uuid references employee(id),
  cancelled boolean not null default false,
  version int not null default 1,
  created_at timestamptz not null default now(), created_by uuid references employee(id)
);
create index site_work_item_task on site_work_item(task_id, item_date);
create index site_work_item_date on site_work_item(item_date) where not cancelled;

create table site_work_item_event (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references site_work_item(id),
  kind text not null check (kind in ('reported_done','reopened','rescheduled','cancelled')),
  before jsonb, after jsonb,
  reason text,
  actor_id uuid references employee(id),
  at timestamptz not null default now()
);
create index site_work_item_event_item on site_work_item_event(item_id, at);
create trigger site_work_item_event_append_only before update or delete on site_work_item_event for each row execute function forbid_change();
