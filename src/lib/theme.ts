/** Theme preference shared by the server (first paint) and the client switch. */
export type Theme = "light" | "dark" | "auto";
export const THEME_COOKIE = "im_theme";
export const parseTheme = (v: string | undefined): Theme => (v === "light" || v === "dark" ? v : "auto");
