/**
 * Warning for shifts the server closed after 24 hours without a clock-out (owner's rule, 28 Oct 2026).
 * The text comes from the server (autoClosedMessage) so the banner and the in-app notification say the same thing.
 */
export interface AutoClosedItem { shiftId: string; text: string }

export function AutoClosedNotice({ items, linkToForm = true }: { items: AutoClosedItem[]; linkToForm?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {items.map((i) => (
        <p key={i.shiftId} className="notice" data-tone="warn" role="alert">
          {i.text}{" "}
          {linkToForm && <a href={`/attendance#shift-${i.shiftId}`}>Send the correct clock-out time</a>}
        </p>
      ))}
    </div>
  );
}
