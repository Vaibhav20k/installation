export default function NotFound() {
  return (
    <main className="main" style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1>Page not found</h1>
      <p>The record may not exist or may be outside your scope.</p>
      <p><a href="/">Back to the dashboard</a></p>
    </main>
  );
}
