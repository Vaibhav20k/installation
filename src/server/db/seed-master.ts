/**
 * Demo master data. Every person, customer and figure here is fictional and flagged is_demo.
 * Rates, calendars, policies and targets are illustrative or provisional, never approved settings.
 */
import type { Queryable } from "./client";

const FIRST = ["Arjun", "Ravi", "Imran", "Suresh", "Deepak", "Manoj", "Kiran", "Vikas", "Anil", "Rahul", "Sanjay", "Ajay", "Naveen", "Prakash", "Gopal", "Harish", "Mohan", "Rakesh", "Sunil", "Vinod"];
const LAST = ["K.", "S.", "M.", "R.", "P.", "D.", "T.", "B."];
const CITIES = ["Delhi", "Gurugram", "Mumbai", "Bengaluru", "Jaipur"];

/** job role, permission role, count */
const ROSTER: Array<[string, string, number]> = [
  ["project_manager", "manager", 3], ["operator", "admin", 1], ["site_supervisor", "supervisor", 5],
  ["carpenter", "employee", 6], ["helper", "employee", 8], ["senior_technician", "employee", 4],
  ["technician", "employee", 5], ["junior_technician", "employee", 3], ["assistant_technician", "employee", 3],
  ["stone_technician", "employee", 2],
];

const SKILLS: Array<[string, string]> = [
  ["carpentry", "Carpentry"], ["assembly", "Cabinet assembly"], ["stone_fitting", "Stone / counter fitting"],
  ["appliance_install", "Appliance installation"], ["finishing", "Finishing and alignment"], ["site_supervision", "Site supervision"],
];

/** Typical skills per job role: [skill, level]. Levels are demo values, not an assessment. */
const ROLE_SKILLS: Record<string, Array<[string, number]>> = {
  project_manager: [["site_supervision", 3]],
  operator: [],
  site_supervisor: [["site_supervision", 3], ["assembly", 2]],
  carpenter: [["carpentry", 3], ["assembly", 2], ["finishing", 2]],
  helper: [["assembly", 1]],
  senior_technician: [["assembly", 3], ["carpentry", 2], ["appliance_install", 3], ["finishing", 3]],
  technician: [["assembly", 2], ["appliance_install", 2], ["finishing", 2]],
  junior_technician: [["assembly", 2], ["finishing", 1]],
  assistant_technician: [["assembly", 1], ["appliance_install", 1]],
  stone_technician: [["stone_fitting", 3], ["finishing", 2]],
};

const CAPS: Record<string, string[]> = {
  "EMP-001": ["accounts_clearance", "kra_review", "skill_verify", "policy_activate"],
  "EMP-002": ["finance_verify", "kra_review"],
  "EMP-003": ["skill_verify"],
  "EMP-004": ["rate_approve", "policy_activate", "skill_verify", "target_approve"],
};

const id = async (q: Queryable, sql: string, params: unknown[]) => (await q.query<{ id: string }>(sql, params))[0]!.id;

