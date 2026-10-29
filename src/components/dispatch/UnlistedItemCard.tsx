"use client";
/**
 * One item the Installation Manager reports that is not on the factory's list: what it is, how many, missing or
 * damaged, how urgent, its product type, why, and a photo. Each field says what is wrong right next to it once
 * touched; the server checks everything again.
 */
import { useState } from "react";
import { Trash } from "@phosphor-icons/react";
import { PRIORITIES, PRODUCT_TYPES, UNITS, UNLISTED_LIMITS as L, type Priority, type ProductType, type UnitCode } from "@/domain/unlisted-items";
import { FilesField, type FileState } from "./StageForms";

export interface UnlistedDraft {
  key: string; name: string; quantity: string; unit: UnitCode; kind: "" | "missing" | "damaged"; priority: Priority; productType: "" | ProductType; reason: string; photos: FileState | null;
}

export const newUnlisted = (): UnlistedDraft => ({ key: crypto.randomUUID(), name: "", quantity: "1", unit: "pcs", kind: "", priority: "normal", productType: "", reason: "", photos: null });

const QTY = /^\d+(\.\d{1,6})?$/;

/** Field-by-field problems, in plain words. Empty when the item is ready to send. */
export function unlistedErrors(u: UnlistedDraft): Partial<Record<"name" | "quantity" | "kind" | "productType" | "reason" | "photos", string>> {
  const e: ReturnType<typeof unlistedErrors> = {};
  const name = u.name.trim();
  if (name.length < L.nameMin) e.name = "Write what the item is.";
  else if (name.length > L.nameMax) e.name = `Keep it under ${L.nameMax} characters.`;
  if (!QTY.test(u.quantity) || Number(u.quantity) <= 0) e.quantity = "Enter how many, above zero.";
  else if (Number(u.quantity) > L.maxQuantity) e.quantity = `At most ${L.maxQuantity}.`;
  if (!u.kind) e.kind = "Choose missing or damaged.";
  if (!u.productType) e.productType = "Choose the product type.";
  if (u.reason.trim().length < L.reasonMin) e.reason = "Add a few words on what happened.";
  if (!u.photos?.ready || u.photos.pending > 0) e.photos = u.photos?.pending ? "Wait for the photo to finish uploading." : "Add at least one photo.";
  return e;
}

/** Normal / High / Urgent as three pills. Used on factory-list lines too. */
export function PriorityChoice({ name, value, onChange }: { name: string; value: Priority; onChange: (p: Priority) => void }) {
  return (
    <fieldset className="flow-choice">
      <legend>How urgent?</legend>
      <div className="priority-row">
        {PRIORITIES.map((p) => (
          <label key={p.code} data-on={value === p.code || undefined} data-priority={p.code}>
            <input type="radio" name={name} value={p.code} checked={value === p.code} onChange={() => onChange(p.code)} /> {p.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function UnlistedItemCard({ index, item, onPatch, onPhotos, onRemove }: {
  index: number; item: UnlistedDraft; onPatch: (p: Partial<UnlistedDraft>) => void; onPhotos: (s: FileState) => void; onRemove: () => void;
}) {
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const err = unlistedErrors(item);
  const id = `u-${item.key}`;
  const touch = (f: string) => () => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));
  const show = (f: keyof typeof err) => (touched[f] && err[f] ? <p id={`${id}-${f}-e`} className="field-error">{err[f]}</p> : null);
  const described = (f: keyof typeof err) => (touched[f] && err[f] ? `${id}-${f}-e` : undefined);
  return (
    <li className="unlisted-card">
      <div className="unlisted-head">
        <strong>Item {index + 1}{item.name.trim() ? `: ${item.name.trim()}` : ""}</strong>
        <button type="button" className="button unlisted-remove" onClick={onRemove}><Trash size={16} aria-hidden /> Remove</button>
      </div>
      <div className="field">
        <label htmlFor={`${id}-name`}>Product name</label>
        <input id={`${id}-name`} value={item.name} maxLength={L.nameMax} autoComplete="off" placeholder="e.g. Soft-close hinge, corner unit shutter"
          aria-invalid={!!described("name")} aria-describedby={described("name")} onBlur={touch("name")} onChange={(e) => onPatch({ name: e.target.value })} />
        {show("name")}
      </div>
      <fieldset className="flow-choice">
        <legend>What is wrong?</legend>
        <div className="flow-choice-row">
          {(["missing", "damaged"] as const).map((k) => (
            <label key={k} data-on={item.kind === k || undefined}>
              <input type="radio" name={`${id}-kind`} value={k} checked={item.kind === k} onChange={() => { onPatch({ kind: k }); touch("kind")(); }} /> {k === "missing" ? "Missing" : "Damaged"}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="unlisted-qty">
        <div className="field">
          <label htmlFor={`${id}-qty`}>How many</label>
          <input id={`${id}-qty`} inputMode="decimal" value={item.quantity} aria-invalid={!!described("quantity")} aria-describedby={described("quantity")}
            onBlur={touch("quantity")} onChange={(e) => onPatch({ quantity: e.target.value.trim() })} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-unit`}>Unit</label>
          <select id={`${id}-unit`} value={item.unit} onChange={(e) => onPatch({ unit: e.target.value as UnitCode })}>
            {UNITS.map((u) => <option key={u.code} value={u.code}>{u.label}</option>)}
          </select>
        </div>
      </div>
      {show("quantity")}
      <div className="field">
        <label htmlFor={`${id}-type`}>Product type</label>
        <select id={`${id}-type`} value={item.productType} aria-invalid={!!described("productType")} aria-describedby={described("productType")}
          onBlur={touch("productType")} onChange={(e) => { onPatch({ productType: e.target.value as ProductType }); touch("productType")(); }}>
          <option value="" disabled>Choose…</option>
          {PRODUCT_TYPES.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}
        </select>
        {show("productType")}
      </div>
      <PriorityChoice name={`${id}-priority`} value={item.priority} onChange={(p) => onPatch({ priority: p })} />
      <div className="field">
        <label htmlFor={`${id}-reason`}>Reason</label>
        <textarea id={`${id}-reason`} rows={2} maxLength={L.reasonMax} value={item.reason} placeholder="e.g. not in any box, glass cracked"
          aria-invalid={!!described("reason")} aria-describedby={described("reason")} onBlur={touch("reason")} onChange={(e) => onPatch({ reason: e.target.value })} />
        {show("reason")}
      </div>
      <FilesField id={`${id}-photos`} field={{ key: "mnd_photo", label: "Photos (at least one)", accept: "photo", required: true }} onChange={onPhotos} />
    </li>
  );
}
