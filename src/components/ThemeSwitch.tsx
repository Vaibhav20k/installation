"use client";
/**
 * Light, dark or follow the phone. The choice lives in a cookie so the server renders the right
 * theme on the first paint, and on <html data-theme> so the switch takes effect without a reload.
 */
import { useEffect, useState } from "react";
import { CircleHalf, Moon, Sun } from "@phosphor-icons/react";
import { THEME_COOKIE, type Theme } from "@/lib/theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = theme;
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=31536000; samesite=lax`;
  const dark = theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", dark ? "#0e1012" : "#e8ebeb"));
}

function useTheme(initial: Theme) {
  const [theme, setTheme] = useState<Theme>(initial);
  useEffect(() => {
    const sync = (e: Event) => setTheme((e as CustomEvent<Theme>).detail);
    window.addEventListener("im-theme", sync);
    return () => window.removeEventListener("im-theme", sync);
  }, []);
  const choose = (t: Theme) => { apply(t); setTheme(t); window.dispatchEvent(new CustomEvent("im-theme", { detail: t })); };
  return { theme, choose };
}

const OPTIONS: Array<{ id: Theme; label: string; icon: typeof Sun }> = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "auto", label: "Auto", icon: CircleHalf },
];

export function ThemeSwitch({ initial }: { initial: Theme }) {
  const { theme, choose } = useTheme(initial);
  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button key={o.id} type="button" aria-pressed={theme === o.id} onClick={() => choose(o.id)}>
          <o.icon size={14} weight={theme === o.id ? "fill" : "regular"} aria-hidden /> {o.label}
        </button>
      ))}
    </div>
  );
}

/** Phone app bar: one tap flips between light and dark. */
export function ThemeQuick({ initial }: { initial: Theme }) {
  const { theme, choose } = useTheme(initial);
  const [systemDark, setSystemDark] = useState(false);
  useEffect(() => setSystemDark(matchMedia("(prefers-color-scheme: dark)").matches), []);
  const dark = theme === "dark" || (theme === "auto" && systemDark);
  const Icon = dark ? Sun : Moon;
  return (
    <button type="button" className="theme-quick" onClick={() => choose(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      <Icon size={20} aria-hidden />
    </button>
  );
}
