// Using StorageManager from storage.js (loaded via manifest.js)

/**
 * Multi-selector fallback system for resilience against platform UI changes.
 * Selectors are tried in priority order — first one that finds elements wins.
 */
const PLATFORM_SELECTORS = {
    'chatgpt.com': {
        name: 'ChatGPT',
        userSelectors: [
            '[data-message-author-role="user"]',
            '[data-testid*="user"] .whitespace-pre-wrap',
            'article [data-message-author-role="user"]'
        ],
        answerSelectors: [
            '[data-message-author-role="assistant"]',
            '[data-testid*="assistant"]',
            'article [data-message-author-role="assistant"]',
            '.markdown', // Fuzzy fallback
            '.prose'     // Fuzzy fallback
        ]
    },
    'chat.openai.com': {
        name: 'ChatGPT',
        userSelectors: [
            '[data-message-author-role="user"]',
            '[data-testid*="user"] .whitespace-pre-wrap'
        ],
        answerSelectors: [
            '[data-message-author-role="assistant"]',
            '[data-testid*="assistant"]'
        ]
    },
    'gemini.google.com': {
        name: 'Gemini',
        userSelectors: [
            'main user-query-content',
            '.user-query-content',
            '[data-testid="user-query"]',
            'message-content[data-message-author="user"]'
        ],
        answerSelectors: [
            'main .model-response',
            '.response-container',
            '[data-testid="model-response"]',
            '.answer-content',
            'message-content[data-message-author="model"]',
            '.markdown-content' // Fuzzy fallback
        ]
    },
    'claude.ai': {
        name: 'Claude',
        userSelectors: [
            'p[data-is-user-message="true"]',
            '[data-is-user-message="true"]',
            '.user-message',
            'div[class*="user-message"]',
            'article'
        ],
        answerSelectors: [
            '[data-is-user-message="false"]',
            '.assistant-message',
            'div[class*="assistant-message"]',
            'div[class*="response"]',
            '.prose'
        ]
    }
};

let currentUrl = window.location.href;
let isContextInvalidated = false;
let watchInterval = null;
let answerInterval = null;
let chatObserver = null;
let scrapeTimer = null;
let scrapeTimeout = null;
let lastScrapedHash = '';

function findBestSelector(selectors) {
    for (const sel of selectors) {
        try {
            const found = document.querySelectorAll(sel);
            if (found.length > 0) return sel;
        } catch (e) {}
    }
    return null;
}

function getPlatform() {
    const domain = window.location.hostname;
    const key = Object.keys(PLATFORM_SELECTORS).find(k => domain.includes(k.replace('www.', '')));
    if (!key) return { name: 'Unknown', selector: null };

    const config = PLATFORM_SELECTORS[key];
    const bestUserSel = findBestSelector(config.userSelectors);
    const bestAnswerSel = findBestSelector(config.answerSelectors);

    return {
        name: config.name,
        selector: bestUserSel || config.userSelectors[0],
        answerSelector: bestAnswerSel || config.answerSelectors[0]
    };
}

function checkContext() {
    if (isContextInvalidated) return false;
    if (!chrome.runtime?.id) {
        if (!isContextInvalidated) {
            isContextInvalidated = true;
            if (scrapeTimeout) clearTimeout(scrapeTimeout);
            if (scrapeTimer) clearTimeout(scrapeTimer);
            if (watchInterval) clearInterval(watchInterval);
            if (answerInterval) clearInterval(answerInterval);
            if (chatObserver) {
                chatObserver.disconnect();
                chatObserver = null;
            }
        }
        return false;
    }
    return true;
}

