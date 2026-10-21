"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { addComponentWithTasks, addOrderItem, createCustomer, createOrder, createProject } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";

const KINDS: Array<[string, string, string]> = [
  ["carcass_count", "Carcass count", "unit"], ["shutter_count", "Shutter count", "unit"],
  ["cabinet_surface_area", "Cabinet surface area", "sqft"], ["counter_surface_area", "Counter / stone surface area", "sqft"],
];

/** New customer and location-based project (managers). */
export function NewProjectForm({ customers }: { customers: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const cust = useAction(createCustomer);
  const proj = useAction(createProject, { refresh: false, onSuccess: (d) => router.push(`/projects/${(d as { id: string }).id}`) });
  return (
    <details className="card">
      <summary>Add a customer or project</summary>
      <div className="grid cols-2" style={{ marginTop: 12 }}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); cust.run({ name: String(f.get("n")) }); }}>
          <h3>New customer</h3>
          <div className="field"><label htmlFor="nc-n">Customer name</label><input id="nc-n" name="n" required minLength={2} /></div>
          <button type="submit" disabled={cust.pending}>Create customer</button>
          <ResultNotice result={cust.result} successText="Customer created; choose it for a new project." />
        </form>
        <form className="form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          proj.run({ customerId: String(f.get("c")), name: String(f.get("n")), siteAddress: String(f.get("a")), city: String(f.get("city")), kitchenFloorArea: String(f.get("area") || "") || undefined });
        }}>
          <h3>New location-based project</h3>
          <div className="field"><label htmlFor="np-c">Customer</label><select id="np-c" name="c" required>{customers.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
          <div className="field"><label htmlFor="np-n">Project name</label><input id="np-n" name="n" required minLength={2} /></div>
          <div className="field"><label htmlFor="np-a">Site address</label><input id="np-a" name="a" required minLength={3} /></div>
          <div className="fields">
            <div className="field"><label htmlFor="np-city">City</label><input id="np-city" name="city" required minLength={2} /></div>
            <div className="field"><label htmlFor="np-area">Kitchen floor area (sq ft)</label><input id="np-area" name="area" inputMode="decimal" pattern="\d+(\.\d{1,6})?" />
              <span className="hint">Floor area only; installed surface quantities are recorded per component.</span></div>
          </div>
          <button type="submit" className="primary" disabled={proj.pending}>Create project</button>
          <ResultNotice result={proj.result} />
        </form>
      </div>
    </details>
  );
}

/** Orders, order items and components with their installation steps (managers). */
export function ScopeForms({ projectId, orders, items }: { projectId: string; orders: Array<{ id: string; business_id: string }>; items: Array<{ id: string; label: string }> }) {
  const ord = useAction(createOrder);
  const item = useAction(addOrderItem);
  const comp = useAction(addComponentWithTasks);
  const [kind, setKind] = useState(KINDS[0]!);
  return (
    <details className="card">
      <summary>Add an order, order item or component</summary>
      <div className="grid cols-3" style={{ marginTop: 12 }}>
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); ord.run({ projectId, externalRef: String(f.get("r") || "") || undefined, promisedCompletion: String(f.get("d") || "") || undefined }); }}>
          <h3>Order</h3>
          <div className="field"><label htmlFor="so-r">External reference</label><input id="so-r" name="r" /></div>
          <div className="field"><label htmlFor="so-d">Promised completion</label><input id="so-d" type="date" name="d" /></div>
          <button type="submit" disabled={ord.pending}>Add order</button>
          <ResultNotice result={ord.result} successText="Order added." />
        </form>
        <form className="form" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); item.run({ orderId: String(f.get("o")), productType: String(f.get("t")), name: String(f.get("n")) }); }}>
          <h3>Order item (product)</h3>
          <div className="field"><label htmlFor="oi-o">Order</label><select id="oi-o" name="o">{orders.map((o) => <option key={o.id} value={o.id}>{o.business_id}</option>)}</select></div>
          <div className="field"><label htmlFor="oi-t">Product type</label><select id="oi-t" name="t"><option value="kitchen">Kitchen</option><option value="wardrobe">Wardrobe</option><option value="utility">Utility</option><option value="other">Other</option></select></div>
          <div className="field"><label htmlFor="oi-n">Name</label><input id="oi-n" name="n" required minLength={2} /></div>
          <button type="submit" disabled={item.pending || orders.length === 0}>Add item</button>
          <ResultNotice result={item.result} successText="Order item added." />
        </form>
        <form className="form" onSubmit={(e) => {
          e.preventDefault(); const f = new FormData(e.currentTarget);
          comp.run({ orderItemId: String(f.get("i")), name: String(f.get("n")), quantity: String(f.get("q")), unit: kind[2], quantityKind: kind[0], steps: f.getAll("s").map(String) });
        }}>
          <h3>Component and steps</h3>
          <div className="field"><label htmlFor="cm-i">Order item</label><select id="cm-i" name="i">{items.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}</select></div>
          <div className="field"><label htmlFor="cm-n">Component</label><input id="cm-n" name="n" required /></div>
          <div className="fields">
            <div className="field"><label htmlFor="cm-k">Quantity kind</label><select id="cm-k" value={kind[0]} onChange={(e) => setKind(KINDS.find((k) => k[0] === e.target.value)!)}>{KINDS.map((k) => <option key={k[0]} value={k[0]}>{k[1]}</option>)}</select></div>
            <div className="field"><label htmlFor="cm-q">Quantity ({kind[2]})</label><input id="cm-q" name="q" inputMode="decimal" pattern="\d+(\.\d{1,6})?" required /></div>
          </div>
          <fieldset><legend>Installation steps (in order)</legend>
            <div className="row">{["unpack", "assemble", "install", "finish"].map((s) => <label key={s} className="check small"><input type="checkbox" name="s" value={s} defaultChecked={s === "install"} /> {s}</label>)}</div>
          </fieldset>
          <button type="submit" disabled={comp.pending || items.length === 0}>Add component</button>
          <ResultNotice result={comp.result} successText="Component and tasks added; dependencies follow the step order." />
        </form>
      </div>
    </details>
  );
}
