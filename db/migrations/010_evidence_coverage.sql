-- Optional photos/videos on the remaining worker inputs (checklist of 23 Oct 2026, phase 7):
-- measurements, substitutions, package scans and design revisions join the existing parent types.
alter table evidence_link drop constraint evidence_link_parent_type_check;
alter table evidence_link add constraint evidence_link_parent_type_check check (parent_type in ('progress_event','visit_task','attendance_event','shift_instance','attendance_correction',
  'time_entry','ot_request','expense','leave_request','delay_event','readiness_check','schedule_day','quality_case','issue','acceptance',
  'additional_work','package_exception','design_request','communication_log','employee_skill','site_restriction','appliance_dependency',
  'quantity_snapshot','substitution','scan_event','design_revision'));