function cleanHtmlOfUiElements(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    doc.querySelectorAll('button').forEach(btn => {
        const img = btn.querySelector('img');
        if (img) { btn.replaceWith(img); } else { btn.remove(); }
    });

    doc.querySelectorAll('svg').forEach(svg => {
        const inImageContainer =
            svg.closest('[class*="grid"]') ||
            svg.closest('.image-container') ||
            svg.closest('.image-grid-container') ||
            svg.closest('figure') ||
            svg.closest('picture');
        if (!inImageContainer) svg.remove();
    });

    const uiSelectors = [
        '[role="button"]', '[aria-label*="Copy"]', '[aria-label*="retry"]',
        '[aria-label*="Good"]', '[aria-label*="Bad"]', '[class*="feedback"]',
        '[class*="actions"]', '[data-testid*="copy"]', '[data-testid*="thumb"]',
        '.image-placeholder-btn'
    ];

    uiSelectors.forEach(selector => {
        doc.querySelectorAll(selector).forEach(el => {
            if (!el.querySelector('img')) el.remove();
        });
    });

    return doc.body.innerHTML.trim();
}

async function scrapeAllMessages() {
    if (scrapeTimeout) clearTimeout(scrapeTimeout);

    scrapeTimeout = setTimeout(async () => {
        try {
            if (!checkContext()) return;
            if (document.hidden) return;
        } catch (err) {
            if (err.message && err.message.includes("Extension context invalidated")) {
                isContextInvalidated = true;
            } else {
                console.error("[Content] Scrape error:", err);
            }
            return;
        }

        const platformInfo = getPlatform();
        if (!platformInfo.selector) {
            console.log(`[ChatTrack] No selector found for platform: ${platformInfo.name}`);
            return;
        }

        console.log(`[ChatTrack] Scraping ${platformInfo.name} with selector: ${platformInfo.selector}`);
        const allMatchedUsers = Array.from(document.querySelectorAll(platformInfo.selector));
        console.log(`[ChatTrack] Found ${allMatchedUsers.length} user messages`);
        const userMessages = allMatchedUsers.filter((el, idx) =>
            !allMatchedUsers.some((other, oIdx) => oIdx !== idx && other.contains(el))
        );
        console.log(`[ChatTrack] After dedup: ${userMessages.length} user messages`);

        const answerMessages = platformInfo.answerSelector
            ? document.querySelectorAll(platformInfo.answerSelector)
            : [];
        console.log(`[ChatTrack] Found ${answerMessages.length} answer messages`);

        if (userMessages.length === 0) {
            console.log(`[ChatTrack] No user messages to scrape`);
            return;
        }

        const promptsToSave = [];

        // occurrenceCount: tracks how many times each text has appeared so far.
        // Used to compute occurrenceNumber — the navigation anchor.
        // Completely separate from messageIndex which is the loop position for sorting.
        const occurrenceCount = {};

        for (let index = 0; index < userMessages.length; index++) {
            const msg = userMessages[index];
            try {
                let text = msg.innerText.trim();
                let promptImages = [];
                // Extract images from broader message container
                const userContainer =
                    msg.closest('article[data-testid*="conversation-turn"]') ||
                    msg.closest('[data-testid^="conversation-turn-"]') ||
                    msg.closest('user-query') ||
                    msg.closest('[data-testid="user-query"]') ||
                    msg.closest('.query-container') ||
                    msg.closest('.message-container') ||
                    msg.closest('article') || // Claude support
                    msg.closest('[data-is-user-message="true"]') || // Claude support
                    msg.closest('.user-message') || // Claude support
                    msg.parentElement;

                const imgElements = (userContainer || msg).querySelectorAll('img');
                if (imgElements.length > 0) {
                    console.log(`[ChatTrack] Found ${imgElements.length} images in message ${index + 1}`);
                    for (const img of imgElements) {
                        const src = img.getAttribute('src');
                        if (!src) {
                            console.log('[ChatTrack] Image has no src, skipping');
                            continue;
                        }
                        // Filter out small UI icons/avatars (usually < 30px)
                        const isTooSmall = img.naturalWidth > 0 && img.naturalWidth < 30;
                        const isAvatar = src.includes('avatar') || img.classList.contains('avatar') || img.getAttribute('alt')?.toLowerCase().includes('avatar');
                        if (isTooSmall || isAvatar) {
                            console.log(`[ChatTrack] Skipping image (tooSmall: ${isTooSmall}, isAvatar: ${isAvatar})`);
                            continue;
                        }
                        
                        console.log(`[ChatTrack] Processing image: ${src.substring(0, 60)}...`);
                        
                        // Convert images to small base64 thumbnails at capture time.
                        // Raw HTTP URLs (e.g. files.oaiusercontent.com) expire quickly,
                        // causing broken images in the sidebar. Thumbnails are self-contained.
                        if (src.startsWith('http')) {
                            const thumb = await generateThumbnail(src, 120);
                            if (thumb) promptImages.push(thumb);
                        } else if (src.startsWith('blob:')) {
                            const thumb = await blobUrlToBase64Thumb(src, 120);
                            if (thumb) promptImages.push(thumb);
                        } else if (src.startsWith('data:')) {
                            // Already base64 — store a compressed thumbnail copy
                            const thumb = await generateThumbnail(src, 120);
                            if (thumb) promptImages.push(thumb);
                        }
                    }
                }

                console.log(`[ChatTrack] Message ${index + 1}: ${promptImages.length} images collected`);

                // If text is empty but we have images, add a placeholder
                if (!text && promptImages.length > 0) {
                    text = "[Image Prompt]";
                }

                if (platformInfo.name === 'Gemini') {
                    text = text.replace(/^You\s*Said\s*/i, '').trim();
                    text = text.replace(/^You\nSaid\s*/i, '').trim();
                }

                let answer = '';
                if (platformInfo.answerSelector) {
                    if (platformInfo.name === 'ChatGPT') {
                        const userArticle =
                            msg.closest('article[data-testid*="conversation-turn"]') ||
                            msg.closest('[data-testid^="conversation-turn-"]') ||
                            msg.closest('article') ||
                            msg.closest('[data-message-author-role="user"]');

                        if (userArticle) {
                            let nextEl = userArticle.nextElementSibling;
                            while (nextEl) {
                                const assistantRole = nextEl.querySelector('[data-message-author-role="assistant"]');
                                if (assistantRole) {
                                    const messageContent =
                                        nextEl.querySelector('.markdown, .text-message, [class*="message-content"]') ||
                                        assistantRole;
                                    answer = messageContent.innerHTML.trim();
                                    break;
                                }
                                if (nextEl.querySelector('[data-message-author-role="user"]')) break;
                                nextEl = nextEl.nextElementSibling;
                            }
                        }

                        if (!answer && index < answerMessages.length) {
                            const fallbackAnswer = answerMessages[index];
                            const richContent = fallbackAnswer.closest('article')?.querySelector('.markdown, .text-message');
                            answer = (richContent || fallbackAnswer).innerHTML.trim();
                        }
                    } else if (platformInfo.name === 'Gemini') {
                        const userContainer =
                            msg.closest('user-query') ||
                            msg.closest('[data-testid="user-query"]') ||
                            msg.closest('.query-container') ||
                            msg.parentElement;

                        if (userContainer) {
                            let nextEl = userContainer.nextElementSibling;
                            while (nextEl) {
                                if (nextEl.matches && (
                                    nextEl.matches('.model-response') ||
                                    nextEl.matches('[data-testid="model-response"]')
                                )) {
                                    answer = nextEl.outerHTML.trim();
                                    break;
                                }
                                const responseEl = nextEl.querySelector(
                                    '.model-response, [data-testid="model-response"], .response-content, .answer-content, .markdown'
                                );
                                if (responseEl) { answer = responseEl.outerHTML.trim(); break; }
                                const hasImages = nextEl.querySelectorAll('img').length > 0;
                                const hasText = nextEl.innerText.trim().length > 50;
                                if (hasImages || hasText) { answer = nextEl.outerHTML.trim(); break; }
                                nextEl = nextEl.nextElementSibling;
                            }
                        }

                        if (!answer && index < answerMessages.length) {
                            const msgContainer =
                                answerMessages[index].closest('.message, .response, [class*="response"]') ||
                                answerMessages[index];
                            answer = msgContainer.outerHTML
                                ? msgContainer.outerHTML.trim()
                                : answerMessages[index].innerHTML.trim();
                        }
                    } else if (platformInfo.name === 'Claude') {
                        // Claude: Find the next assistant message after user message
                        const userArticle =
                            msg.closest('article') ||
                            msg.closest('[data-is-user-message="true"]') ||
                            msg.closest('.user-message') ||
                            msg.parentElement;

                        if (userArticle) {
                            let nextEl = userArticle.nextElementSibling;
                            while (nextEl) {
                                const isAssistant = nextEl.getAttribute('data-is-user-message') === 'false' ||
                                    nextEl.classList.contains('assistant-message') ||
                                    (nextEl.className && nextEl.className.includes && nextEl.className.includes('assistant'));
                                if (isAssistant) {
                                    answer = nextEl.innerHTML.trim();
                                    break;
                                }
                                // Check if next element is another user message (stop searching)
                                const isNextUser = nextEl.getAttribute('data-is-user-message') === 'true' ||
                                    nextEl.classList.contains('user-message');
                                if (isNextUser) break;
                                
                                // Look for assistant message inside nested containers
                                const assistantEl = nextEl.querySelector('.assistant-message, [data-is-user-message="false"], div[class*="assistant"]');
                                if (assistantEl) {
                                    answer = assistantEl.innerHTML.trim();
                                    break;
                                }
                                nextEl = nextEl.nextElementSibling;
                            }
                        }

                        // Fallback: Use index-based matching
                        if (!answer && index < answerMessages.length) {
                            const fallbackAnswer = answerMessages[index];
                            answer = fallbackAnswer.innerHTML.trim();
                        }
                    } else {
                        if (index < answerMessages.length) {
                            answer = answerMessages[index].innerHTML.trim();
                        }
                    }
                }

                if (text) {
                    let finalAnswer = answer || "";
                    try {
                        if (answer) finalAnswer = await processAnswerHtml(answer, platformInfo.name) || answer;
                        if (finalAnswer) finalAnswer = cleanHtmlOfUiElements(finalAnswer) || finalAnswer;
                    } catch (procErr) {
                        console.warn(`ChatTrack: Error processing answer for prompt ${index + 1}:`, procErr);
                        finalAnswer = answer || "";
                    }

                    // occurrenceNumber = how many times this exact text appeared before
                    // this message. First "hii" = 0, second "hii" = 1. For NAVIGATION only.
                    const occurrenceNumber = occurrenceCount[text] !== undefined
                        ? occurrenceCount[text] + 1
                        : 0;
                    occurrenceCount[text] = occurrenceNumber;

                    // domMessageId: read from the element itself or its parents.
                    const domMessageId =
                        msg.getAttribute('data-message-id') ||
                        msg.closest('[data-message-id]')?.getAttribute('data-message-id') ||
                        null;

                    promptsToSave.push({
                        prompt: text,
                        answer: finalAnswer,
                        platform: platformInfo.name,
                        url: window.location.href,
                        promptImages: promptImages,      // Only HTTP URL refs — no Base64
                        messageIndex: index,             // loop position — SORTING only
                        occurrenceNumber: occurrenceNumber, // nth time text appears — NAVIGATION only
                        domMessageId: domMessageId       // platform UUID — primary nav anchor
                    });
                }
            } catch (msgErr) {
                console.error(`ChatTrack: Error processing message ${index}:`, msgErr);
            }
        }

        if (promptsToSave.length > 0 && typeof StorageManager !== 'undefined') {
            // Dedup by domMessageId when available, otherwise text + occurrenceNumber
            const uniquePrompts = [];
            const seenKeys = new Set();

            for (const p of promptsToSave) {
                const key = p.domMessageId || (p.prompt.trim() + '||occ:' + p.occurrenceNumber);
                if (!seenKeys.has(key)) {
                    uniquePrompts.push(p);
                    seenKeys.add(key);
                }
            }

            const baseUrl = window.location.href.split('?')[0].split('#')[0];
            const hashData = uniquePrompts.map(p =>
                p.prompt.trim() + '|idx:' + p.messageIndex + '|' + (p.answer ? p.answer.length : 0) + '|imgs:' + (p.promptImages ? p.promptImages.length : 0)
            );
            const currentHash = JSON.stringify({ url: baseUrl, texts: hashData });

            if (currentHash === lastScrapedHash) return;
            lastScrapedHash = currentHash;

            try {
                if (uniquePrompts.length > 0) await StorageManager.savePrompts(uniquePrompts);
                window.dispatchEvent(new CustomEvent('ais-history-update'));
            } catch (e) {
                console.error("ChatTrack: Error saving prompts:", e?.message || JSON.stringify(e) || e);
            }
        }
    }, 1200);
}

