# ChatTrack 📜

> Save, Search, Bookmark, & Export ChatGPT, Gemini, and Claude history locally. 100% Private, 0% Server Overhead.

[![Manifest V3](https://img.shields.io/badge/Chrome-Manifest%20V3-blue.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Privacy-First](https://img.shields.io/badge/Privacy-100%25%20Private%20%7C%20Local-green.svg)](#)
[![Users](https://img.shields.io/badge/Users-200%2B-orange.svg)](#)
[![Installs](https://img.shields.io/badge/Installs-550%2B-purple.svg)](#)

**ChatTrack** is a high-performance, utility-driven Chrome Extension designed for users who want to take control of their AI conversation histories. It automatically extracts user prompts and AI responses locally on your device, indexing them for instant search and bookmarking, and exports them to publication-grade PDF documents.

---

## 🌟 Key Features

*   **⚡ Automated Scraper Engine**: Dynamically detects and extracts conversations in real time across **ChatGPT**, **Gemini**, and **Claude.ai** while you chat.
*   **📂 In-Page Shadow DOM Sidebar**: Toggle an inline, native-looking search drawer directly on the active chat page with a hotkey (`Ctrl+Shift+S` or `Cmd+Shift+S`). Built inside a Shadow Root to prevent style leaks from host applications.
*   **🔍 Instant Fuzzy Search & Bookmarks**: Search across your entire chat history locally. Filter by star bookmarks to keep track of your most important prompts.
*   **🖼️ Media Preservation & Scaling**: Detects prompt attachments (images/screenshots) and converts them into compressed Base64 inline thumbnails so they remain visible in your offline history.
*   **📄 Clean PDF Export Engine**: Export either individual conversations (Prompt + Response) or custom text selections into beautifully typeset, printable A4 PDF documents.
*   **✍️ Custom PDF Composer**: Paste formatted HTML and images directly into a built-in WYSIWYG editor to custom-build PDFs on the fly.
*   **🔒 Privacy-First**: 100% of data is stored inside your browser's local sandbox (`chrome.storage.local`). No analytics, no external servers, no tracking.

---

## 🚀 Installation (Developer Mode)

To run this extension locally or contribute to development:

1.  **Clone or Download this Repository**:
    ```bash
    git clone https://github.com/suhas12-debug/Chat-Track.git
    ```
2.  **Open Chrome Extensions Page**:
    *   Navigate to `chrome://extensions/` in your Chrome browser.
3.  **Enable Developer Mode**:
    *   Toggle the **Developer mode** switch in the top-right corner of the page.
4.  **Load the Extension**:
    *   Click the **Load unpacked** button in the top-left corner.
    *   Select the directory containing the project source code (the folder where `manifest.json` is located).
5.  **Pin & Chat**:
    *   Pin **ChatTrack** from your Extensions toolbar and open [ChatGPT](https://chatgpt.com), [Gemini](https://gemini.google.com), or [Claude](https://claude.ai) to start capturing!

---

## ⌨️ Global Shortcuts

| Shortcut | Action | Description |
| :--- | :--- | :--- |
| **`Ctrl+Shift+S`** | Toggle Sidebar | Open or close the in-page chat history drawer |
| **`Cmd+Shift+S`** | Toggle Sidebar (Mac) | Open or close the in-page chat history drawer |

---

## ⚙️ Architecture & Technical Highlights

This project implements advanced browser-extension design patterns:
*   **MV3 Offscreen PDF Pipeline**: Bypasses Manifest V3's Service Worker DOM access restrictions by instantiating a temporary, isolated Offscreen Canvas Document to build PDFs, closing it automatically after 2 seconds of inactivity to save user RAM.
*   **SSRF-Resistant Media Proxy**: Solves strict host page Content Security Policies (CSP) by proxying image downloads through a background network service worker, equipped with private IP firewalling and Content-Type verification.
*   **Atomic Storage Merge Queue**: Uses async transaction queues to orchestrate write sequences across multiple active browser tabs, eliminating race conditions.

👉 *For an in-depth breakdown of the directory structure, data schema, and security rules, check out the [Architecture Design Blueprint](ARCHITECTURE.md).*

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
