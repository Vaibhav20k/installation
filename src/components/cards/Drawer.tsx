"use client";
/** Side drawer on the native modal dialog: focus moves in and is restored on close, Esc and the close button work. */
import { useEffect, useRef } from "react";
import { X } from "@phosphor-icons/react";

export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} className="drawer" aria-labelledby="drawer-title" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="drawer-head">
        <h2 id="drawer-title">{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><X size={18} /></button>
      </div>
      <div className="drawer-body">{children}</div>
    </dialog>
  );
}