function watchUrlChanges() {
    if (watchInterval) clearInterval(watchInterval);
    watchInterval = setInterval(() => {
        if (!checkContext()) return;
        if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            console.log("ChatTrack: Chat switched, scraping history...");
            scrapeAllMessages();
        }
    }, 2000);
}

function observeChat() {
    if (chatObserver) chatObserver.disconnect();

    chatObserver = new MutationObserver(() => {
        if (!checkContext()) return;
        clearTimeout(scrapeTimer);
        scrapeTimer = setTimeout(() => {
            scrapeAllMessages();
        }, 800);
    });

    chatObserver.observe(document.body, { childList: true, subtree: true });
    handleMissingAnswersInterval();
}

function handleMissingAnswersInterval() {
    if (answerInterval) clearInterval(answerInterval);
    answerInterval = setInterval(() => { checkForMissingAnswers(); }, 3000);
}

async function checkForMissingAnswers() {
    if (!checkContext()) return;
    const platformInfo = getPlatform();
    if (!platformInfo.selector || !platformInfo.answerSelector) return;
    const userMessages = document.querySelectorAll(platformInfo.selector);
    const answerMessages = document.querySelectorAll(platformInfo.answerSelector);
    if (userMessages.length > 0 && answerMessages.length >= userMessages.length) {
        scrapeAllMessages();
    }
}

