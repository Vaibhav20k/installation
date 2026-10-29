import type { Metadata, Viewport } from "next";
import { Archivo, JetBrains_Mono } from "next/font/google";
import { cookies } from "next/headers";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import "./globals.css";
import "../styles/features.css";
import "../styles/cards.css";
import "../styles/site-ops.css";
import "../styles/dispatch.css";
import "../styles/motion.css";
import "../styles/home.css";
import "../styles/inbox.css";
import "../styles/reports.css";
import "../styles/projects.css";
import "../styles/attendance.css";
import "../styles/complaints.css";
import "../styles/factory.css";

const archivo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--font-archivo", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Magppie Installations", template: "%s · Magppie Installations" },
  description: "Installation planning, skill-based staffing, clearances, daily execution, timesheets, monthly reconciliation and KRA reporting.",
  appleWebApp: { capable: true, title: "Installations", statusBarStyle: "default" },
};

// Edge to edge under the notch, keyboard resizes the layout, status bar matches the chosen theme.
export async function generateViewport(): Promise<Viewport> {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    interactiveWidget: "resizes-content",
    themeColor: theme === "auto"
      ? [{ media: "(prefers-color-scheme: light)", color: "#e8ebeb" }, { media: "(prefers-color-scheme: dark)", color: "#0e1012" }]
      : theme === "dark" ? "#0e1012" : "#e8ebeb",
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);
  return (
    <html lang="en-IN" className={`${archivo.variable} ${jetbrains.variable}`} data-theme={theme === "auto" ? undefined : theme}>
      <body>{children}</body>
    </html>
  );
}
