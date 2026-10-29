/** Shown while a page streams in: the shape of a page instead of a spinner. */
export default function Loading() {
  return (
    <div className="skeleton" role="status" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk sk-line" style={{ width: "min(420px, 90%)" }} />
      <div className="sk sk-card" />
      <div className="sk sk-card" />
      <div className="sk sk-card" style={{ opacity: 0.6 }} />
    </div>
  );
}