function highlightAndScroll(el) {
    el.scrollIntoView({ behavior: 'instant', block: 'center' });
    const originalBg = el.style.backgroundColor;
    const originalTransition = el.style.transition;
    el.style.transition = "background-color 0.5s ease";
    el.style.backgroundColor = "rgba(187, 134, 252, 0.3)";
    setTimeout(() => {
        el.style.backgroundColor = originalBg;
        setTimeout(() => { el.style.transition = originalTransition; }, 500);
    }, 2000);
}

/**
 * Scroll to a specific prompt in the chat.
 *
 * TIER 1 — domMessageId: querySelector by platform's own UUID. Direct, no counting.
 * TIER 2 — occurrenceNumber: walk page top-bottom, find the Nth match.
 * TIER 3 — first text match: fallback for old data with no metadata.
 *
 * NOTE: occurrenceNumber is passed here, NOT messageIndex.
 * messageIndex is only for sorting in the popup. occurrenceNumber is for navigation.
 */
function scrollToMessage(text, occurrenceNumber, domMessageId) {
    const platformInfo = getPlatform();
    if (!platformInfo.selector) return false;

    const targetText = text.trim();

    // TIER 1: direct DOM lookup by platform's own message UUID
    if (domMessageId) {
        const el = document.querySelector('[data-message-id="' + domMessageId + '"]');
        if (el) {
            highlightAndScroll(el);
            return true;
        }
    }

    // TIER 2: match by placeholder [Image Prompt] or empty text + images
    const isImagePlaceholder = targetText === '[image prompt]';
    const allMatched = Array.from(document.querySelectorAll(platformInfo.selector));
    const dedupedMessages = allMatched.filter((el, idx) =>
        !allMatched.some((other, oIdx) => oIdx !== idx && other.contains(el))
    );

    function getCleanText(el) {
        let t = el.innerText.trim();
        if (platformInfo.name === 'Gemini') {
            t = t.replace(/^You\s*Said\s*/i, '').trim();
            t = t.replace(/^You\nSaid\s*/i, '').trim();
        }
        return t;
    }

    let currentMatchCount = 0;
    for (let i = 0; i < dedupedMessages.length; i++) {
        const el = dedupedMessages[i];
        const textInPage = getCleanText(el);

        let isMatch = false;
        if (isImagePlaceholder) {
            // If it's an image placeholder, match elements that are empty but have images
            const hasImages = el.querySelectorAll('img').length > 0;
            if (!textInPage && hasImages) isMatch = true;
        } else {
            isMatch = (textInPage === targetText);
        }

        if (isMatch) {
            if (currentMatchCount === occurrenceNumber) {
                highlightAndScroll(el);
                return true;
            }
            currentMatchCount++;
        }
    }

    // TIER 3: Fallback to simple first text match (legacy)
    if (!isImagePlaceholder) {
        for (const el of dedupedMessages) {
            if (getCleanText(el) === targetText) {
                highlightAndScroll(el);
                return true;
            }
        }
    }

    return false;
}

