import { describe, expect, it } from "vitest";
import { customerText, layoutSchedule, type ScheduleStep } from "@/domain/install-schedule";

const KITCHEN: ScheduleStep[] = [
  { name: "All base & tall cabinet material unpacking & assembly", days: 1 },
  { name: "All base & tall cabinet installation & levelling", days: 1 },
  { name: "Wall cabinet material unpacking & assembly", days: 1 },
  { name: "All base cabinet shutter & hardware installation", days: 1 },
  { name: "Countertop & backsplash", days: 5 },
  { name: "Wall cabinet installation", days: 1 },
  { name: "Light profile fixing, light connection & wall cabinet shutter installation", days: 1 },
  { name: "Kitchen alignment & drawer mat installation", days: 1 },
  { name: "Kitchen deep cleaning & handover", days: 1 },
];
const SIX_DAY = [1, 2, 3, 4, 5, 6];

describe("installation schedule layout", () => {
  it("reproduces the customer kitchen plan from 30 Sep 2026 with Gandhi Jayanti and Sundays off", () => {
    const days = layoutSchedule(KITCHEN, "2026-09-30", SIX_DAY, { "2026-10-02": "Gandhi Jayanti" });
    const work = (date: string) => days.find((d) => d.date === date);
    expect(days[0]!.date).toBe("2026-09-30");
    expect(days[days.length - 1]!.date).toBe("2026-10-15");
    expect(days.filter((d) => d.kind === "work")).toHaveLength(13);
    expect(work("2026-10-02")).toMatchObject({ kind: "off", offReason: "Gandhi Jayanti" });
    expect(work("2026-10-03")!.stepNo).toBe(3);
    expect(work("2026-10-04")).toMatchObject({ kind: "off", offReason: "Weekly off" });
    expect(work("2026-10-05")!.stepNo).toBe(4);
    expect(["2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"].map((d) => work(d)!.stepNo)).toEqual([5, 5, 5, 5, 5]);
    expect(work("2026-10-11")!.kind).toBe("off");
    expect(work("2026-10-12")!.stepNo).toBe(6);
    expect(work("2026-10-15")!.stepName).toBe("Kitchen deep cleaning & handover");
  });

  it("starts on the next working day when the start date is an off day, without a leading off day", () => {
    const days = layoutSchedule(KITCHEN, "2026-10-04", SIX_DAY, {});
    expect(days[0]).toMatchObject({ date: "2026-10-05", kind: "work", stepNo: 1 });
  });

  it("collapses multi-day steps into a range in the customer copy", () => {
    const days = layoutSchedule(KITCHEN, "2026-09-30", SIX_DAY, { "2026-10-02": "Gandhi Jayanti" });
    const text = customerText("Kitchen installation schedule", days);
    expect(text).toContain("06.10.26 to 10.10.26\nCountertop & backsplash");
    expect(text).toContain("02.10.26 Off (Gandhi Jayanti)");
    expect(text).toContain("04.10.26 Weekly off");
    expect(text.split("\n")[1]).toBe("30.09.26");
  });
});
