# Password Site Blocker (Manifest V3)

Blocks distracting sites behind a fullscreen overlay that requires a master password. Cross‑browser (Chrome, Brave, Firefox MV3), with hashed password, local/sync storage option, and import/export of settings.

> No servers, no telemetry — everything runs locally in your browser.

---

## Features

- 🔒 Fullscreen overlay on blocked sites until you enter the master password
- 🔐 Master password stored as SHA‑256 hash (never plaintext), locally
- 🔁 Choose where to store your blocked list:
  - Sync (default): syncs across signed‑in Chromium browsers
  - Local: stored only on this device
- ⤵️ Import / ⤴️ Export settings (JSON)
- 🧠 Remember-unlock per tab + host (session only)
- 🌐 Works on Chrome, Brave, and Firefox (Manifest V3)
- ⚙️ Simple, clean options page

---

## Installation

### Chrome / Brave
1. Download or clone this repository.
2. Go to `chrome://extensions`.
3. Enable “Developer mode” (top right).
4. Click “Load unpacked” and select the project folder.
5. Open the extension’s “Options” and configure your password and site list.

### Firefox (MV3)
1. Go to `about:debugging`.
2. Click “This Firefox” → “Load Temporary Add-on”.
3. Select `manifest.json` in the project folder.
4. Open the add-on’s Options to configure.
   - Note: Temporary add-ons are removed when Firefox restarts. For permanent install you need to sign the add‑on.

---

## Quick Start

1. Open the extension’s Options page.
2. Set a master password (stored locally as a SHA‑256 hash).
3. Choose where to store the blocked list (Sync or Local).
4. Add blocked sites (one per line).
5. Visit a blocked site — a fullscreen overlay will appear. Enter your password to unlock.

---

## Block List Patterns

Each line in the list can be:
- Domain (blocks that domain and subdomains):  
  `facebook.com`
- Wildcard:  
  `*.instagram.com`
- Full URL (prefix match):  
  `https://www.youtube.com/`
- Domain with path (substring match in full URL):  
  `twitter.com/explore`

Notes:
- Matching is case‑insensitive.
- Entries are normalized (trimmed) and deduplicated.
- For file URLs in Chrome, enable “Allow access to file URLs” for the extension (in chrome://extensions).

---

## How It Works

- Background (service worker)
  - Watches tab URLs; if a URL matches your list, it tells the content script to block.
  - Keeps an in‑memory map of “unlocked hosts per tab” until the worker is unloaded.
- Content script
  - Injects the overlay UI.
  - Checks the entered password by hashing it and comparing with the stored hash.
  - If correct, removes the overlay and marks the host unlocked for that tab (also in `sessionStorage`).
- Options page
  - Lets you set the master password (stored as `masterHash` in `chrome.storage.local`).
  - Lets you choose where to store the blocked list: `chrome.storage.sync` or `chrome.storage.local`.
  - Import/Export your settings as JSON.

---

## Settings Storage

- Master password hash (never plaintext):
  - Key: `masterHash`
  - Location: `chrome.storage.local`
- Blocked sites list:
  - Key: `blockedSites`
  - Location: `chrome.storage.sync` or `chrome.storage.local` (your choice)
- Your storage choice:
  - Key: `blockedStorage` (value: `"sync"` or `"local"`)
  - Location: `chrome.storage.local`

---

## Import / Export

- Export creates a JSON file containing:
  ```json
  {
    "version": 1,
    "exportedAt": "2025-01-01T12:34:56.000Z",
    "blockedStorage": "sync",
    "blockedSites": ["facebook.com", "*.instagram.com"],
    "masterHash": "abcdef1234...sha256hex..."
  }
  ```

## Images
![extension](https://github.com/user-attachments/assets/bfe78321-0780-49cd-a115-89b119319336)

### A blocked site
![extensionv2](https://github.com/user-attachments/assets/fc3bd290-2991-4a3a-9411-aa1741be6246)