async function generateThumbnail(src, maxSize = 120) {
    if (!src) return null;

    // Helper: resize an already-loaded image to a small JPEG thumbnail
    function resizeToThumb(img) {
        const canvas = document.createElement('canvas');
        let width = img.width || img.naturalWidth;
        let height = img.height || img.naturalHeight;
        if (width > height) {
            if (width > maxSize) { height *= maxSize / width; width = maxSize; }
        } else {
            if (height > maxSize) { width *= maxSize / height; height = maxSize; }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        return canvas.toDataURL('image/jpeg', 0.6);
    }

    // For data: URLs, canvas works directly — no CORS issues
    if (src.startsWith('data:')) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { try { resolve(resizeToThumb(img)); } catch (e) { resolve(null); } };
            img.onerror = () => resolve(null);
            img.src = src;
        });
    }

    // For HTTP URLs: try direct canvas first, fall back to background proxy on CORS error
    if (src.startsWith('http')) {
        // Attempt 1: Direct canvas with crossOrigin (fast, works for permissive servers)
        const directResult = await new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => {
                try { resolve(resizeToThumb(img)); }
                catch (e) { resolve(null); } // Tainted canvas — CORS blocked
            };
            img.onerror = () => resolve(null);
            img.src = src;
        });
        if (directResult) return directResult;

        // Attempt 2: Proxy through background script (bypasses CORS/CSP)
        try {
            const response = await new Promise((resolve) => {
                if (typeof chrome === 'undefined' || !chrome.runtime?.id) return resolve(null);
                chrome.runtime.sendMessage({ action: "PROXY_IMAGE", url: src }, resolve);
            });
            if (response && response.dataUrl) {
                // The proxy returned a full-size data URL — resize it to a thumbnail
                return await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => { try { resolve(resizeToThumb(img)); } catch (e) { resolve(null); } };
                    img.onerror = () => resolve(null);
                    img.src = response.dataUrl;
                });
            }
        } catch (e) {
            console.warn('[Content] Proxy thumbnail fallback failed:', e);
        }
    }

    return null;
}


