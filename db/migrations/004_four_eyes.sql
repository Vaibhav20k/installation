-- 004: who raised an overtime request (four-eyes review) and per-user idempotency tokens.
alter table ot_request add column created_by uuid references employee(id);
alter table idempotency_key add column actor_id uuid references employee(id);
