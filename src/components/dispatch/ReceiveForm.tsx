"use client";
/**
 * Received & MND, used on site from a phone. Two plain choices: check the items on the factory list, or report an
 * item that is not on it; both go in one submission. Every factory-list line starts ticked ("received OK"), so a
 * full delivery is one tap. Unticking a line asks for missing or damaged, the quantity, a reason, a photo and an
 * optional priority. An item not on the list becomes an unlisted line of the order and runs the same complaint
 * flow. When the factory has not added a list yet, the screen opens on reporting, and "nothing missing" is an
 * explicit choice. Both panels stay mounted (only hidden) so photos already uploading are never lost.
 */
import { useCallback, useState } from "react";
import { CheckCircle, Info, ListChecks, Plus, WarningCircle } from "@phosphor-icons/react";
import { receiveDispatch } from "@/app/actions";
import { useAction } from "@/components/ui/useAction";
import { ResultNotice } from "@/components/ui/ResultNotice";
import type { Priority } from "@/domain/unlisted-items";
import { FilesField, type FileState } from "./StageForms";
import { PriorityChoice, UnlistedItemCard, newUnlisted, unlistedErrors, type UnlistedDraft } from "./UnlistedItemCard";

interface Line { id: string; name: string; quantity: string; unit: string }
interface Issue { kind: "" | "missing" | "damaged"; quantity: string; reason: string; photos: FileState | null; priority: Priority }
type Mode = "list" | "other";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const samePhotos = (a: FileState | null, b: FileState) => a?.draftKey === b.draftKey && a.ready === b.ready && a.pending === b.pending;

