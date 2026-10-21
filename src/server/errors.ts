/**
 * Structured application errors: validation, forbidden, conflict, not_found,
 * unavailable integration and unexpected failure (master prompt section 12).
 */
export type ErrorKind = "validation" | "forbidden" | "conflict" | "not_found" | "unavailable" | "unexpected" | "unauthenticated";

export class AppError extends Error {
  constructor(readonly kind: ErrorKind, message: string, readonly details: string[] = []) {
    super(message);
  }
}

export const validation = (message: string, details: string[] = []) => new AppError("validation", message, details);
export const forbidden = (message = "You do not have permission for this action.") => new AppError("forbidden", message);
export const conflict = (message: string, details: string[] = []) => new AppError("conflict", message, details);
export const notFound = (what: string) => new AppError("not_found", `${what} was not found or is outside your scope.`);

const PG_MESSAGES: Record<string, (constraint?: string) => string> = {
  "23P01": (c) =>
    c?.startsWith("reservation") ? "That employee is already held or confirmed for an overlapping time."
    : c?.startsWith("time_entry") ? "This entry overlaps another current entry for the same employee."
    : c?.startsWith("break_interval") ? "Breaks overlap each other."
    : c?.startsWith("reconciliation_allocation") ? "These minutes are already allocated in another reconciliation."
    : "This conflicts with an existing overlapping record.",
  "23505": () => "A record with the same identifier already exists.",
  "23503": () => "A related record does not exist or belongs to another scope.",
  "23514": () => "A value is outside the permitted range or relationship.",
  P0001: () => "This record is locked and cannot be changed directly.",
};

/** Converts thrown database errors into AppErrors; never exposes SQL or stack traces. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  const err = e as { code?: string; constraint?: string; constraint_name?: string; message?: string };
  const code = err?.code;
  if (code && PG_MESSAGES[code]) {
    const constraint = err.constraint ?? err.constraint_name;
    const kind: ErrorKind = code === "23P01" || code === "23505" || code === "P0001" ? "conflict" : "validation";
    // Trigger messages raised by our own functions are written for users.
    const own = code === "P0001" || (code === "23514" && err.message && !err.message.includes("violates check constraint"));
    return new AppError(kind, own ? err.message! : PG_MESSAGES[code]!(constraint));
  }
  return new AppError("unexpected", "Something went wrong. The change was not saved.");
}

export const HTTP_STATUS: Record<ErrorKind, number> = {
  validation: 400, unauthenticated: 401, forbidden: 403, not_found: 404, conflict: 409, unavailable: 503, unexpected: 500,
};

export type Result<T> = { ok: true; data: T } | { ok: false; kind: ErrorKind; message: string; details: string[]; correlationId: string };
