/** Re-mounted by Next on every navigation, so each page fades up gently (motion.css; skipped under reduced motion). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
