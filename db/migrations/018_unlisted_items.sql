-- Items reported at receipt that are not on the factory's list (owner request, 28 Oct 2026). Additive only.
-- The Installation Manager may find a missing or damaged item the factory never put on the BOM (or the BOM is
-- not there yet). Such an item is added to the order as an "unlisted" BOM line, so it gets a dispatch line on the
-- dispatch it was reported on and runs the same complaint flow (QC, costing, ..., replacement dispatch).

-- How urgent the complaint is for the site. Every existing complaint is 'normal'.
alter table complaint add column priority text not null default 'normal' check (priority in ('normal','high','urgent'));

-- unlisted: reported on site, not from the factory BOM. product_type: what the IM said it is (the owner's
-- product-type list, kept apart from dispatch_group, which is the factory's fixed shipping group).
alter table component add column unlisted boolean not null default false;
alter table component add column product_type text check (product_type is null or length(product_type) between 2 and 40);
alter table component add constraint component_unlisted_has_type check (not unlisted or product_type is not null);
