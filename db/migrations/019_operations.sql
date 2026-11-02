-- Additive operations model. Legacy flow definitions and records are retained.
insert into flow_role(code,name,description,sort) values
 ('factory','Factory','Packaging and ready for dispatch',11),
 ('dispatch_department','Dispatch','Payment requests and shipments',12),
 ('finance','Finance','Dispatch payment decisions',13),
 ('installation_head','Installation Head','Read all installation sites and complaint journeys',14),
 ('founders_office','Founder''s Office','Tier 2 complaint approvals',15),
 ('owners','Owners','Tier 3 complaint approvals',16),
 ('qa','Quality Assurance','Final cause and preventive action before shipment',17);

create table designation(code text primary key, name text not null, active boolean not null default true);
insert into designation(code,name) select distinct job_role, initcap(replace(job_role,'_',' ')) from employee on conflict do nothing;
insert into designation(code,name) values ('electrician','Electrician'),('site_measurement','Site measurement person') on conflict do nothing;
insert into designation(code,name) select code,initcap(replace(code,'_',' ')) from unnest(array['project_manager','operator','site_supervisor','carpenter','helper','senior_technician','technician','junior_technician','assistant_technician','stone_technician','department_staff']) code on conflict do nothing;
alter table employee add column designation_code text references designation(code);
update employee set designation_code = job_role;
create function fill_employee_designation() returns trigger language plpgsql as $$
begin
 if new.designation_code is null and exists(select 1 from designation where code=new.job_role) then new.designation_code=new.job_role; end if;
 return new;
end $$;
create trigger employee_designation_default before insert on employee for each row execute function fill_employee_designation();

alter table dispatch add column sequence_no int;
with ranked as (select id,row_number() over(partition by order_id order by created_at,business_id)::int n from dispatch)
 update dispatch d set sequence_no=r.n from ranked r where r.id=d.id;
alter table dispatch add constraint dispatch_order_sequence unique(order_id,sequence_no);
alter table dispatch add column installation_manager_id uuid references employee(id);
alter table dispatch add column site_ready boolean not null default false;
alter table dispatch add column payment_state text not null default 'not_requested' check(payment_state in ('not_requested','requested','received','not_received'));
alter table dispatch add column payment_note text;
alter table dispatch add column payment_decided_by uuid references employee(id);
alter table dispatch add column received_at timestamptz;
alter table dispatch add column installed_at timestamptz;

alter table complaint add column approval_role text references flow_role(code);
alter table complaint add column approval_policy jsonb;
alter table complaint add column qa_root_cause text;
alter table complaint add column preventive_action text;
alter table complaint add column qa_by uuid references employee(id);
alter table complaint add column qa_at timestamptz;
alter table complaint add column suspected_cause text;
alter table complaint add column installation_visit_id uuid references visit(id);
alter table complaint add column installed_at timestamptz;
alter table complaint add column received_at timestamptz;
alter table issue add column complaint_id uuid references complaint(id);
alter table issue add column preventive_state text check(preventive_state in ('open','in_progress','done','verified'));
alter table issue add column preventive_steps jsonb not null default '[]';

alter table plan add column batch_id uuid;
alter table plan add column operations_state text check(operations_state in ('draft','pending_approval','active','completed','hours_confirmed'));
alter table plan add column operations_policy jsonb;
alter table plan add column budget_minutes int check(budget_minutes > 0);
alter table plan add column purpose text check(purpose in ('installation','complaint'));
alter table plan add column complaint_id uuid references complaint(id);
alter table plan add column confirmed_minutes int check(confirmed_minutes >= 0);
alter table plan add column confirmed_by uuid references employee(id);
alter table plan add column confirmed_at timestamptz;
create table plan_regularization(
 id uuid primary key default gen_random_uuid(), plan_id uuid not null references plan(id),
 employee_id uuid references employee(id), day date not null, reason text not null,
 state text not null default 'pending' check(state in ('pending','approved','rejected')),
 requested_by uuid not null references employee(id), decided_by uuid references employee(id),
 decision_note text, created_at timestamptz not null default now(), decided_at timestamptz
);
create index regularization_plan on plan_regularization(plan_id,day);
alter table site_presence add column check_in_location jsonb;
alter table site_presence add column check_out_location jsonb;
