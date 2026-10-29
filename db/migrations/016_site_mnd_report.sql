-- Installer reports of missing or damaged items found on site after receipt (request of 28 Oct 2026).
-- A report waits for the site's Installation Manager, who confirms it into a complaint or rejects it with a reason.
create table mnd_report (
  id uuid primary key default gen_random_uuid(),
  dispatch_id uuid not null references dispatch(id),
  dispatch_item_id uuid not null references dispatch_item(id),
  project_id uuid not null references project(id),
  kind text not null check (kind in ('missing','damaged')),
  quantity numeric(18,6) not null check (quantity > 0),
  reason text not null check (length(reason) between 3 and 500),
  status text not null default 'pending' check (status in ('pending','confirmed','rejected')),
  complaint_id uuid references complaint(id),
  decided_by uuid references employee(id),
  decided_at timestamptz,
  decision_reason text,
  reported_by uuid not null references employee(id),
  reported_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (status <> 'confirmed' or complaint_id is not null),
  check (status <> 'rejected' or length(coalesce(decision_reason, '')) >= 3)
);
-- At most one waiting report per BOM line of a dispatch, so the IM never sees duplicates.
create unique index mnd_report_one_pending on mnd_report(dispatch_item_id) where status = 'pending';
create index mnd_report_dispatch on mnd_report(dispatch_id, status);

-- A line may get a new complaint once its earlier one is closed (damage found later on a replaced item);
-- never two open at once.
alter table complaint drop constraint complaint_dispatch_item_id_key;
create unique index complaint_one_open_per_line on complaint(dispatch_item_id) where status = 'open';

alter table evidence_link drop constraint evidence_link_parent_type_check;
alter table evidence_link add constraint evidence_link_parent_type_check check (parent_type in ('progress_event','visit_task','attendance_event','shift_instance','attendance_correction',
  'time_entry','ot_request','expense','leave_request','delay_event','readiness_check','schedule_day','quality_case','issue','acceptance',
  'additional_work','package_exception','design_request','communication_log','employee_skill','site_restriction','appliance_dependency',
  'quantity_snapshot','substitution','scan_event','design_revision','employee_skill_change','employee_portrait','stage_history','mnd_report'));
