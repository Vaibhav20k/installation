/** Shown instantly while the next screen loads, in the shape of a typical page. */
export default function Loading() {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      <div className="sk sk-title" />
      <div className="sk sk-line" />
      <div className="sk" style={{ height: 180 }} />
      <div className="sk" style={{ height: 240 }} />
      <span className="nav-progress" aria-hidden />
    </div>
  );
}
