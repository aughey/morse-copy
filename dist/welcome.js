"use strict";
(() => {
  const dialog = document.getElementById("welcome");
  const preference = document.getElementById("hideWelcome");
  const storageKey = "morse-copy-hide-welcome";

  try {
    preference.checked = localStorage.getItem(storageKey) === "true";
  } catch {}

  preference.onchange = () => {
    try {
      localStorage.setItem(storageKey, String(preference.checked));
    } catch {}
  };

  document.getElementById("showWelcome").onclick = () => dialog.showModal();
  if (!preference.checked) dialog.showModal();
})();
