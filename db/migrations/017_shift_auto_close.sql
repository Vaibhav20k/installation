-- 017: an open shift never runs past 24 hours (owner's rule, 28 Oct 2026).
-- A clock-in still open 24 hours after its anchor t0 is closed automatically: it becomes a missed clock-out
-- (provisional, in the manager's queue) with no invented clock-out time. auto_closed_at is when the system did it.
alter table shift_instance add column auto_closed boolean not null default false;
alter table shift_instance add column auto_closed_at timestamptz;
alter table shift_instance add constraint shift_instance_auto_closed_at check (auto_closed = (auto_closed_at is not null));

-- Finds open shifts past the 24-hour limit without scanning closed history.
create index shift_instance_open_t0 on shift_instance(t0) where not missed_clock_out and clock_out_override is null;
