/** Plain labels shared by the skill-card page (a server component) and the client card components. */
export const ROLES = ["project_manager", "operator", "site_supervisor", "carpenter", "helper", "senior_technician", "technician", "junior_technician", "assistant_technician", "stone_technician", "department_staff"];
export const roleLabel = (r: string) => r.split("_").map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ");

/** Local date as "24 Oct 2026" without a time zone shift. */
export function shortDate(d: string | null) {
  if (!d) return "";
  const [y, m, day] = d.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, day!)).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}
