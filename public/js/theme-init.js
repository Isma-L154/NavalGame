// Classic, render-blocking script: sets the theme before first paint so it never flashes.
// It stays external because the CSP forbids inline scripts.
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem("naval.theme");
  } catch {
    // Storage can be blocked; fall back to the system preference.
  }
  const dark = stored ? stored === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.dataset.theme = dark ? "dark" : "light";
})();