async function blobUrlToBase64(blobUrl) {
    if (!blobUrl || !blobUrl.startsWith('blob:')) return null;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                const MAX_DIM = 800; // Downscale large blobs for storage
                if (width > height && width > MAX_DIM) {
                    height *= MAX_DIM / width;
                    width = MAX_DIM;
                } else if (height > MAX_DIM) {
                    width *= MAX_DIM / height;
                    height = MAX_DIM;
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                // STORAGE OPTIMIZATION: heavily compress blob images
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            } catch (err) {
                console.warn('[Content] Canvas conversion failed:', err);
                resolve(null);
            }
        };
        img.onerror = (err) => {
            console.warn('[Content] Failed to load blob for conversion:', err);
            resolve(null);
        };
        img.src = blobUrl;
    });
}

/**
 * Convert a blob: URL to a small base64 thumbnail for sidebar display.
 * Uses the same canvas approach but with a smaller maxSize for storage efficiency.
 */
async function blobUrlToBase64Thumb(blobUrl, maxSize = 120) {
    if (!blobUrl || !blobUrl.startsWith('blob:')) return null;
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            try {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;
                if (width > height) {
                    if (width > maxSize) {
                        height *= maxSize / width;
                        width = maxSize;
                    }
                } else {
                    if (height > maxSize) {
                        width *= maxSize / height;
                        height = maxSize;
                    }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.6));
            } catch (err) {
                console.warn('[Content] Blob thumbnail conversion failed:', err);
                resolve(null);
            }
        };
        img.onerror = () => resolve(null);
        img.src = blobUrl;
    });
}

