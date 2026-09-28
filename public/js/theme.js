const STORAGE_KEY = "naval.theme";
const THEME_COLORS = { light: "#f7f5f0", dark: "#141414" };

const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function apply(theme) {
  root.dataset.theme = theme;
  toggle?.setAttribute("aria-pressed", String(theme === "dark"));
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

function storedTheme() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

toggle?.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Not remembered, but still applied for this page.
  }
  apply(next);
});

// Follow the system while the player has not picked a theme.
systemDark.addEventListener("change", (event) => {
  if (!storedTheme()) apply(event.matches ? "dark" : "light");
});

apply(root.dataset.theme === "dark" ? "dark" : "light");
