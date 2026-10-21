-- 005: customer-facing installation schedules: a reusable step template laid out day by day on a visit,
-- skipping weekly offs and holidays from the work calendar. Each day is ticked off on site.

create table schedule_template (
  code text primary key,
  name text not null,
  -- [{"name": "...", "days": 1}, ...] in order; days are working days.
  steps jsonb not null,
  created_at timestamptz not null default now()
);

create table visit_schedule_day (
  id uuid primary key default gen_random_uuid(),
  visit_id uuid not null references visit(id),
  template_code text not null references schedule_template(code),
  day_date date not null,
  kind text not null check (kind in ('work','off')),
  step_no int check (step_no > 0),
  step_name text,
  off_reason text,
  status text not null default 'planned' check (status in ('planned','done','delayed')),
  note text,
  updated_at timestamptz, updated_by uuid references employee(id),
  unique (visit_id, day_date),
  check ((kind = 'work' and step_no is not null and step_name is not null) or (kind = 'off' and off_reason is not null and status = 'planned'))
);
create index visit_schedule_day_visit on visit_schedule_day(visit_id, day_date);

-- The kitchen schedule shared with customers (13 working days).
insert into schedule_template(code, name, steps) values ('kitchen_standard', 'Kitchen installation', '[
  {"name": "All base & tall cabinet material unpacking & assembly", "days": 1},
  {"name": "All base & tall cabinet installation & levelling", "days": 1},
  {"name": "Wall cabinet material unpacking & assembly", "days": 1},
  {"name": "All base cabinet shutter & hardware installation", "days": 1},
  {"name": "Countertop & backsplash", "days": 5},
  {"name": "Wall cabinet installation", "days": 1},
  {"name": "Light profile fixing, light connection & wall cabinet shutter installation", "days": 1},
  {"name": "Kitchen alignment & drawer mat installation", "days": 1},
  {"name": "Kitchen deep cleaning & handover", "days": 1}
]');
