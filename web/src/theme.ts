export type Theme = "dark" | "light";

export function getTheme(): Theme {
  try {
    return localStorage.getItem("theme") === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("theme", theme);
  } catch { /* storage unavailable: theme just won't persist */ }
}

export function applyStoredTheme(): void {
  document.documentElement.dataset.theme = getTheme();
}
