import Link from "next/link";
export default function NotFound() {
  return (
    <main className="main" style={{ maxWidth: 640, margin: "0 auto" }}>
      <h1>Page not found</h1>
      <p>The record may not exist or may be outside your scope.</p>
      <p><Link href="/">Back to the dashboard</Link></p>
    </main>
  );
}
