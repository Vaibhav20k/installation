"use client";
/**
 * Ready for dispatch (factory). Pick the order, then one or more dispatch types: the BOM lines of those types
 * with quantity left are selected for you, and you can change quantities for a part dispatch. Lines with no
 * dispatch type on the BOM can be added by hand. If the item list isn't ready yet, the factory can say so and send
 * without lines; the Installation Manager then reports anything missing at site. Saving tells the Installation Manager.
 */
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createDispatch } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

interface LineOpt { id: string; business_id: string; name: string; unit: string; quantity: string; dispatch_group: string | null; left: string }
interface OrderOpt { id: string; business_id: string; customer: string; project: string; city: string; lines: LineOpt[] }
interface TypeOpt { code: string; label: string; groups: string[] }

export function NewDispatchForm({ orders, types, factories, initialOrder }: { orders: OrderOpt[]; types: TypeOpt[]; factories: string[]; initialOrder?: string }) {
  const router = useRouter();
  const act = useAction(createDispatch, { refresh: false, onSuccess: (d) => router.push(`/dispatch/${(d as { dispatchId: string }).dispatchId}`) });
  const [orderId, setOrderId] = useState(initialOrder && orders.some((o) => o.id === initialOrder) ? initialOrder : orders[0]?.id ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [extra, setExtra] = useState<string[]>([]);
  const [factory, setFactory] = useState(factories[0] ?? "");
  const [noList, setNoList] = useState(false);
  const [note, setNote] = useState("");
  const order = orders.find((o) => o.id === orderId);
  const groups = useMemo(() => new Set(types.filter((t) => picked.includes(t.code)).flatMap((t) => t.groups)), [types, picked]);
  const clash = types.filter((t) => picked.includes(t.code)).flatMap((t) => t.groups).length !== groups.size;
  const lines = order?.lines ?? [];
  const inType = lines.filter((l) => l.dispatch_group && groups.has(l.dispatch_group) && Number(l.left) > 0);
  const untyped = lines.filter((l) => (!l.dispatch_group || l.dispatch_group === "other") && Number(l.left) > 0);
  const chosen = [...inType, ...untyped.filter((l) => extra.includes(l.id))];
  const reset = (id: string) => { setOrderId(id); setPicked([]); setQty({}); setExtra([]); };
  const toggleType = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));
  if (!orders.length) return <p className="muted">No open orders to dispatch.</p>;
  return (
    <form className="form flow-form" onSubmit={(e) => {
      e.preventDefault();
      if (noList) act.run({ orderId, types: picked, factory, items: [], withoutList: true, note: note.trim() || undefined });
      else act.run({ orderId, types: picked, factory, items: chosen.map((l) => ({ componentId: l.id, quantity: qty[l.id] ?? l.left })).filter((i) => Number(i.quantity) > 0) });
    }}>
      <div className="field"><label htmlFor="nd-o">Order</label>
        <select id="nd-o" value={orderId} onChange={(e) => reset(e.target.value)}>{orders.map((o) => <option key={o.id} value={o.id}>{o.business_id} · {o.customer} · {o.project}</option>)}</select></div>
      <fieldset className="flow-choice">
        <legend>Dispatch type (one or more)</legend>
        <div className="flow-choice-row wrap">
          {types.map((t) => (
            <label key={t.code} data-on={picked.includes(t.code) || undefined}><input type="checkbox" checked={picked.includes(t.code)} onChange={() => toggleType(t.code)} /> <strong>{t.code}</strong> {t.label}</label>
          ))}
        </div>
        {clash && <p className="notice" data-tone="warn" role="status" style={{ margin: "8px 0 0" }}>D3 already covers countertop and backsplash; choose D3 or its parts (D3a, D3b), not both.</p>}
      </fieldset>
      {factories.length > 1 && <div className="field"><label htmlFor="nd-f">Factory</label><select id="nd-f" value={factory} onChange={(e) => setFactory(e.target.value)}>{factories.map((f) => <option key={f}>{f}</option>)}</select></div>}
      <label className="nd-nolist" data-on={noList || undefined}>
        <input type="checkbox" checked={noList} onChange={(e) => setNoList(e.target.checked)} />
        <span><strong>Item list not ready yet</strong><span className="small muted">Send now; the Installation Manager reports anything missing or damaged at site.</span></span>
      </label>
      {noList ? (
        <div className="field"><label htmlFor="nd-note">Note for the Installation Manager (optional)</label>
          <textarea id="nd-note" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: list follows from design by Friday" /></div>
      ) : <section aria-labelledby="nd-lines">
        <h3 id="nd-lines" className="flow-subhead">BOM lines on this dispatch</h3>
        {!picked.length ? <p className="small muted">Choose a dispatch type to see its lines.</p> : !inType.length && !extra.length ? <p className="small muted">Nothing of this type is left to dispatch on this order.</p> : null}
        <ul className="nd-lines">
          {chosen.map((l) => (
            <li key={l.id}>
              <span><strong>{l.name}</strong><span className="small muted">{l.business_id} · {l.left} of {l.quantity} {l.unit} left</span></span>
              <label className="nd-qty"><span className="sr-only">Quantity of {l.name}</span><input inputMode="decimal" pattern="\d+(\.\d{1,6})?" value={qty[l.id] ?? l.left} onChange={(e) => setQty((q) => ({ ...q, [l.id]: e.target.value }))} /> {l.unit}</label>
              {extra.includes(l.id) && <button type="button" className="icon-btn" onClick={() => setExtra((x) => x.filter((i) => i !== l.id))} aria-label={`Remove ${l.name}`}>×</button>}
            </li>
          ))}
        </ul>
        {untyped.some((l) => !extra.includes(l.id)) && (
          <details><summary className="small">Add a line with no dispatch type ({untyped.filter((l) => !extra.includes(l.id)).length})</summary>
            <div className="row" style={{ flexWrap: "wrap", gap: 8, marginTop: 8 }}>{untyped.filter((l) => !extra.includes(l.id)).map((l) => <button key={l.id} type="button" onClick={() => setExtra((x) => [...x, l.id])}>+ {l.name}</button>)}</div>
          </details>
        )}
      </section>}
      <button type="submit" className="primary flow-submit" disabled={act.pending || !picked.length || clash || (!noList && !chosen.length)}>{act.pending ? "Saving…" : noList ? "Mark ready for dispatch without the list" : "Mark ready for dispatch"}</button>
      <ResultNotice result={act.result} successText="Dispatch created. The Installation Manager has been notified." />
    </form>
  );
}