export function ReceiveForm({ dispatchId, version, stage, lines }: { dispatchId: string; version: number; stage: string; lines: Line[] }) {
  const act = useAction(receiveDispatch);
  const hasList = lines.length > 0;
  const [mode, setMode] = useState<Mode>(hasList ? "list" : "other");
  const [issues, setIssues] = useState<Record<string, Issue>>({});
  const [extra, setExtra] = useState<UnlistedDraft[]>([]);

  const toggle = (l: Line, ok: boolean) => setIssues((x) => {
    const n = { ...x };
    if (ok) delete n[l.id]; else n[l.id] = { kind: "", quantity: l.quantity, reason: "", photos: null, priority: "normal" };
    return n;
  });
  const patch = (id: string, p: Partial<Issue>) => setIssues((x) => (x[id] ? { ...x, [id]: { ...x[id]!, ...p } } : x));
  const onPhotos = useCallback((id: string, s: FileState) => setIssues((x) => {
    const cur = x[id];
    return !cur || samePhotos(cur.photos, s) ? x : { ...x, [id]: { ...cur, photos: s } };
  }), []);
  const patchExtra = (key: string, p: Partial<UnlistedDraft>) => setExtra((xs) => xs.map((u) => (u.key === key ? { ...u, ...p } : u)));
  const onExtraPhotos = useCallback((key: string, s: FileState) => setExtra((xs) =>
    (xs.some((u) => u.key === key && !samePhotos(u.photos, s)) ? xs.map((u) => (u.key === key ? { ...u, photos: s } : u)) : xs)), []);
  const addExtra = () => setExtra((xs) => [...xs, newUnlisted()]);
  const choose = (m: Mode) => { setMode(m); if (m === "other" && extra.length === 0) addExtra(); };

  const open = Object.entries(issues);
  const lineTodo = open.filter(([, i]) => !i.kind || !i.quantity || i.reason.trim().length < 3 || !i.photos?.ready || (i.photos?.pending ?? 0) > 0)
    .map(([id]) => lines.find((l) => l.id === id)?.name ?? "a line");
  const extraTodo = extra.flatMap((u, n) => (Object.keys(unlistedErrors(u)).length ? [u.name.trim() || `item ${n + 1}`] : []));
  const todo = [...lineTodo, ...extraTodo];
  const complaints = open.length + extra.length;
  const cta = act.pending ? "Saving…" : complaints ? "Mark received and raise complaints" : hasList ? "Mark received in full" : "Nothing missing or damaged – mark received";

  return (
    <form className="form receive" onSubmit={(e) => {
      e.preventDefault();
      if (todo.length) return;
      act.run({
        dispatchId, version, stage, nothingMissing: !hasList && extra.length === 0,
        lines: lines.map((l) => {
          const i = issues[l.id];
          return i ? { itemId: l.id, ok: false, kind: i.kind || undefined, quantity: i.quantity, reason: i.reason, priority: i.priority, photoDraftKey: i.photos?.draftKey } : { itemId: l.id, ok: true };
        }),
        unlisted: extra.map((u) => ({ name: u.name.trim(), quantity: u.quantity, unit: u.unit, kind: u.kind, priority: u.priority, productType: u.productType, reason: u.reason.trim(), photoDraftKey: u.photos?.draftKey })),
      });
    }}>
      {hasList ? (
        <div className="receive-modes" role="group" aria-label="Receipt check">
          <button type="button" aria-pressed={mode === "list"} onClick={() => choose("list")}>
            <ListChecks size={22} aria-hidden /><span>Check items on the factory list<small>{plural(lines.length, "item")}{open.length ? ` · ${open.length} with a problem` : ""}</small></span>
          </button>
          <button type="button" aria-pressed={mode === "other"} onClick={() => choose("other")}>
            <Plus size={22} aria-hidden /><span>Report an item not on the list<small>{extra.length ? `${plural(extra.length, "item")} added` : "Missing or damaged"}</small></span>
          </button>
        </div>
      ) : (
        <p className="receive-nolist" role="note"><Info size={20} aria-hidden /><span><strong>The factory hasn&apos;t added the item list yet.</strong> Report anything missing or damaged below, or confirm that nothing is.</span></p>
      )}

      {hasList && (
        <div className="receive-panel" hidden={mode !== "list"}>
          <p className="small muted" style={{ margin: 0 }}>Untick anything missing or damaged. Each unticked line becomes one complaint to the factory.</p>
          <ul className="receive-list">
            {lines.map((l) => {
              const i = issues[l.id];
              return (
                <li key={l.id} data-issue={i ? true : undefined}>
                  <label className="receive-line">
                    <input type="checkbox" checked={!i} onChange={(e) => toggle(l, e.target.checked)} />
                    <span className="receive-name"><strong>{l.name}</strong><span className="small muted">{l.quantity} {l.unit}</span></span>
                    {i ? <WarningCircle size={22} weight="fill" className="receive-bad" aria-label="Problem" /> : <CheckCircle size={22} weight="fill" className="receive-ok" aria-label="Received OK" />}
                  </label>
                  {i && (
                    <div className="receive-issue">
                      <fieldset className="flow-choice">
                        <legend>What is wrong?</legend>
                        <div className="flow-choice-row">
                          {(["missing", "damaged"] as const).map((k) => (
                            <label key={k} data-on={i.kind === k || undefined}><input type="radio" name={`k-${l.id}`} value={k} checked={i.kind === k} onChange={() => patch(l.id, { kind: k })} required /> {k === "missing" ? "Missing" : "Damaged"}</label>
                          ))}
                        </div>
                      </fieldset>
                      <div className="field"><label htmlFor={`q-${l.id}`}>Quantity affected ({l.unit}, at most {l.quantity})</label>
                        <input id={`q-${l.id}`} inputMode="decimal" pattern="\d+(\.\d{1,6})?" required value={i.quantity} onChange={(e) => patch(l.id, { quantity: e.target.value })} /></div>
                      <div className="field"><label htmlFor={`r-${l.id}`}>Reason</label>
                        <textarea id={`r-${l.id}`} rows={2} required minLength={3} maxLength={500} value={i.reason} onChange={(e) => patch(l.id, { reason: e.target.value })} placeholder="e.g. corner broken, box opened, not on the truck" /></div>
                      <PriorityChoice name={`pr-${l.id}`} value={i.priority} onChange={(p) => patch(l.id, { priority: p })} />
                      <FilesField id={`p-${l.id}`} field={{ key: "mnd_photo", label: "Photos (at least one)", accept: "photo", required: true }} onChange={(s) => onPhotos(l.id, s)} />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <div className="receive-panel" hidden={mode !== "other"}>
        {extra.length > 0 && <p className="small muted" style={{ margin: 0 }}>Each item is added to the order and goes to the factory as one complaint.</p>}
        {extra.length > 0 && (
          <ul className="unlisted-list">
            {extra.map((u, n) => (
              <UnlistedItemCard key={u.key} index={n} item={u} onPatch={(p) => patchExtra(u.key, p)} onPhotos={(s) => onExtraPhotos(u.key, s)}
                onRemove={() => setExtra((xs) => xs.filter((x) => x.key !== u.key))} />
            ))}
          </ul>
        )}
        <button type="button" className="button receive-add" onClick={addExtra}><Plus size={18} aria-hidden /> {extra.length ? "Add another item" : "Add a missing or damaged item"}</button>
      </div>

      <p className="receive-summary" aria-live="polite">
        {hasList ? `${lines.length - open.length} of ${lines.length} received OK` : "No factory list"}
        {extra.length ? ` · ${plural(extra.length, "item")} not on the list` : ""}
        {complaints ? ` · ${plural(complaints, "complaint")} will be opened` : ""}
      </p>
      {todo.length > 0 && <p className="receive-todo">Still to fill in: {todo.slice(0, 3).join(", ")}{todo.length > 3 ? ` and ${todo.length - 3} more` : ""}.</p>}
      <button type="submit" className="primary flow-submit" disabled={act.pending || todo.length > 0}>{cta}</button>
      <ResultNotice result={act.result} successText="Receipt saved." />
    </form>
  );
}
