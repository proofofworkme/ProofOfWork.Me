/* Apply the saved display preference before the app or styles can paint.
   Keep this synchronous, external, and versioned for strict CSP and retained pages. */
(function () {
  var preference = "system";
  var valid = function (value) {
    return value === "light" || value === "dark" || value === "system";
  };
  var saved;
  try {
    var cookie = document.cookie.split("; ").find(function (entry) {
      return entry.indexOf("proofofwork_appearance=") === 0;
    });
    saved = cookie && cookie.slice("proofofwork_appearance=".length);
  } catch (_) { /* Cookie access can be blocked independently of local storage. */ }
  if (!valid(saved)) {
    try { saved = localStorage.getItem("proofofwork-me-appearance-v1"); }
    catch (_) { /* Blocked persistence keeps the system default usable. */ }
  }
  if (valid(saved)) preference = saved;
  var theme = preference === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  document.documentElement.dataset.appearance = preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
})();
