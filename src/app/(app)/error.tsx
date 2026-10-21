"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="notice" data-tone="bad" role="alert">
      <strong>This page could not load.</strong> Nothing was changed. {error.digest && <span className="small">Reference: {error.digest}</span>}
      <div style={{ marginTop: 8 }}><button type="button" onClick={reset}>Try again</button></div>
    </div>
  );
}