async function processAnswerHtml(html, platform) {
    if (!html) return html;

    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const imgs = doc.querySelectorAll('img');

    if (platform === 'Gemini') {
        const allImgSrcs = Array.from(imgs).map(i => i.getAttribute('src')?.substring(0, 60));
        console.log(`[Content DEBUG] Gemini imgs found: ${imgs.length}, srcs:`, allImgSrcs);
        const blobImgs = Array.from(imgs).filter(img => img.getAttribute('src')?.startsWith('blob:'));
        console.log(`[Content DEBUG] blob: imgs count: ${blobImgs.length}`);
        for (const img of blobImgs) {
            const base64 = await blobUrlToBase64(img.getAttribute('src'));
            if (base64) {
                img.setAttribute('src', base64);
                console.log('[Content DEBUG] Gemini blob image converted to base64 OK, length:', base64.length);
            } else {
                img.removeAttribute('src');
                console.log('[Content DEBUG] Gemini blob conversion FAILED');
            }
        }
    }

    imgs.forEach((img, idx) => {
        const src = img.getAttribute('src');
        const dataSrc = img.getAttribute('data-src');
        const dataOriginal = img.getAttribute('data-original');
        const srcset = img.getAttribute('srcset');

        if (!src && dataSrc) {
            img.setAttribute('src', dataSrc);
        } else if (!src && dataOriginal) {
            img.setAttribute('src', dataOriginal);
        } else if (!src && srcset) {
            const firstUrl = srcset.split(',')[0].split(' ')[0];
            if (firstUrl) img.setAttribute('src', firstUrl);
        }

        const currentSrc = img.getAttribute('src');
        if (currentSrc && !currentSrc.startsWith('http') && !currentSrc.startsWith('data:')) {
            try {
                const absoluteUrl = new URL(currentSrc, window.location.origin).href;
                img.setAttribute('src', absoluteUrl);
            } catch (e) {
                console.warn(`[ProcessHTML] Failed to convert image ${idx} URL`);
            }
        }
    });

    return doc.body.innerHTML;
}

if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (!checkContext()) return;

        if (message.action === "SCROLL_TO_PROMPT" || message.action === "SCROLL_TO_MESSAGE") {
            attemptScrollToMessage(message.text, message.occurrenceNumber, message.domMessageId)
                .then(found => {
                    if (sendResponse) sendResponse({ success: found });
                });
            return true;
        }

        if (message.action === "FETCH_LIVE_ANSWER") {
            fetchLiveAnswer(message.promptText, message.occurrenceNumber, message.domMessageId)
                .then(async (answerHtml) => {
                    if (answerHtml) {
                        const platformInfo = getPlatform();
                        let finalHtml = await processAnswerHtml(answerHtml, platformInfo.name);
                        finalHtml = cleanHtmlOfUiElements(finalHtml);
                        sendResponse({ html: finalHtml });
                    } else {
                        sendResponse(null);
                    }
                })
                .catch(err => {
                    console.error("ChatTrack: Error fetching live answer:", err);
                    sendResponse(null);
                });
            return true; // async
        }
    });
}