export async function seedMaster(q: Queryable) {
  const cal = await id(q, `insert into work_calendar(name, timezone, week_pattern, is_illustrative) values ($1,$2,$3,true) returning id`, [
    "Standard 6-day week (illustrative)", "Asia/Kolkata",
    JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [d, { shifts: [{ start: "10:00", end: "19:00" }], netMinutes: 480 }]))),
  ]);
  await q.query(`insert into holiday(calendar_id, date, name) values ($1,'2026-11-10','Demo holiday (illustrative)')`, [cal]);
  await q.query(`insert into holiday(calendar_id, date, name) values ($1,'2026-10-02','Gandhi Jayanti')`, [cal]);

  const skillIds: Record<string, string> = {};
  for (const [code, name] of SKILLS) skillIds[code] = await id(q, "insert into skill(code, name) values ($1,$2) returning id", [code, name]);

  // Employees: managers first, then admin, supervisors, then field staff.
  const emp: Array<{ id: string; bid: string; role: string; perm: string }> = [];
  let n = 0;
  for (const [role, perm, count] of ROSTER) {
    for (let i = 0; i < count; i++) {
      n++;
      const bid = `EMP-${String(n).padStart(3, "0")}`;
      const name = `${FIRST[(n * 7) % FIRST.length]} ${LAST[n % LAST.length]}`;
      const row = await id(q,
        `insert into employee(business_id, name, job_role, permission_role, capabilities, base_city, calendar_id, active, is_demo)
         values ($1,$2,$3,$4,$5,$6,$7,$8,true) returning id`,
        [bid, name, role, perm, CAPS[bid] ?? [], CITIES[n % CITIES.length], cal, bid !== "EMP-040"]);
      emp.push({ id: row, bid, role, perm });
    }
  }
  const managers = emp.filter((e) => e.perm === "manager");
  const supervisors = emp.filter((e) => e.perm === "supervisor");
  const verifier = emp.find((e) => e.bid === "EMP-001")!;
  for (const [i, s] of supervisors.entries()) await q.query("update employee set manager_id = $1 where id = $2", [managers[i % managers.length]!.id, s.id]);
  const field = emp.filter((e) => e.perm === "employee");
  for (const [i, e] of field.entries()) await q.query("update employee set manager_id = $1 where id = $2", [supervisors[i % supervisors.length]!.id, e.id]);

  for (const [i, e] of emp.entries()) {
    for (const [code, level] of ROLE_SKILLS[e.role] ?? []) {
      // Demo variety: every 7th skill record is unverified; one stone record expires early.
      const verified = (i + level) % 7 !== 0;
      const validTo = e.bid === "EMP-040" || (code === "stone_fitting" && e.bid === "EMP-039") ? "2026-11-03" : null;
      await q.query(
        `insert into employee_skill(employee_id, skill_id, level, verified, verified_by, verified_at, valid_from, valid_to)
         values ($1,$2,$3,$4,$5,$6,'2026-01-01',$7)`,
        [e.id, skillIds[code], level, verified, verified ? verifier.id : null, verified ? "2026-09-01T05:00:00Z" : null, validTo],
      );
    }
  }
  // Senior title without proven High proficiency (scenario 2 / unresolved register).
  const senior = emp.find((e) => e.role === "senior_technician")!;
  await q.query("update employee_skill set verified = false, verified_by = null, verified_at = null where employee_id = $1 and level = 3 and skill_id = $2", [senior.id, skillIds.assembly]);

  await q.query(`insert into leave_record(employee_id, span, kind, status) values ($1, tstzrange('2026-11-02T18:30:00Z','2026-11-05T18:30:00Z'), 'Annual leave', 'approved')`, [field[2]!.id]);

  // Reusable preferred team (effective-dated membership).
  const team = await id(q, "insert into team(business_id, name) values ('TEAM-01','Delhi kitchen crew A') returning id", []);
  const crew = [emp.find((e) => e.role === "carpenter")!, emp.filter((e) => e.role === "helper")[0]!, emp.filter((e) => e.role === "technician")[0]!];
  for (const m of crew) await q.query("insert into team_membership(team_id, employee_id, valid_from) values ($1,$2,'2026-01-01')", [team, m.id]);

  await seedScope(q, managers);
  await seedRatesAndPolicies(q);
  await seedKpiReference(q);

  const settings: Record<string, unknown> = {
    demo_mode: true,
    default_timezone: "Asia/Kolkata",
    default_currency: "INR",
    default_team_size: 3,
    team_size_note: "Teams of three is a demo assumption from an unresolved meeting statement (teams of three vs three teams).",
    managers_note: "40 demo employees include 3 with manager permission; whether the 3 managers are part of the 40 is unresolved.",
    hold_hours: 48,
    search_horizon_days: 30,
    planning_buffer: null,
    clearance_policy: { firmBookingRequires: ["accounts", "site", "installation"], exceptionGates: ["accounts"], holdBeforeClearance: "manager" },
    installation_head_employee: "EMP-001",
    allowance_note: "INR 1,000 allowance mentioned in the meeting has ambiguous coverage and is not configured.",
  };
  for (const [k, v] of Object.entries(settings)) await q.query("insert into app_setting(key, value) values ($1,$2)", [k, JSON.stringify(v)]);
}

