-- Site location for the installations map (request of 27 Oct 2026). Set by a manager (pin on the map, or pasted
-- coordinates / map link); never guessed from the address. Null means "not on the map yet".
alter table project add column latitude numeric(9,6) check (latitude between -90 and 90);
alter table project add column longitude numeric(9,6) check (longitude between -180 and 180);
alter table project add column location_set_at timestamptz;
alter table project add column location_set_by uuid references employee(id);
alter table project add constraint project_location_pair check ((latitude is null) = (longitude is null));

-- Demo projects only: approximate centre of each fictional demo address's locality, so the demo map is not empty.
update project set latitude = 28.435600, longitude = 77.105700 where is_demo and business_id = 'PRJ-001' and site_address like '%(demo address)%';
update project set latitude = 26.911800, longitude = 75.740000 where is_demo and business_id = 'PRJ-002' and site_address like '%(demo address)%';
update project set latitude = 12.912100, longitude = 77.644600 where is_demo and business_id = 'PRJ-003' and site_address like '%(demo address)%';
update project set latitude = 28.524000, longitude = 77.354000 where is_demo and business_id = 'PRJ-004' and site_address like '%(demo address)%';
