-- 006: fixed 8-hour attendance sessions, durable due jobs and in-app notifications, leave requests,
-- and private image/video evidence linked to worker input. See docs/shift-contract.md.

create table shift_instance (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  work_date date not null,
  timezone text not null,
  -- Immutable anchor: the server-accepted first clock-in. Only an approved correction changes it (new revision).
  t0 timestamptz not null,
  warn_at timestamptz not null,
  ot_at timestamptz not null,
  revision int not null default 1,
  visit_id uuid references visit(id),
  missed_clock_out boolean not null default false,
  -- Approved correction of the end time (events stay append-only; reads cut the timeline here).
  clock_out_override timestamptz,
  ot_reason text check (ot_reason in ('catch_up','future_task','additional_work','external_delay','other')),
  ot_reason_note text,
  timesheet_generated_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null default now(),
  unique (employee_id, work_date),
  check (warn_at = t0 + interval '450 minutes' and ot_at = t0 + interval '480 minutes')
);
create index shift_instance_emp on shift_instance(employee_id, work_date desc);

-- Append-only punches, activity changes and the automatic overtime transition.
create table attendance_event (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shift_instance(id),
  kind text not null check (kind in ('clock_in','resume','clock_out','activity','overtime_started','correction','note')),
  activity text check (activity in ('working','break','idle','travel')),
  effective_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  actor_id uuid references employee(id),
  note text,
  shift_revision int not null,
  check (kind <> 'activity' or activity is not null)
);
create index attendance_event_shift on attendance_event(shift_id, effective_at);
create unique index attendance_event_ot_once on attendance_event(shift_id) where kind = 'overtime_started';
create trigger attendance_event_append_only before update or delete on attendance_event for each row execute function forbid_change();

create table attendance_correction (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shift_instance(id),
  employee_id uuid not null references employee(id),
  field text not null check (field in ('clock_in','clock_out')),
  requested_at timestamptz not null,
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected')),
  decided_by uuid references employee(id), decided_at timestamptz, decision_note text,
  created_at timestamptz not null default now()
);

create table due_job (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references shift_instance(id),
  shift_revision int not null,
  kind text not null check (kind in ('shift_warning','shift_overtime')),
  due_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','done','cancelled','superseded')),
  attempts int not null default 0,
  processed_at timestamptz,
  unique (shift_id, shift_revision, kind)
);
create index due_job_pending on due_job(due_at) where status = 'pending';

create table notification (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  shift_id uuid references shift_instance(id),
  kind text not null,
  title text not null,
  body text not null,
  -- Logical event ledger: one delivery per (shift, event) even across corrections and retries.
  dedupe_key text not null unique,
  effective_at timestamptz not null,
  created_at timestamptz not null default now(),
  overdue boolean not null default false,
  read_at timestamptz
);
create index notification_emp on notification(employee_id, created_at desc);

create table leave_request (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employee(id),
  kind text not null check (kind in ('leave','emergency_unavailability')),
  start_date date not null,
  end_date date not null,
  reason text not null,
  status text not null default 'requested' check (status in ('requested','approved','rejected','withdrawn')),
  decided_by uuid references employee(id), decided_at timestamptz, decision_note text,
  leave_record_id uuid references leave_record(id),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

-- Attendance-derived timesheet rows keep a link to their shift.
alter table time_entry add column shift_id uuid references shift_instance(id);

-- Private evidence. Bytes live in object storage (local adapter in development); rows hold metadata only.
create table evidence_asset (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references employee(id),
  storage_key text not null unique,
  original_name text not null,
  media_type text not null check (media_type in ('image','video')),
  mime text not null,
  byte_size bigint not null check (byte_size > 0),
  sha256 text,
  state text not null default 'uploading' check (state in ('uploading','validating','ready','failed')),
  failure text,
  captured_at timestamptz,
  received_at timestamptz,
  retention_policy text,
  legal_hold boolean not null default false,
  created_at timestamptz not null default now()
);

-- Parent types are an allowlist; authorization is checked per type in the service, not trusted from the string.
create table evidence_link (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references evidence_asset(id),
  parent_type text not null check (parent_type in ('progress_event','visit_task','attendance_event','shift_instance','attendance_correction',
    'time_entry','ot_request','expense','leave_request','delay_event','readiness_check','schedule_day','quality_case','issue',
    'additional_work','package_exception','design_request','communication_log','employee_skill','site_restriction','appliance_dependency')),
  parent_id uuid not null,
  parent_revision int,
  context text not null,
  caption text,
  status text not null default 'active' check (status in ('active','removed')),
  actor_id uuid not null references employee(id),
  created_at timestamptz not null default now(),
  removed_at timestamptz, removed_by uuid references employee(id),
  unique (asset_id, parent_type, parent_id)
);
create index evidence_link_parent on evidence_link(parent_type, parent_id) where status = 'active';

create table upload_session (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references employee(id),
  draft_key text not null,
  context text not null,
  asset_id uuid references evidence_asset(id),
  expected_mime text not null,
  expected_size bigint not null,
  idempotency_key text not null,
  expires_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (actor_id, idempotency_key)
);
