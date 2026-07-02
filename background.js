/**
 * background.js
 * Handles Offscreen Document lifecycle and messaging.
 * Includes "Smart Lifecycle" for high-performance PDF generation.
 */

chrome.runtime.onInstalled.addListener(() => {
    console.log("ChatTrack Installed");
    chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
});

chrome.runtime.onStartup.addListener(() => {
    chrome.alarms.create('keepAlive', { periodInMinutes: 0.4 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'keepAlive') {
        console.log('[Background] Keep-alive ping');
    }
});

// --- Smart Offscreen Lifecycle Management ---
let offscreenTimer = null;
let creatingPromise = null;
const OFFSCREEN_KEEP_ALIVE_MS = 2000; // 2 seconds for minimal "Inspect views" footprint

async function setupOffscreen() {
    if (await chrome.offscreen.hasDocument()) {
        resetOffscreenTimer();
        return;
    }

    if (creatingPromise) return creatingPromise;

    creatingPromise = (async () => {
        try {
            await chrome.offscreen.createDocument({
                url: 'offscreen.html',
                reasons: ['DISPLAY_MEDIA'],
                justification: 'Rendering PDF documents from captured chat history.'
            });
            console.log('[Background] Offscreen document created');
            resetOffscreenTimer();
        } catch (e) {
            if (!e.message.includes('Only a single offscreen document may be created')) {
                throw e;
            }
        } finally {
            creatingPromise = null;
        }
    })();

    return creatingPromise;
}

function resetOffscreenTimer() {
    if (offscreenTimer) clearTimeout(offscreenTimer);
    offscreenTimer = setTimeout(() => {
        closeOffscreen().catch(() => { });
    }, OFFSCREEN_KEEP_ALIVE_MS);
}

async function closeOffscreen() {
    if (await chrome.offscreen.hasDocument()) {
        console.log('[Background] Closing offscreen document due to inactivity');
        await chrome.offscreen.closeDocument();
    }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return;

    // Pre-warm offscreen documentation (called when UI opens)
    if (request.action === "PREWARM_OFFSCREEN") {
        setupOffscreen().catch(() => { });
        return false;
    }

    // PDF Generation Initiation
    if (request.action === "GENERATE_PDF") {
        handlePdfRequest(request.html, request.filename);
        sendResponse({ status: "processing" });
        return false;
    }

    // Image Proxy Handler (CSP Bypass)
    if (request.action === "PROXY_IMAGE") {
        proxyImage(request.url).then(sendResponse);
        return true; // async
    }

    // Live answer fetcher routing
    if (request.action === "FETCH_LIVE_ANSWER_VIA_TAB") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            const tab = tabs?.[0];
            if (!tab?.id) { sendResponse(null); return; }
            chrome.tabs.sendMessage(tab.id, {
                action: "FETCH_LIVE_ANSWER",
                promptText: request.promptText,
                platform: request.platform,
                domMessageId: request.domMessageId,
                occurrenceNumber: request.occurrenceNumber
            }, (response) => {
                if (chrome.runtime.lastError) sendResponse(null);
                else sendResponse(response || null);
            });
        });
        return true; // async
    }

    // PDF Generation Completion
    if (request.action === "PDF_RENDER_COMPLETE") {
        closeOffscreen().catch(() => { }); // Minimal footprint
        if (request.dataUrl) {
            chrome.downloads.download({
                url: request.dataUrl,
                filename: request.filename || `ai-export-${new Date().getTime()}.pdf`,
                saveAs: true
            });
        }
    }

    if (request.action === "PDF_RENDER_ERROR") {
        console.error("PDF Render Error from Offscreen:", request.error);
        closeOffscreen().catch(() => { }); // Immediate cleanup
    }

    // Legacy Download Handler
    if (request.action === "DOWNLOAD_TEXT") {
        handleLegacyDownload(request);
        sendResponse({ status: "downloading" });
        return false;
    }
});

async function handlePdfRequest(html, filename) {
    try {
        await setupOffscreen();

        // Sequential retries with short delays to wait for offscreen readiness
        // In most cases, it will be pre-warmed or already open.
        for (let i = 0; i < 15; i++) {
            try {
                await chrome.runtime.sendMessage({
                    action: "RENDER_PDF_OFFSCREEN",
                    html: html,
                    filename: filename
                });
                return; // Success
            } catch (e) {
                // If it fails, wait 200ms and try again (up to 3 seconds total)
                await new Promise(r => setTimeout(r, 200));
            }
        }
        console.error("Failed to send RENDER_PDF_OFFSCREEN after multiple retries.");
    } catch (e) {
        console.error("Failed to setup offscreen:", e);
    }
}

async function proxyImage(url) {
    try {
        // [Existing SSRF protection and proxy logic simplified for brevity but kept intact functionally]
        const parsedUrl = new URL(url);
        if (parsedUrl.protocol !== 'https:') return { error: "HTTPS only" };

        const hostname = parsedUrl.hostname.toLowerCase();
        
        // --- SSRF Hardening ---
        // Block direct IP access (e.g. 127.0.0.1, 192.168.x.x, hex/octal variations)
        const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$|^\[?[a-f0-9]*:[a-f0-9:]+\]?$/i;
        const blockedKeywords = ['localhost', 'metadata.google', '.local', '.internal', '.corp', 'lan', 'home'];
        
        if (ipRegex.test(hostname) || blockedKeywords.some(k => hostname.includes(k))) {
            return { error: "Blocked: Direct IP or private domain not allowed" };
        }

        const isGoogle = hostname.includes('googleusercontent.com') || hostname.includes('googleapis.com') || hostname.includes('gstatic.com');

        // Added 15s timeout to prevent hanging service worker
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        try {
            let response = await fetch(url, { 
                method: 'GET', 
                credentials: isGoogle ? 'include' : 'omit', 
                referrerPolicy: 'no-referrer',
                signal: controller.signal
            });

            if ((response.status === 403 || response.status === 401) && !isGoogle) {
                response = await fetch(url, { 
                    method: 'GET', 
                    credentials: 'include', 
                    referrerPolicy: 'no-referrer',
                    signal: controller.signal
                });
            }

            if (!response.ok) {
                clearTimeout(timeoutId);
                return { error: `HTTP ${response.status}` };
            }

            // Verification: Ensure the response is actually an image
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.startsWith('image/')) {
                clearTimeout(timeoutId);
                return { error: "Invalid content type: not an image" };
            }

            const blob = await response.blob();
            clearTimeout(timeoutId);

            if (blob.size > 10 * 1024 * 1024) return { error: "Image too large" };

            return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve({ dataUrl: reader.result });
                reader.onerror = () => resolve({ error: "Read failed" });
                reader.readAsDataURL(blob);
            });
        } catch (err) {
            clearTimeout(timeoutId);
            return { error: err.name === 'AbortError' ? "Request timed out" : err.message };
        }
    } catch (err) {
        return { error: err.message };
    }
}

function handleLegacyDownload(request) {
    const url = request.isBase64 ? `data:${request.type};base64,${request.text}` : URL.createObjectURL(new Blob([request.text], { type: request.type }));
    chrome.downloads.download({ url: url, filename: request.filename, saveAs: true });
}

// Keyboard shortcuts
chrome.commands.onCommand.addListener((command) => {
    if (command === "toggle-sidebar") {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) chrome.tabs.sendMessage(tabs[0].id, { action: "TOGGLE_SIDEBAR" }, () => {
                if (chrome.runtime.lastError) { /* expected if sidebar not ready */ }
            });
        });
    }
});