/** Presentation only: never authorizes or advances a workflow. */
export type TaskLane = "action" | "waiting" | "upcoming";

export function visitLane(visit: { state: string; exec_status: string; start: number; end: number }, now: number): TaskLane {
  if (visit.state === "held" || ["completed", "closed", "cancelled"].includes(visit.exec_status)) return "waiting";
  if (visit.start > now) return "upcoming";
  return visit.exec_status === "in_progress" && visit.end > now ? "action" : "waiting";
}

export function planLane(plan: { operations_state: string; created_by: string; operations_policy: { planApprover: string; regularizationApprover: string } }, actorId: string, roles: string[], pendingRegularization: boolean): TaskLane | null {
  if (pendingRegularization && roles.includes(plan.operations_policy.regularizationApprover)) return "action";
  if (plan.operations_state === "pending_approval") {
    if (plan.created_by === actorId) return "waiting";
    return roles.includes(plan.operations_policy.planApprover) ? "action" : null;
  }
  if (plan.created_by !== actorId || plan.operations_state === "hours_confirmed") return null;
  return plan.operations_state === "active" ? "waiting" : "action";
}
