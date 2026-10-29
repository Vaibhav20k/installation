/**
 * Items the Installation Manager reports at receipt that are not on the factory's list (owner request, 28 Oct
 * 2026), and the priority of any missing or damaged report. One source for the receipt screen and the server.
 */

export const PRIORITIES = [
  { code: "normal", label: "Normal" },
  { code: "high", label: "High" },
  { code: "urgent", label: "Urgent" },
] as const;
export type Priority = (typeof PRIORITIES)[number]["code"];
export const PRIORITY_CODES = PRIORITIES.map((p) => p.code) as [Priority, ...Priority[]];

/**
 * PLACEHOLDER until the owner's product-type list arrives: replace the entries here (and only here).
 * `group` is the factory dispatch group the type ships with, so a replacement dispatch gets the right type;
 * types without one ship as "other". Codes are stored on the BOM line, so keep old codes or labels will show raw.
 */
export const PRODUCT_TYPES = [
  { code: "carcass", label: "Carcass", group: "carcass" },
  { code: "shutter", label: "Shutter", group: "shutters" },
  { code: "countertop", label: "Countertop", group: "countertop" },
  { code: "backsplash", label: "Backsplash", group: "backsplash" },
  { code: "hardware", label: "Hardware", group: "other" },
  { code: "accessory", label: "Accessory", group: "other" },
  { code: "appliance", label: "Appliance", group: "other" },
  { code: "other", label: "Other", group: "other" },
] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number]["code"];
export const PRODUCT_TYPE_CODES = PRODUCT_TYPES.map((t) => t.code) as [ProductType, ...ProductType[]];

export const UNITS = [
  { code: "pcs", label: "pieces" },
  { code: "set", label: "sets" },
  { code: "sqft", label: "sq ft" },
  { code: "rft", label: "running ft" },
] as const;
export type UnitCode = (typeof UNITS)[number]["code"];
export const UNIT_CODES = UNITS.map((u) => u.code) as [UnitCode, ...UnitCode[]];

/** Limits shared by the form and the server. */
export const UNLISTED_LIMITS = { nameMin: 2, nameMax: 120, reasonMin: 3, reasonMax: 500, maxQuantity: 10000, maxItems: 30 } as const;

/** The order item every unlisted line of an order hangs under. */
export const UNLISTED_ORDER_ITEM = { productType: "unlisted", name: "Unlisted items (reported on site)" } as const;

export const productTypeLabel = (code: string | null | undefined) => (code ? PRODUCT_TYPES.find((t) => t.code === code)?.label ?? code : null);
export const priorityLabel = (code: string | null | undefined) => PRIORITIES.find((p) => p.code === code)?.label ?? "Normal";