async function seedScope(q: Queryable, managers: Array<{ id: string }>) {
  const cus1 = await id(q, `insert into customer(business_id, name, source_system, source_ref, lead_ref, lead_source, lead_created_at, converted_at, is_demo)
    values ('CUS-001','Demo Customer Mehta Family','demo_fixture','FX-C-1','FX-L-88','Showroom walk-in','2026-06-02T06:00:00Z','2026-07-15T08:00:00Z',true) returning id`, []);
  const cus2 = await id(q, `insert into customer(business_id, name, source_system, source_ref, is_demo) values ('CUS-002','Demo Customer Rao Residence','demo_fixture','FX-C-2',true) returning id`, []);
  const cus3 = await id(q, `insert into customer(business_id, name, source_system, source_ref, is_demo) values ('CUS-003','Demo Customer Kapoor Family','demo_fixture','FX-C-3',true) returning id`, []);

  const projects = [
    // Demo coordinates: approximate centre of each fictional address's locality, so the demo map is not empty.
    { bid: "PRJ-001", cus: cus1, name: "Mehta - Gurugram apartment", addr: "Tower 4, Sector 54 (demo address)", city: "Gurugram", mgr: managers[0]!.id, area: "620", lat: "28.4356", lng: "77.1057" },
    { bid: "PRJ-002", cus: cus1, name: "Mehta - Jaipur villa", addr: "Plot 12, Vaishali Nagar (demo address)", city: "Jaipur", mgr: managers[0]!.id, area: "540", lat: "26.9118", lng: "75.74" },
    { bid: "PRJ-003", cus: cus2, name: "Rao - Bengaluru home", addr: "HSR Layout, 2nd Main (demo address)", city: "Bengaluru", mgr: managers[1]!.id, area: "700", lat: "12.9121", lng: "77.6446" },
    { bid: "PRJ-004", cus: cus3, name: "Kapoor - Noida apartment", addr: "Tower B, Sector 128 (demo address)", city: "Noida", mgr: managers[0]!.id, area: "580", lat: "28.524", lng: "77.354" },
  ];
  let ord = 0, oi = 0, cmp = 0, tsk = 0;
  for (const p of projects) {
    const pid = await id(q, `insert into project(business_id, customer_id, name, site_address, city, manager_id, kitchen_floor_area, kitchen_floor_area_unit, is_demo, latitude, longitude)
      values ($1,$2,$3,$4,$5,$6,$7,'sqft',true,$8,$9) returning id`, [p.bid, p.cus, p.name, p.addr, p.city, p.mgr, p.area, p.lat, p.lng]);
    const orderCount = p.bid === "PRJ-001" ? 2 : 1;
    for (let o = 0; o < orderCount; o++) {
      ord++;
      const oid = await id(q, `insert into sales_order(business_id, project_id, external_ref, source_system, status, promised_completion)
        values ($1,$2,$3,'demo_fixture',$4,$5) returning id`, [`ORD-${String(ord).padStart(3, "0")}`, pid, `FX-SO-${1000 + ord}`, o === 0 ? "dispatched" : "partly_dispatched", "2026-11-30"]);
      oi++;
      const product = o === 0 ? ["kitchen", "Modular kitchen"] : ["wardrobe", "Bedroom wardrobe"];
      const oiid = await id(q, `insert into order_item(business_id, order_id, product_type, name, source_version) values ($1,$2,$3,$4,'v1') returning id`,
        [`OI-${String(oi).padStart(3, "0")}`, oid, product[0], product[1]]);
      const comps: Array<[string, string, string, string, string]> = o === 0
        ? [["Carcasses", "24", "unit", "carcass_count", "24"], ["Shutters", "12", "unit", "shutter_count", "6"], ["Cabinet surface", "320", "sqft", "cabinet_surface_area", "320"], ["Stone counter", "45", "sqft", "counter_surface_area", "45"]]
        : [["Wardrobe carcasses", "6", "unit", "carcass_count", "0"], ["Wardrobe shutters", "8", "unit", "shutter_count", "0"]];
      for (const [name, qty, unit, kind, avail] of comps) {
        cmp++;
        const cid = await id(q, `insert into component(business_id, order_item_id, name, quantity, unit, quantity_kind, drawing_version, dispatched_quantity, available_quantity)
          values ($1,$2,$3,$4,$5,$6,'DRG-A',$7,$7) returning id`, [`CMP-${String(cmp).padStart(3, "0")}`, oiid, name, qty, unit, kind, avail]);
        const steps = kind === "cabinet_surface_area" ? ["install"] : kind === "counter_surface_area" ? ["install"] : ["unpack", "assemble", "install"];
        let prev: string | null = null;
        for (const [si, step] of steps.entries()) {
          tsk++;
          const tid: string = await id(q, `insert into installation_task(business_id, component_id, activity, step_order, required_quantity, unit, quantity_kind)
            values ($1,$2,$3,$4,$5,$6,$7) returning id`, [`TSK-${String(tsk).padStart(3, "0")}`, cid, step, si + 1, qty, unit, kind]);
          if (prev) await q.query("insert into task_dependency(task_id, predecessor_id) values ($1,$2)", [tid, prev]);
          prev = tid;
        }
      }
    }
  }
}

