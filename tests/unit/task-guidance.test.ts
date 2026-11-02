import { describe, expect, it } from "vitest";
import { planLane, visitLane } from "@/lib/task-guidance";

describe("personal queue responsibility", () => {
  const visit = { state: "confirmed", exec_status: "in_progress", start: 10, end: 100 };
  it("does not suggest held, future or completed work as current progress", () => {
    expect(visitLane(visit, 50)).toBe("action");
    expect(visitLane({ ...visit, state: "held" }, 50)).toBe("waiting");
    expect(visitLane(visit, 5)).toBe("upcoming");
    expect(visitLane({ ...visit, exec_status: "completed" }, 50)).toBe("waiting");
    expect(visitLane({ ...visit, exec_status: "scheduled" }, 50)).toBe("waiting");
  });
  const plan = { operations_state: "pending_approval", created_by: "creator", operations_policy: { planApprover: "owner", regularizationApprover: "head" } };
  it("keeps a creator's own submitted plan waiting even when they hold the approver role", () => {
    expect(planLane(plan, "creator", ["owner"], false)).toBe("waiting");
    expect(planLane(plan, "reviewer", ["owner"], false)).toBe("action");
    expect(planLane(plan, "unrelated", [], false)).toBeNull();
  });
  it("separates monitoring an active plan from an actual regularization decision", () => {
    expect(planLane({ ...plan, operations_state: "active" }, "creator", [], false)).toBe("waiting");
    expect(planLane({ ...plan, operations_state: "active" }, "reviewer", ["head"], true)).toBe("action");
  });
});
