// Firefox/Chrome compatibility
if (typeof browser === "undefined") {
  var browser = chrome;
}

"use strict";

/**
 * Options page
 * - Master password stored as SHA-256 hash in chrome.storage.local (never synced)
 * - Blocked list stored in chrome.storage.sync or chrome.storage.local (user choice)
 * - Import/Export settings to/from JSON
 * - CONFIRMATION: Password confirmation required only when deleting sites.
 *   - If no master password exists, deleting is blocked (user must set one first).
 */

(function () {
  const $ = (sel) => document.querySelector(sel);

  const masterPasswordEl = $("#masterPassword");
  const blockedSitesEl = $("#blockedSites");
  const blockedStorageSelect = $("#blockedStorageSelect");
  const saveBtn = $("#saveBtn");
  const statusEl = $("#status");
  const passwordStatusEl = $("#passwordStatus");

  const exportBtn = $("#exportBtn");
  const importBtn = $("#importBtn");
  const importFile = $("#importFile");

  // Confirm modal elements
  const confirmModalEl = $("#confirmModal");
  const confirmPasswordEl = $("#confirmPassword");
  const confirmErrorEl = $("#confirmError");
  const confirmSaveBtn = $("#confirmSaveBtn");
  const confirmCancelBtn = $("#confirmCancelBtn");
  const confirmDialogEl = confirmModalEl.querySelector(".confirm-dialog");

  // Local state
  const state = {
    storageArea: "sync",
    prevBlockedSites: [],
    masterHash: ""
  };

  // ------- Helpers -------

  function setStatus(msg, isError = false, timeout = 2500) {
    statusEl.textContent = msg || "";
    statusEl.style.color = isError ? "#ef4444" : "#16a34a";
    if (msg && timeout) {
      setTimeout(() => (statusEl.textContent = ""), timeout);
    }
  }

  function storage(area) {
    return {
      get(defaults) {
        return new Promise((resolve) => chrome.storage[area].get(defaults, resolve));
      },
      set(items) {
        return new Promise((resolve) => chrome.storage[area].set(items, resolve));
      },
      remove(keys) {
        return new Promise((resolve) => chrome.storage[area].remove(keys, resolve));
      }
    };
  }

  function parseSites(text) {
    const arr = (text || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    // Deduplicate while preserving order
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out;
  }

  function normalizeSites(list) {
    const arr = Array.isArray(list) ? list : [];
    const seen = new Set();
    const out = [];
    for (const s of arr) {
      const t = (s || "").trim();
      if (!t) continue;
      if (!seen.has(t)) {
        seen.add(t);
        out.push(t);
      }
    }
    return out;
  }

  function fillSites(list) {
    blockedSitesEl.value = (list || []).join("\n");
  }

  function setPasswordStatus(hasHash) {
    if (hasHash) {
      passwordStatusEl.textContent = "Status: master password is set (stored as SHA-256 hash, locally).";
    } else {
      passwordStatusEl.textContent = "Status: no master password set.";
    }
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function arrayRemoved(oldArr, newArr) {
    const setNew = new Set(newArr);
    return oldArr.filter((x) => !setNew.has(x));
  }

  // ------- Modal -------

  let pendingSave = null;

  function showConfirmModal() {
    confirmErrorEl.textContent = "";
    confirmPasswordEl.value = "";
    confirmModalEl.classList.add("open");
    confirmModalEl.setAttribute("aria-hidden", "false");
    // Trap focus on first open tick
    setTimeout(() => confirmPasswordEl.focus(), 0);
    // Prevent background scroll
    document.documentElement.style.overflow = "hidden";
  }

  function hideConfirmModal() {
    confirmModalEl.classList.remove("open");
    confirmModalEl.setAttribute("aria-hidden", "true");
    confirmErrorEl.textContent = "";
    confirmPasswordEl.value = "";
    pendingSave = null;
    // Restore background scroll
    document.documentElement.style.overflow = "";
  }

  async function verifyConfirmPassword() {
    const entered = (confirmPasswordEl.value || "").trim();
    if (!entered) {
      confirmErrorEl.textContent = "Please enter your master password.";
      return false;
    }
    const hash = await sha256Hex(entered);
    if (hash !== state.masterHash) {
      confirmErrorEl.textContent = "Incorrect master password.";
      return false;
    }
    return true;
  }

  // ------- Load/Save -------

  async function loadSettings() {
    const { blockedStorage } = await storage("local").get({ blockedStorage: "sync" });
    state.storageArea = blockedStorage === "local" ? "local" : "sync";
    blockedStorageSelect.value = state.storageArea;

    const { blockedSites } = await storage(state.storageArea).get({ blockedSites: [] });
    state.prevBlockedSites = normalizeSites(blockedSites || []);
    fillSites(state.prevBlockedSites);

    const { masterHash } = await storage("local").get({ masterHash: "" });
    state.masterHash = masterHash || "";
    setPasswordStatus(Boolean(state.masterHash));

    masterPasswordEl.value = ""; // never prefill
  }

  async function saveNow({ newSites, newStorageArea, newPw }) {
    // Save blocked sites and storage preference
    await storage("local").set({ blockedStorage: newStorageArea });
    await storage(newStorageArea).set({ blockedSites: newSites });

    // Update password hash only if provided
    if ((newPw || "").trim().length > 0) {
      const hash = await sha256Hex(newPw.trim());
      await storage("local").set({ masterHash: hash });
      state.masterHash = hash;
    }

    // Update UI state
    state.storageArea = newStorageArea;
    state.prevBlockedSites = newSites;
    setPasswordStatus(Boolean(state.masterHash));

    // Reflect in controls
    blockedStorageSelect.value = state.storageArea;
    fillSites(state.prevBlockedSites);
    masterPasswordEl.value = "";

    setStatus("Settings saved.");
  }

  async function handleSaveClick(e) {
    e.preventDefault();

    const newStorageArea = blockedStorageSelect.value === "local" ? "local" : "sync";
    const newSites = parseSites(blockedSitesEl.value);
    const removed = arrayRemoved(state.prevBlockedSites, newSites);
    const hasRemovals = removed.length > 0;
    const newPw = (masterPasswordEl.value || "").trim();

    // Rule: cannot remove blocked sites unless a master password is set
    if (!state.masterHash && hasRemovals) {
      setStatus("You cannot remove blocked sites without a master password. Set a master password first.", true, 4000);
      return;
    }

    // Require confirmation ONLY when deletions happen (and a password exists)
    if (state.masterHash && hasRemovals) {
      pendingSave = { newSites, newStorageArea, newPw };
      showConfirmModal();
      return;
    }

    // No deletions (or no password and no deletions): save directly
    try {
      await saveNow({ newSites, newStorageArea, newPw });
    } catch (err) {
      console.error(err);
      setStatus("Failed to save settings.", true, 4000);
    }
  }

  // Import/Export

  function download(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function exportSettings() {
    const { blockedStorage } = await storage("local").get({ blockedStorage: "sync" });
    const area = blockedStorage === "local" ? "local" : "sync";
    const { blockedSites } = await storage(area).get({ blockedSites: [] });
    const { masterHash } = await storage("local").get({ masterHash: "" });

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      blockedStorage: area,
      blockedSites: blockedSites || [],
      masterHash: masterHash || ""
    };

    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    download(`site-blocker-settings-${ts}.json`, JSON.stringify(payload, null, 2));
    setStatus("Exported settings.");
  }

  function validateImportedConfig(obj) {
    if (typeof obj !== "object" || obj === null) return "Invalid file format.";
    if (!("blockedSites" in obj) || !Array.isArray(obj.blockedSites)) return "Missing or invalid 'blockedSites'.";
    if ("blockedStorage" in obj && !["local", "sync"].includes(obj.blockedStorage)) return "Invalid 'blockedStorage' value.";
    if ("masterHash" in obj && typeof obj.masterHash !== "string") return "Invalid 'masterHash' value.";
    return null;
  }

  async function importSettingsFromObject(obj) {
    const err = validateImportedConfig(obj);
    if (err) {
      setStatus(err, true, 4000);
      return;
    }

    const area = obj.blockedStorage === "local" ? "local" : (obj.blockedStorage === "sync" ? "sync" : "sync");

    // Save masterHash locally (if provided)
    if (typeof obj.masterHash === "string") {
      await storage("local").set({ masterHash: obj.masterHash });
      state.masterHash = obj.masterHash || "";
    }

    // Save blocked list to chosen area and remember the area locally
    const sites = normalizeSites(obj.blockedSites || []);
    await storage(area).set({ blockedSites: sites });
    await storage("local").set({ blockedStorage: area });

    // Refresh UI/state
    state.storageArea = area;
    state.prevBlockedSites = sites;
    setPasswordStatus(Boolean(state.masterHash));
    blockedStorageSelect.value = state.storageArea;
    fillSites(state.prevBlockedSites);
    masterPasswordEl.value = "";

    setStatus("Imported settings.");
  }

  async function importSettingsFromFile(file) {
    try {
      const text = await file.text();
      const obj = JSON.parse(text);
      await importSettingsFromObject(obj);
    } catch (e) {
      console.error(e);
      setStatus("Failed to import: invalid JSON file.", true, 4000);
    }
  }

  // ------- Event wiring -------

  document.addEventListener("DOMContentLoaded", loadSettings);
  saveBtn.addEventListener("click", handleSaveClick);

  exportBtn.addEventListener("click", (e) => {
    e.preventDefault();
    exportSettings().catch((err) => {
      console.error(err);
      setStatus("Failed to export settings.", true, 4000);
    });
  });

  importBtn.addEventListener("click", (e) => {
    e.preventDefault();
    importFile.click();
  });

  importFile.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    importSettingsFromFile(file);
    importFile.value = ""; // allow re-import same file later
  });

  // Confirm modal buttons
  confirmCancelBtn.addEventListener("click", (e) => {
    e.preventDefault();
    hideConfirmModal();
  });

  confirmSaveBtn.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!pendingSave) return;
    // Prevent double-clicks
    confirmSaveBtn.disabled = true;
    try {
      const ok = await verifyConfirmPassword();
      if (!ok) return;
      await saveNow(pendingSave);
      hideConfirmModal();
    } catch (err) {
      console.error(err);
      confirmErrorEl.textContent = "Unexpected error. Please try again.";
    } finally {
      confirmSaveBtn.disabled = false;
    }
  });

  confirmPasswordEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmSaveBtn.click();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      hideConfirmModal();
    }
  });

  // Close modal on backdrop click
  confirmModalEl.addEventListener("click", (e) => {
    if (e.target.classList && e.target.classList.contains("confirm-backdrop")) {
      hideConfirmModal();
    }
  });

  // Prevent clicks inside the dialog from closing the modal
  confirmDialogEl.addEventListener("click", (e) => e.stopPropagation());
})();