async function seedRatesAndPolicies(q: Queryable) {
  const rates: Array<[string, string, string, string, string, string, number | null, number | null]> = [
    ["RATE-001", "install", "cabinet_surface_area", "sqft", "team_day", "40", 3, 480],
    ["RATE-002", "assemble", "carcass_count", "unit", "employee_day", "6", null, 480],
    ["RATE-003", "install", "shutter_count", "unit", "employee_hour", "2", null, null],
    ["RATE-004", "install", "counter_surface_area", "sqft", "team_day", "30", 2, 480],
    ["RATE-005", "unpack", "carcass_count", "unit", "employee_hour", "8", null, null],
  ];
  for (const [bid, act, kind, unit, basis, value, crew, net] of rates) {
    await q.query(`insert into productivity_rate(business_id, version, activity, quantity_kind, unit, basis, value, crew_size, net_day_minutes, status, effective_from)
      values ($1,1,$2,$3,$4,$5,$6,$7,$8,'illustrative','2026-01-01')`, [bid, act, kind, unit, basis, value, crew, net]);
  }
  const tmpl: Array<[string, string, string, string | null, string | null]> = [
    ["install", "cabinet_surface_area", "senior_technician", "0.2", null],
    ["install", "cabinet_surface_area", "helper", "0.2", null],
    ["install", "counter_surface_area", "stone_technician", "0.25", null],
    ["install", "counter_surface_area", "helper", null, "4"],
  ];
  for (const [act, kind, role, hpu, fixed] of tmpl) {
    await q.query(`insert into role_template(activity, quantity_kind, unit, role, hours_per_unit, fixed_hours, status) values ($1,$2,'sqft',$3,$4,$5,'illustrative')`, [act, kind, role, hpu, fixed]);
  }
  await q.query(`insert into time_policy(business_id, name, status, illustrative, effective_month, normal_basis, fixed_monthly_minutes, credited_activities, settlement_timezone)
    values ('POL-001','Monthly threshold (illustrative draft)','draft',true,'2026-10-01','fixed',12000,'{installation,additional,rework,travel}','Asia/Kolkata')`, []);
}

/** KPI Dashboard!A2:J9 reference text, preserved verbatim as provisional metadata. */
async function seedKpiReference(q: Queryable) {
  const rows: Array<[string, string, string, string, string, string, string]> = [
    ["installation_days", "Installation time per kitchen (500-700 sq ft)", "Inclusive calendar days from actual start to actual completion per kitchen order item", "days", "lower_better", "10–12 days (current stated range)", "Confirm target and scope; reference target: 6 days"],
    ["ftr_rate", "First Time Right (FTR) rate", "Qualifying accepted scope units without installation rework or unplanned return / eligible completed units", "percent", "higher_better", "Not currently tracked", "≥95%"],
    ["complaint_reduction", "Installation-related complaints", "(baseline - current) / baseline for a matched cohort", "percent", "higher_better", "Baseline to be established", "40% reduction vs agreed baseline"],
    ["unloading_savings", "Unloading cost savings", "Finance-approved comparable baseline - verified actual unloading cost", "INR", "higher_better", "Baseline to be validated", "₹1.5–2 lakh/month savings target (validate period/scope)"],
    ["team_productivity", "Team productivity", "Accepted comparable output / accepted person work hours", "unit per person-hour", "higher_better", "Baseline to be established", "Set after 2 weeks of reliable data"],
    ["overtime_cost", "Overtime cost", "Unique Finance-verified overtime cost allocations", "INR", "lower_better", "Baseline to be established", "Set after baseline review"],
    ["repeat_visits", "Repeat visits / rework", "Distinct unplanned return visits linked to an installation cause", "count", "lower_better", "Not currently tracked", "Reduce after baseline"],
    ["mis_completeness", "MIS completeness and timeliness", "Complete accepted obligations / expected obligations", "percent", "higher_better", "Current gaps reported", "100% complete and on time"],
  ];
  for (const [code, name, formula, unit, dir, baseline, target] of rows) {
    await q.query(`insert into kpi_definition(code, version, name, formula, unit, direction, status) values ($1,1,$2,$3,$4,$5,'reference')`, [code, name, formula, unit, dir]);
    await q.query(`insert into kpi_target(kpi_code, baseline_text, target_text, source, status, owner_text) values ($1,$2,$3,'Installation_Head_KRA_Trackers.xlsx KPI Dashboard','provisional','Installation Head')`, [code, baseline, target]);
  }
}
