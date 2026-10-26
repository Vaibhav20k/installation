"use client";
/** Skill categories for card accents: each has a text label and an icon, so color is never the only signal. */
import { Hammer, Cube, Diamond, Plug, Ruler, HardHat, Wrench, type Icon } from "@phosphor-icons/react";

const META: Record<string, { cat: string; icon: Icon }> = {
  carpentry: { cat: "carpentry", icon: Hammer },
  assembly: { cat: "assembly", icon: Cube },
  stone_fitting: { cat: "stone", icon: Diamond },
  appliance_install: { cat: "appliance", icon: Plug },
  finishing: { cat: "finishing", icon: Ruler },
  site_supervision: { cat: "supervision", icon: HardHat },
};

export function skillMeta(code: string) {
  const m = META[code] ?? { cat: "other", icon: Wrench };
  return { icon: m.icon, style: { "--cat": `var(--cat-${m.cat})` } as React.CSSProperties };
}

export const LEVEL_LABEL = { 1: "Low", 2: "Medium", 3: "High" } as const;

export function Pips({ level }: { level: number }) {
  return <span className="pips" aria-hidden>{[1, 2, 3].map((n) => <i key={n} data-on={n <= level || undefined} />)}</span>;
}

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}

export { ROLES, roleLabel, shortDate } from "./labels";
