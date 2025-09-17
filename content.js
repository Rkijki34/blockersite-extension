// Firefox/Chrome compatibility
if (typeof browser === "undefined") {
  var browser = chrome;
}

"use strict";

/**
 * Content script
 * - Receives block notifications from background
 * - Shows overlay (SiteBlocker) and validates password against stored SHA-256 hash
 */

(function () {
  function sessionKeyForHost(host) {
    return `sb_unlocked_${host}`;
  }

  function getMasterHash() {
    return new Promise((resolve) => {
      chrome.storage.local.get({ masterHash: "" }, (items) => resolve(items.masterHash || ""));
    });
  }

  function openOptions() {
    try {
      chrome.runtime.openOptionsPage();
    } catch {
      // ignore
    }
  }

  async function sha256Hex(str) {
    const enc = new TextEncoder();
    const data = enc.encode(str);
    const digest = await crypto.subtle.digest("SHA-256", data);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function handleBlockMessage(host, url) {
    if (!host) return;

    const key = sessionKeyForHost(host);
    if (sessionStorage.getItem(key) === "1") {
      return; // already unlocked for this host in this tab this session
    }

    if (window.SiteBlocker && window.SiteBlocker.isOverlayVisible()) {
      return; // avoid duplicates
    }

    const masterHash = await getMasterHash();

    window.SiteBlocker.createOverlay({
      host,
      hasPassword: Boolean(masterHash),
      onOpenOptions: () => openOptions(),
      onSubmit: async (enteredPassword, setError) => {
        const savedHash = await getMasterHash();

        if (!savedHash) {
          setError("No master password set. Open Settings and create one.");
          return false;
        }

        // IMPORTANT FIX: trim input to match how it's saved (trimmed before hashing)
        const normalized = (enteredPassword || "").trim();
        const inputHash = await sha256Hex(normalized);

        if (inputHash === savedHash) {
          // Unlock for this tab+host session
          sessionStorage.setItem(key, "1");
          window.SiteBlocker.removeOverlay();

          try {
            chrome.runtime.sendMessage({ type: "UNLOCK_TAB", host });
          } catch {
            // ignore
          }

          return true;
        } else {
          setError("Incorrect password. Please try again.");
          return false;
        }
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "SHOW_BLOCK") {
      handleBlockMessage(msg.host, msg.url);
    }
  });
})();