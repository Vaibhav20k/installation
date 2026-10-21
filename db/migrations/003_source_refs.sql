-- 003: stable source references for imported order items and components (idempotent source mapping).
alter table order_item add column source_ref text;
alter table component add column source_ref text;
create unique index order_item_source_ref on order_item(order_id, source_ref) where source_ref is not null;
create unique index component_source_ref on component(order_item_id, source_ref) where source_ref is not null;
