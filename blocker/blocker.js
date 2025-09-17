// Firefox/Chrome compatibility
if (typeof browser === "undefined") {
  var browser = chrome;
}

"use strict";

/**
 * Fullscreen overlay UI.
 * Exposes window.SiteBlocker:
 *  - createOverlay({ host, hasPassword, onSubmit(entered, setError), onOpenOptions })
 *  - removeOverlay()
 *  - isOverlayVisible()
 */

(function () {
  const OVERLAY_ID = "sb-overlay-root";

  function isOverlayVisible() {
    return !!document.getElementById(OVERLAY_ID);
  }

  function removeOverlay() {
    const root = document.getElementById(OVERLAY_ID);
    if (root && root.parentNode) root.parentNode.removeChild(root);
    document.documentElement.classList.remove("sb-locked");
    if (document.body && document.body.classList) {
      document.body.classList.remove("sb-locked");
    }
  }

  function createOverlay(options = {}) {
    const {
      host = "",
      hasPassword = true,
      onSubmit = async () => false,
      onOpenOptions = () => {}
    } = options;

    if (isOverlayVisible()) return;

    // Lock page scroll
    document.documentElement.classList.add("sb-locked");
    if (document.body && document.body.classList) {
      document.body.classList.add("sb-locked");
    }

    const root = document.createElement("div");
    root.id = OVERLAY_ID;
    root.className = "sb-overlay";

    root.innerHTML = `
      <div class="sb-backdrop"></div>
      <div class="sb-modal" role="dialog" aria-modal="true" aria-labelledby="sb-title">
        <div class="sb-header">
          <div class="sb-lock-emoji" aria-hidden="true">🔒</div>
          <h1 id="sb-title" class="sb-title">Site locked</h1>
          ${host ? `<div class="sb-host">${host}</div>` : ""}
        </div>
        <div class="sb-body">
          <p class="sb-desc">This site is blocked. Enter the master password to continue.</p>
          <div class="sb-input-row">
            <input id="sb-password" type="password" class="sb-input" placeholder="Master password" autocomplete="current-password" ${!hasPassword ? "disabled" : ""} />
            <button id="sb-unlock-btn" class="sb-btn" ${!hasPassword ? "disabled" : ""}>Unlock</button>
          </div>
          <div id="sb-error" class="sb-error" role="alert" aria-live="polite"></div>
          <div class="sb-actions">
            <button id="sb-open-options" class="sb-link">Open Settings</button>
          </div>
        </div>
      </div>
    `;

    function setError(msg) {
      const el = root.querySelector("#sb-error");
      if (el) el.textContent = msg || "";
    }

    function handleUnlock() {
      const input = root.querySelector("#sb-password");
      const value = input ? input.value : "";
      Promise.resolve(onSubmit(value, setError))
        .then((ok) => {
          if (!ok && input) {
            input.focus();
            input.select();
          }
        })
        .catch((err) => {
          setError("Unexpected error. Please try again.");
          console.error("SiteBlocker onSubmit error:", err);
        });
    }

    // Contain events within overlay, but allow inner handlers to run
    root.addEventListener("click", (e) => {
      e.stopPropagation(); // bubble phase: doesn't block button handlers
    });

    (document.documentElement || document.body).appendChild(root);

    const input = root.querySelector("#sb-password");
    const btn = root.querySelector("#sb-unlock-btn");
    const openOptionsBtn = root.querySelector("#sb-open-options");

    if (btn) btn.addEventListener("click", handleUnlock);
    if (openOptionsBtn) openOptionsBtn.addEventListener("click", (e) => {
      e.preventDefault();
      try {
        onOpenOptions();
      } catch (err) {
        console.error("Open options failed:", err);
      }
    });

    if (input) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleUnlock();
        }
      });
      if (hasPassword) {
        setTimeout(() => input.focus(), 0);
      } else {
        setError("No master password is set. Open Settings to create one.");
      }
    }

    return {
      remove: removeOverlay,
      setError
    };
  }

  window.SiteBlocker = {
    createOverlay,
    removeOverlay,
    isOverlayVisible
  };
})();