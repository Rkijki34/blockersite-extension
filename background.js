// Firefox/Chrome compatibility
if (typeof browser === "undefined") {
  var browser = chrome;
}

"use strict";

/**
 * Background service worker
 * - Determines whether a tab URL is blocked based on the user's list
 * - Notifies content script to show the overlay when needed
 * - Temporarily remembers unlocked hosts per tab (in-memory)
 */

// In-memory: Map tabId -> Set(hosts unlocked for that tab)
const unlockedHostsByTab = new Map();

// ------------- Utilities -------------

function getHost(url) {
  try {
    return new URL(url).hostname || "";
  } catch {
    return "";
  }
}

function storageGet(area, defaults) {
  return new Promise((resolve) => {
    chrome.storage[area].get(defaults, (items) => resolve(items));
  });
}

// Where to store the blocked list: "sync" or "local"
async function getBlockedStorageArea() {
  const { blockedStorage } = await storageGet("local", { blockedStorage: "sync" });
  return blockedStorage === "local" ? "local" : "sync";
}

async function getBlockedSites() {
  const area = await getBlockedStorageArea();
  const { blockedSites } = await storageGet(area, { blockedSites: [] });
  if (!Array.isArray(blockedSites)) return [];
  // Normalize: trim, deduplicate
  const cleaned = Array.from(new Set(blockedSites.map((s) => (s || "").trim()).filter(Boolean)));
  return cleaned;
}

/**
 * URL matching:
 * Accepts patterns like:
 *  - "facebook.com" (matches domain and subdomains)
 *  - "*.example.com" (same as above)
 *  - Full URL starting with http/https (prefix match)
 *  - Domain with path (substring match on the full URL)
 */
function isUrlBlocked(url, patterns) {
  const href = (url || "").toLowerCase();
  const host = getHost(url).toLowerCase();
  if (!href || !host) return false;

  for (const raw of patterns || []) {
    const p = (raw || "").trim().toLowerCase();
    if (!p) continue;

    if (p.startsWith("http://") || p.startsWith("https://")) {
      if (href.startsWith(p)) return true;
      continue;
    }

    if (p.includes("/")) {
      if (href.includes(p)) return true;
      continue;
    }

    const pn = p.replace(/^\*\./, ""); // "*.example.com" -> "example.com"
    if (host === pn) return true;
    if (host.endsWith("." + pn)) return true;

    // Fallback: substring check in the host
    if (host.includes(pn)) return true;
  }
  return false;
}

function isUnlocked(tabId, host) {
  const set = unlockedHostsByTab.get(tabId);
  return !!(set && set.has(host));
}

function markUnlocked(tabId, host) {
  if (!unlockedHostsByTab.has(tabId)) {
    unlockedHostsByTab.set(tabId, new Set());
  }
  unlockedHostsByTab.get(tabId).add(host);
}

function clearTabState(tabId) {
  unlockedHostsByTab.delete(tabId);
}

function sendBlockMessage(tabId, url) {
  const host = getHost(url);
  try {
    chrome.tabs.sendMessage(tabId, { type: "SHOW_BLOCK", host, url }, () => {
      void chrome.runtime.lastError; // ignore
    });
  } catch {
    // ignore
  }
}

async function checkAndBlockTab(tabId, url) {
  if (!url) return;

  const blockedSites = await getBlockedSites();
  if (!blockedSites.length) return;

  const host = getHost(url);
  if (!host) return;

  if (isUnlocked(tabId, host)) {
    return; // already unlocked for this tab+host (until SW unload)
  }

  if (isUrlBlocked(url, blockedSites)) {
    sendBlockMessage(tabId, url);
  }
}

// ------------- Tab events -------------

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    checkAndBlockTab(tabId, changeInfo.url);
  } else if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    if (tab && tab.url) checkAndBlockTab(tabId, tab.url);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearTabState(tabId);
});

// ------------- Messages -------------

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg && msg.type === "UNLOCK_TAB") {
    const tabId = sender && sender.tab ? sender.tab.id : null;
    if (tabId && msg.host) {
      markUnlocked(tabId, msg.host);
    }
  }
});