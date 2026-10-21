/**
 * State machines. Approval state, visit execution state, reservation state and timesheet
 * state are independent dimensions (master prompt sections 8 and 9).
 */
export const APPROVAL = ["draft", "submitted", "approved", "returned"] as const;
export type ApprovalState = (typeof APPROVAL)[number];

export const EXECUTION = ["unscheduled", "scheduled", "in_progress", "completed", "closed", "on_hold", "cancelled"] as const;
export type ExecutionState = (typeof EXECUTION)[number];

export const RESERVATION = ["proposed", "held", "confirmed", "released", "cancelled"] as const;
export type ReservationState = (typeof RESERVATION)[number];

export const TIMESHEET = ["draft", "submitted", "accepted", "returned", "voided"] as const;
export type TimesheetState = (typeof TIMESHEET)[number];

const approvalMoves: Record<ApprovalState, ApprovalState[]> = {
  draft: ["submitted"],
  submitted: ["approved", "returned"],
  approved: [],
  returned: [],
};

const executionMoves: Record<ExecutionState, ExecutionState[]> = {
  unscheduled: ["scheduled", "cancelled"],
  scheduled: ["in_progress", "on_hold", "cancelled", "unscheduled"],
  in_progress: ["completed", "on_hold"],
  on_hold: ["scheduled", "in_progress", "cancelled"],
  completed: ["closed", "in_progress"],
  closed: [],
  cancelled: [],
};

const reservationMoves: Record<ReservationState, ReservationState[]> = {
  proposed: ["held", "confirmed", "cancelled"],
  held: ["confirmed", "released", "cancelled"],
  confirmed: ["released", "cancelled"],
  released: [],
  cancelled: [],
};

const timesheetMoves: Record<TimesheetState, TimesheetState[]> = {
  draft: ["submitted", "voided"],
  submitted: ["accepted", "returned"],
  accepted: ["voided"],
  returned: ["voided"],
  voided: [],
};

function check<S extends string>(table: Record<S, S[]>, from: S, to: S, label: string): void {
  if (!table[from]?.includes(to)) throw new TransitionError(`${label} cannot move from ${from} to ${to}`);
}

export class TransitionError extends Error {}

export const canApprove = (from: ApprovalState, to: ApprovalState) => approvalMoves[from].includes(to);
export const assertApproval = (from: ApprovalState, to: ApprovalState) => check(approvalMoves, from, to, "Plan revision");
export const assertExecution = (from: ExecutionState, to: ExecutionState) => check(executionMoves, from, to, "Visit");
export const assertReservation = (from: ReservationState, to: ReservationState) => check(reservationMoves, from, to, "Reservation");
export const assertTimesheet = (from: TimesheetState, to: TimesheetState) => check(timesheetMoves, from, to, "Time entry");

export const BLOCKING_RESERVATION: ReservationState[] = ["held", "confirmed"];

export const LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Submitted", approved: "Approved", returned: "Returned",
  unscheduled: "Unscheduled", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed",
  closed: "Closed", on_hold: "On hold", cancelled: "Cancelled",
  proposed: "Proposed", held: "Held", confirmed: "Confirmed", released: "Released",
  accepted: "Accepted", voided: "Replaced/voided",
  fresh: "Fresh", follow_up: "Follow-up", final: "Final",
  pending: "Pending", cleared: "Cleared", rejected: "Rejected", expired: "Expired", revoked: "Revoked",
  pass: "Pass", fail: "Fail", na: "Not applicable",
};