async function attemptScrollToMessage(text, occurrenceNumber, domMessageId, attempts = 0) {
    const found = scrollToMessage(text, occurrenceNumber, domMessageId);
    if (found) return true;

    // If not found, and we haven't exceeded attempts, try scrolling the container up.
    if (attempts < 6) {
        const platformInfo = getPlatform();
        if (platformInfo.name === 'ChatGPT') {
            // Find scroll container. ChatGPT uses a specific scroll area.
            const scrollContainer = document.querySelector('div[class*="react-scroll-to-bottom"]') || 
                                  document.querySelector('main div[class*="h-full"]') || 
                                  document.documentElement;
            
            if (scrollContainer) {
                if (scrollContainer === document.documentElement) {
                    window.scrollBy({ top: -3000, behavior: 'instant' });
                } else {
                    scrollContainer.scrollBy({ top: -3000, behavior: 'instant' });
                }
                
                // Wait for React to render virtualized elements
                await new Promise(r => setTimeout(r, 600));
                return attemptScrollToMessage(text, occurrenceNumber, domMessageId, attempts + 1);
            }
        }
    }
    
    // If still not found after scrolling attempts
    alert("Message is too far up in the history. Please scroll up manually to load older messages, then try again.");
    return false;
}



async function fetchLiveAnswer(text, occurrenceNumber, domMessageId) {
    const platformInfo = getPlatform();
    if (!platformInfo.selector) return null;

    let targetEl = null;

    // TIER 1: Match by UUID
    if (domMessageId) {
        targetEl = document.querySelector('[data-message-id="' + domMessageId + '"]');
    }

    // TIER 2: Match by text + occurrence index
    if (!targetEl) {
        const targetText = (text || '').trim();
        const userMessages = document.querySelectorAll(platformInfo.selector);
        let matchCount = 0;
        
        for (const msg of userMessages) {
            let msgText = msg.innerText.trim();
            if (!msgText && msg.querySelectorAll('img').length > 0) msgText = "[Image Prompt]";
            
            if (msgText === targetText || (targetText && msgText.includes(targetText))) {
                if (matchCount === occurrenceNumber) {
                    targetEl = msg;
                    break;
                }
                matchCount++;
            }
        }
        
        // TIER 3: Fallback first match
        if (!targetEl && targetText) {
            for (const msg of userMessages) {
                let msgText = msg.innerText.trim();
                if (!msgText && msg.querySelectorAll('img').length > 0) msgText = "[Image Prompt]";
                if (msgText === targetText || msgText.includes(targetText)) {
                    targetEl = msg;
                    break;
                }
            }
        }
    }

    if (!targetEl) return null;

    let answer = null;
    const userContainer =
        targetEl.closest('user-query') ||
        targetEl.closest('[data-testid="user-query"]') ||
        targetEl.closest('.query-container') ||
        targetEl.parentElement;

    if (userContainer) {
        let nextEl = userContainer.nextElementSibling;
        while (nextEl) {
            if (nextEl.matches && (nextEl.matches('.model-response') || nextEl.matches('[data-testid="model-response"]'))) {
                answer = nextEl.outerHTML.trim();
                break;
            }
            const responseEl = nextEl.querySelector(
                '.model-response, [data-testid="model-response"], .response-content, .answer-content, .markdown, message-content[data-message-author="model"], .prose'
            );
            if (responseEl) { answer = responseEl.outerHTML.trim(); break; }
            const hasImages = nextEl.querySelectorAll('img').length > 0;
            const hasText = nextEl.innerText.trim().length > 50;
            if (hasImages || hasText) { answer = nextEl.outerHTML.trim(); break; }
            nextEl = nextEl.nextElementSibling;
        }
    }

    if (!answer) {
        const userMessages = Array.from(document.querySelectorAll(platformInfo.selector));
        const index = userMessages.indexOf(targetEl);
        if (index !== -1) {
            const answerMessages = document.querySelectorAll(platformInfo.answerSelector);
            if (index < answerMessages.length) {
                const msgContainer = answerMessages[index].closest('.message, .response, [class*="response"]') || answerMessages[index];
                answer = msgContainer.outerHTML ? msgContainer.outerHTML.trim() : answerMessages[index].innerHTML.trim();
            }
        }
    }

    return answer;
}

// Initial Run
console.log(`ChatTrack: Content script loaded for ${getPlatform().name}`);
scrapeAllMessages();
observeChat();
watchUrlChanges();