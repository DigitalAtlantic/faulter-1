// Blocking theme initialisation — executed before first paint to prevent FOUC.
// Reads the user's saved preference from localStorage and adds the "dark" class
// to <html> when appropriate.  Served as a static file from /public so it is
// covered by `script-src 'self'` in the CSP — no inline nonce required.
(function () {
  try {
    var t = localStorage.getItem("faulter-theme");
    var d = window.matchMedia("(prefers-color-scheme: dark)").matches;
    if (t === "dark" || (t === null && d)) {
      document.documentElement.classList.add("dark");
    }
  } catch (e) {
    // localStorage unavailable (private browsing, security policy, etc.) —
    // fall back to the light theme and continue silently.
  }
})();
