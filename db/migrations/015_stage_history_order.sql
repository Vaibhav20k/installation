-- Stage history in the order it was written, even when two steps share a timestamp (found by the flow tests).
alter table stage_history add column seq bigserial;
create index stage_history_subject_seq on stage_history(subject_type, subject_id, seq);
