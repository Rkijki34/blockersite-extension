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
    // For stronger protection against offline attacks, consider salting + KDF (PBKDF2/Argon2).
  }

  async function loadSettings() {
    const { blockedStorage } = await storage("local").get({ blockedStorage: "sync" });
    const storageArea = blockedStorage === "local" ? "local" : "sync";
    blockedStorageSelect.value = storageArea;

    const { blockedSites } = await storage(storageArea).get({ blockedSites: [] });
    fillSites(blockedSites || []);

    const { masterHash } = await storage("local").get({ masterHash: "" });
    setPasswordStatus(Boolean(masterHash));

    masterPasswordEl.value = ""; // never prefill
  }

  async function saveSettings() {
    const storageArea = blockedStorageSelect.value === "local" ? "local" : "sync";
    const sites = parseSites(blockedSitesEl.value);

    await storage(storageArea).set({ blockedSites: sites });
    await storage("local").set({ blockedStorage: storageArea });

    const newPw = (masterPasswordEl.value || "").trim();
    if (newPw.length > 0) {
      const hash = await sha256Hex(newPw);
      await storage("local").set({ masterHash: hash });
      setPasswordStatus(true);
      masterPasswordEl.value = "";
    }

    setStatus("Settings saved.");
  }

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
    const storageArea = blockedStorage === "local" ? "local" : "sync";
    const { blockedSites } = await storage(storageArea).get({ blockedSites: [] });
    const { masterHash } = await storage("local").get({ masterHash: "" });

    const payload = {
      version: 1,
      exportedAt: new Date().toISOString(),
      blockedStorage: storageArea,
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

    const storageArea = obj.blockedStorage === "local" ? "local" : (obj.blockedStorage === "sync" ? "sync" : "sync");

    if (typeof obj.masterHash === "string") {
      await storage("local").set({ masterHash: obj.masterHash });
    }

    await storage(storageArea).set({ blockedSites: obj.blockedSites || [] });
    await storage("local").set({ blockedStorage: storageArea });

    blockedStorageSelect.value = storageArea;
    fillSites(obj.blockedSites || []);
    setPasswordStatus(Boolean(obj.masterHash));
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

  // -------- Events --------

  document.addEventListener("DOMContentLoaded", loadSettings);
  saveBtn.addEventListener("click", (e) => {
    e.preventDefault();
    saveSettings().catch((err) => {
      console.error(err);
      setStatus("Failed to save settings.", true, 4000);
    });
  });

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
})();