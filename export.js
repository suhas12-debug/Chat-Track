/**
 * ExportHelper - Refactored for v1.0.5 Gemini-Safe Image Support.
 * Uses Background Super-Proxy for 100% CSP Bypass.
 */
const ExportHelper = {
    /**
     * Checks if the extension context is still valid.
     */
    isContextValid: function () {
        return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
    },

    /**
     * Export HTML content to PDF via Offscreen Document.
     * Includes pre-conversion of images to Base64 via Background Proxy.
     * @param {string} htmlContent - The innerHTML to export
     * @param {string} platform - Optional platform name. Auto-detected if omitted.
     */
    toPdf: async function (htmlContent, platform = null) {
        if (!htmlContent || !htmlContent.trim()) return;

        if (!platform) {
            platform = this.getPlatformFromUrl(window.location.href);
        }

        // Step 1: Pre-process images to Base64 via Background Proxy (Gemini Fix)
        const processedHtml = await this.proxyImagesToBase64(htmlContent);

        // Step 2: Final sanitization
        const cleanBodyHtml = this.sanitizeHtml(processedHtml);
        const datestamp = this.getDatestamp();
        const filename = `${platform.toLowerCase().split(' ')[0]}-export-${datestamp}.pdf`;

        const fullHtml = `
            <style>
                * { -webkit-print-color-adjust: exact !important; box-sizing: border-box !important; }
                body { 
                    padding: 40px 50px; color: #1a1a1a !important; 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                    line-height: 1.8; background: #fff !important; margin: 0;
                    font-size: 15px;
                }
                #pdf-root, #pdf-root *:not(img) { 
                    background-color: transparent !important; 
                    color: #1a1a1a !important;
                    max-width: 100% !important;
                }
                .platform-name {
                    font-size: 10px !important;
                    font-weight: 700 !important;
                    color: #999 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 2px !important;
                    margin: 0 0 4px 0 !important;
                    display: block !important;
                }
                .doc-header { 
                    font-size: 36px !important;
                    font-weight: 900 !important;
                    color: #111 !important;
                    margin: 0 0 10px 0 !important;
                    line-height: 1 !important;
                }
                .header-divider {
                    border: none !important;
                    border-top: 1px solid #ddd !important;
                    margin: 0 0 40px 0 !important;
                    width: 100% !important;
                }
                pre, blockquote, img, li, table {
                    page-break-inside: avoid !important;
                    break-inside: avoid !important;
                }
                pre { 
                    background: #f6f8fa !important; border-radius: 6px; padding: 16px; 
                    margin: 15px 0; border: 1px solid #e1e4e8;
                    overflow-x: auto;
                    white-space: pre-wrap !important;
                    word-wrap: break-word !important;
                    font-size: 0.9rem !important;
                }
                code { font-family: monospace; white-space: pre-wrap !important; }
                [class*="code-block"]:not(pre):not(code),
                [class*="code-container"]:not(pre):not(code) {
                    background: transparent !important;
                    border: none !important;
                    padding: 0 !important;
                    box-shadow: none !important;
                }
                h1, h2, h3, h4, h5, h6 { page-break-after: avoid !important; break-after: avoid !important; font-weight: 700; margin-top: 25px; }
                p { orphans: 3; widows: 3; margin: 0 0 15px 0; }
                table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                th, td { border: 1px solid #ddd; padding: 12px; text-align: left; }
                th { background-color: #f8f8f8 !important; }
                blockquote { 
                    margin: 20px 0; padding: 10px 20px; color: #555 !important; 
                    border-left: 4px solid #bb86fc; background: #f9f9f9 !important;
                }
                img { 
                    max-width: 100% !important; 
                    height: auto !important; 
                    display: block; 
                    margin: 20px 0; 
                    border-radius: 6px;
                }
            </style>
            <div id="pdf-root">
                <div class="platform-name">${this.escapeHtmlForPdf(platform)}</div>
                <div class="doc-header">ChatTrack</div>
                <hr class="header-divider">
                ${cleanBodyHtml}
            </div>
        `

        return new Promise((resolve) => {
            if (!this.isContextValid()) {
                const msg = "ChatTrack has been reloaded. Please refresh this page to continue.";
                alert(msg);
                console.warn(msg);
                return resolve();
            }
            chrome.runtime.sendMessage({
                action: "GENERATE_PDF",
                html: fullHtml,
                filename: filename
            });
            resolve();
        });
    },

    /**
     * Proxy images to Base64 via Background script for CSP bypass.
     * Used by Custom PDF to keep images in the export.
     * Handles ChatGPT grid layouts, button wrappers, and overlay elements.
     */
    proxyImagesToBase64: async function (html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Step 1: Remove UI overlay buttons (keep those wrapping images)
        const btnSelectors = [
            'button[aria-label*="Download"]', 'button[aria-label*="image"]',
            'button[aria-label*="View"]', 'button[aria-label*="Search"]', 'button[aria-label*="Share"]'
        ];
        doc.querySelectorAll(btnSelectors.join(',')).forEach(btn => {
            if (!btn.querySelector('img')) btn.remove();
        });

        // Step 2: Extract each image from its individual wrapper into a bare <img>.
        // We collect all (mediaRoot → cleanImg) pairs FIRST, then apply replacements,
        // to avoid DOM mutation issues when iterating (a replaced node makes siblings stale).
        const replacements = [];

        doc.querySelectorAll('img').forEach(img => {
            const src = img.getAttribute('src') || '';
            const alt = img.getAttribute('alt') || '';

            let mediaRoot = img;
            let current = img.parentElement;
            while (current && current !== doc.body) {
                // Stop if this ancestor contains more than one image (shared grid)
                if (current.querySelectorAll('img').length > 1) break;
                const clone = current.cloneNode(true);
                clone.querySelectorAll('img').forEach(i => i.remove());
                const text = clone.textContent.trim();
                // Stop if this ancestor has real text
                if (text !== '' && !/^\d{1,2}$/.test(text)) break;
                mediaRoot = current;
                current = current.parentElement;
            }

            const cleanImg = doc.createElement('img');
            cleanImg.setAttribute('src', src);
            if (alt) cleanImg.setAttribute('alt', alt);
            cleanImg.style.cssText = 'display:block !important;max-width:100% !important;width:auto !important;height:auto !important;margin:15px 0 !important;';

            if (mediaRoot !== img) {
                replacements.push({ mediaRoot, cleanImg });
            } else {
                // No wrapper found — just update styles in place
                img.style.cssText = cleanImg.style.cssText;
            }
        });

        // Apply replacements in reverse DOM order to avoid position shifting
        replacements.reverse().forEach(({ mediaRoot, cleanImg }) => {
            if (mediaRoot.parentNode) {
                mediaRoot.parentNode.replaceChild(cleanImg, mediaRoot);
            }
        });

        // Step 3: Proxy all images to base64 in parallel
        const imgs = Array.from(doc.querySelectorAll('img'));
        console.log(`[Export] Processing ${imgs.length} images for PDF in parallel`);

        await Promise.all(imgs.map(async (img) => {
            // Use data-src if src is a tiny placeholder (lazy-loaded)
            const dataSrc = img.getAttribute('data-src') || img.getAttribute('data-original');
            let src = img.getAttribute('src');
            if (dataSrc && dataSrc.startsWith('http') && (!src || src.length < 50 || src.includes('1x1') || src.includes('placeholder'))) {
                src = dataSrc;
                img.setAttribute('src', src);
            }

            if (!src) { img.remove(); return; }

            // Already base64 (blob converted by content.js) — keep as-is
            if (src.startsWith('data:')) return;

            // Dead blob — skip
            if (src.startsWith('blob:')) { img.remove(); return; }

            // Proxy https: image via background script
            try {
                const response = await new Promise((resolve) => {
                    if (!this.isContextValid()) return resolve(null);
                    chrome.runtime.sendMessage({ action: "PROXY_IMAGE", url: src }, resolve);
                });
                if (response && response.dataUrl) {
                    img.setAttribute('src', response.dataUrl);
                } else {
                    console.log(`[Export] Proxy failed: ${src.substring(0, 60)} — ${response?.error}`);
                    img.remove();
                }
            } catch (err) {
                console.log(`[Export] Proxy error:`, err);
                img.remove();
            }
        }));

        return doc.body.innerHTML;
    },

    /**
     * Strip all images from HTML — used for prompt PDF exports.
     * Removes images and their containers cleanly without leaving blank space.
     * Handles ChatGPT grid layouts, button wrappers, figures, etc.
     */
    stripImages: function (html) {
        if (!html) return html;
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Step 0: Add placeholders for images before they and their wrappers get deleted
        let imgCount = 0;
        doc.querySelectorAll('img').forEach(img => {
            // Create the placeholder text element
            const placeholder = doc.createElement('div');
            placeholder.className = 'image-placeholder';
            // Emulate Gemini's slick grey inline look
            placeholder.innerHTML = `<span style="background-color: #f4f4f4; border: 1px solid #ddd; padding: 4px 8px; border-radius: 4px; font-family: monospace; color: #555;">[image_${imgCount}.png]</span>`;
            placeholder.style.margin = '10px 0';
            placeholder.style.display = 'block';

            // Find the outermost container that is exclusively meant for media
            // We do this so we can insert the placeholder OUTSIDE of it, preventing the 
            // container's tall Tailwind height classes from leaving a huge blank space.
            let highestMediaContainer = img;
            let current = img.parentElement;

            while (current && current !== doc.body) {
                // Clone and remove all images to see if this container holds actual text
                const clone = current.cloneNode(true);
                clone.querySelectorAll('img').forEach(i => i.remove());
                const text = clone.textContent.trim();

                const isStrayDigit = /^\d+$/.test(text) && text.length <= 2;

                // If the container has real text, it's not a purely-media wrapper. Stop climbing.
                if (text !== '' && !isStrayDigit) {
                    break;
                }

                highestMediaContainer = current;
                current = current.parentElement;
            }

            // Insert placeholder OUTSIDE the media container
            if (highestMediaContainer && highestMediaContainer.parentNode) {
                highestMediaContainer.parentNode.insertBefore(placeholder, highestMediaContainer);
                highestMediaContainer.classList.add('chat-track-mark-delete');
                imgCount++;
            }
        });

        // Immediately annihilate the marked media containers to prevent huge blank spaces
        doc.querySelectorAll('.chat-track-mark-delete').forEach(el => el.remove());

        // Step 1: Remove DALL-E image containers aggressively (ChatGPT specific)
        // This targets the grid or the wrapper that would otherwise leave a blank space
        const dalleSelectors = [
            '[data-testid*="dalle-image"]',
            '[data-testid*="image-container"]',
            '[data-testid*="image-grid"]',
            '.grid.grid-cols-2',
            '.grid.gap-2',
            '[class*="aspect-square"]',
            '[class*="image-wrapper"]'
        ];
        dalleSelectors.forEach(sel => {
            doc.querySelectorAll(sel).forEach(el => el.remove());
        });

        // Step 2: Remove figure/picture elements (often contain images)
        doc.querySelectorAll('figure, picture').forEach(el => el.remove());

        // Step 3: Remove buttons that wrap images (ChatGPT DALL-E)
        doc.querySelectorAll('button').forEach(btn => {
            if (btn.querySelector('img') || btn.querySelector('[data-testid*="image"]')) {
                btn.remove();
            }
        });

        // Step 4: Remove any remaining img tags
        doc.querySelectorAll('img').forEach(img => img.remove());

        // Step 5: Remove SVGs (icons, decorations)
        doc.querySelectorAll('svg').forEach(svg => svg.remove());

        // Step 6: Remove elements with background-image
        doc.querySelectorAll('[style*="background-image"]').forEach(el => el.remove());

        // Step 7: Multi-pass cleanup of empty or near-empty containers
        // This now also cleans up stray digits (like the image count "4")
        for (let pass = 0; pass < 3; pass++) {
            doc.querySelectorAll('div, p, span, section, article, a, figure').forEach(el => {
                const text = el.textContent?.trim() || '';
                const hasChildren = el.querySelector('div, p, span, pre, code, table, ul, ol, h1, h2, h3, h4, h5, h6, blockquote, img');

                // Remove if it's truly empty, ONLY whitespace, or ONLY a single digit (like image count)
                const isStrayDigit = /^\d+$/.test(text) && text.length <= 2;
                if ((text === '' && !hasChildren) || (isStrayDigit && !hasChildren)) {
                    el.remove();
                }
            });
        }

        console.log(`[Export] Stripped all images and empty containers from prompt export.`);
        return doc.body.innerHTML;
    },

    sanitizeHtml: function (html) {
        if (!html) return '';
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const allElements = doc.querySelectorAll('*');
        allElements.forEach(el => {
            try {
                // Never touch IMG elements — their src/dimensions were set by proxyImagesToBase64
                if (el.tagName === 'IMG') {
                    el.style.setProperty('display', 'block', 'important');
                    el.style.setProperty('max-width', '100%', 'important');
                    el.style.setProperty('height', 'auto', 'important');
                    el.style.setProperty('margin', '15px 0', 'important');
                    return;
                }
                // NUCLEAR STYLE RESET: Clear problematic site-inherited styles
                const style = el.getAttribute('style');
                if (style) {
                    const parts = style.split(';');
                    const cleaned = parts.filter(p => {
                        const lp = p.toLowerCase();
                        // Strip layout-breaking, visibility-breaking, AND border/shadow properties
                        // BUT PRESERVE white-space if it's already pre-like to avoid collapsing code lines
                        if (lp.includes('white-space: pre') || lp.includes('white-space: break-spaces')) return true;

                        return !(
                            lp.includes('oklch') || lp.includes('lch') || lp.includes('color-mix') ||
                            lp.includes('color:') || lp.includes('background:') || lp.includes('background-color:') ||
                            lp.includes('opacity') || lp.includes('filter') ||
                            lp.includes('display: flex') || lp.includes('display: grid') ||
                            lp.includes('width:') || lp.includes('min-width:') || lp.includes('max-width:') ||
                            lp.includes('height:') || lp.includes('min-height:') || lp.includes('max-height:') ||
                            lp.includes('position: fixed') || lp.includes('position: absolute') ||
                            lp.includes('border') || lp.includes('outline') || lp.includes('box-shadow') || lp.includes('text-shadow')
                        );
                    });

                    // Always force block-level behavior for full-width reset if it was a container
                    if (el.tagName === 'DIV' || el.tagName === 'SECTION' || el.tagName === 'ARTICLE') {
                        cleaned.push('width: 100% !important');
                        cleaned.push('max-width: 100% !important');
                        cleaned.push('display: block !important');
                    }

                    el.setAttribute('style', cleaned.join(';'));
                }

                // Extra check for prose blocks that might have inline color
                // Use setProperty with important to override site-level !important
                el.style.setProperty('color', '#000', 'important');
                el.style.setProperty('background-color', 'transparent', 'important');
                el.style.setProperty('border', 'none', 'important');
                el.style.setProperty('box-shadow', 'none', 'important');
                el.style.setProperty('outline', 'none', 'important');

                const text = el.textContent || "";
                if (el.tagName === 'SPAN' && text.match(/^\[\d+\]$/)) {
                    el.style.fontSize = '0.7em';
                    el.style.verticalAlign = 'super';
                    el.style.color = '#777';
                }

                const isPre = el.tagName === 'PRE';
                const isCodeTag = el.tagName === 'CODE';
                const isCodeClass =
                    el.classList.contains('code-block') ||
                    el.classList.contains('prose-code') ||
                    (el.getAttribute('class') && el.getAttribute('class').toLowerCase().includes('code'));

                const isCodeElement = isPre || isCodeTag || isCodeClass;

                if (isCodeElement) {
                    // Determine if this is INLINE code (inside a paragraph/list)
                    // or BLOCK code (a PRE element or CODE that is a direct child of a block container)
                    const parentTag = el.parentElement?.tagName || '';
                    const isInsidePre = el.closest('pre') !== null && !isPre;
                    const isInlineCode = isCodeTag && !isPre &&
                        (parentTag === 'P' || parentTag === 'LI' || parentTag === 'SPAN' ||
                            parentTag === 'TD' || parentTag === 'TH' || parentTag === 'H1' ||
                            parentTag === 'H2' || parentTag === 'H3' || parentTag === 'H4' ||
                            parentTag === 'H5' || parentTag === 'H6' || parentTag === 'STRONG' ||
                            parentTag === 'EM' || parentTag === 'A' || parentTag === 'LABEL' ||
                            // Also treat as inline if sibling text nodes exist
                            Array.from(el.parentElement?.childNodes || []).some(
                                n => n.nodeType === 3 && n.textContent.trim() !== ''
                            ));

                    // FIX: Gemini double-box — if a code-class DIV already contains a <pre>,
                    // it is just the outer wrapper (language header + pre). Don't style it as
                    // a box; make it transparent and let the inner <pre> carry the visual box.
                    const isOuterCodeWrapper = isCodeClass && !isPre && !isCodeTag && el.querySelector('pre');

                    el.style.setProperty('font-family', 'monospace', 'important');

                    if (isOuterCodeWrapper) {
                        // Transparent passthrough wrapper — no border, no background
                        el.style.setProperty('display', 'block', 'important');
                        el.style.setProperty('background-color', 'transparent', 'important');
                        el.style.setProperty('border', 'none', 'important');
                        el.style.setProperty('padding', '0', 'important');
                        el.style.setProperty('margin', '12px 0', 'important');
                        el.style.setProperty('box-shadow', 'none', 'important');
                        // Keep the whole block (wrapper + pre) together across pages
                        el.style.setProperty('page-break-inside', 'avoid', 'important');
                        el.style.setProperty('break-inside', 'avoid', 'important');
                    } else if (isInlineCode) {
                        // INLINE code — stays in the text flow, just styled subtly
                        el.style.setProperty('display', 'inline', 'important');
                        el.style.setProperty('background-color', '#f0f0f0', 'important');
                        el.style.setProperty('color', '#c7254e', 'important');
                        el.style.setProperty('padding', '1px 4px', 'important');
                        el.style.setProperty('border-radius', '3px', 'important');
                        el.style.setProperty('font-size', '0.9em', 'important');
                        el.style.setProperty('border', 'none', 'important');
                        el.style.setProperty('white-space', 'nowrap', 'important');
                    } else if (isInsidePre) {
                        // Inside a PRE block — transparent, no extra styling
                        el.style.setProperty('background-color', 'transparent', 'important');
                        el.style.setProperty('border', 'none', 'important');
                        el.style.setProperty('padding', '0', 'important');
                        el.style.setProperty('margin', '0', 'important');
                        el.style.setProperty('white-space', 'pre-wrap', 'important');
                        el.style.setProperty('word-wrap', 'break-word', 'important');
                    } else {
                        // BLOCK code (PRE or standalone code block) — full box styling
                        el.style.setProperty('display', 'block', 'important');
                        el.style.setProperty('width', '100%', 'important');
                        el.style.setProperty('background-color', '#f4f4f4', 'important');
                        el.style.setProperty('padding', '12px 15px', 'important');
                        el.style.setProperty('margin', '12px 0', 'important');
                        el.style.setProperty('border', '1px solid #ddd', 'important');
                        el.style.setProperty('border-radius', '6px', 'important');
                        el.style.setProperty('white-space', 'pre-wrap', 'important');
                        el.style.setProperty('word-wrap', 'break-word', 'important');
                        el.style.setProperty('font-size', '0.88rem', 'important');
                        el.style.setProperty('line-height', '1.5', 'important');
                        el.style.setProperty('overflow-x', 'auto', 'important');
                        // Keep code blocks from splitting across pages
                        el.style.setProperty('page-break-inside', 'avoid', 'important');
                        el.style.setProperty('break-inside', 'avoid', 'important');
                    }
                }

                // Keep paragraphs and list items from orphaning at page boundaries
                if (el.tagName === 'P' || el.tagName === 'LI') {
                    el.style.setProperty('orphans', '3', 'important');
                    el.style.setProperty('widows', '3', 'important');
                }

                // Keep headings glued to the content that follows them
                if (/^H[1-6]$/.test(el.tagName)) {
                    el.style.setProperty('page-break-after', 'avoid', 'important');
                    el.style.setProperty('break-after', 'avoid', 'important');
                }

                // Keep tables and blockquotes intact across pages
                if (el.tagName === 'TABLE' || el.tagName === 'BLOCKQUOTE' || el.tagName === 'FIGURE') {
                    el.style.setProperty('page-break-inside', 'avoid', 'important');
                    el.style.setProperty('break-inside', 'avoid', 'important');
                }
            } catch (e) {
                console.warn("[Export] Element sanitization skipped for one node:", e);
            }
        });
        return doc.body.innerHTML;
    },

    getDatestamp: function () {
        return new Date().toISOString().split('T')[0];
    },

    /**
     * Export a specific prompt with its answer to PDF.
     * @param {string} prompt - The user prompt text
     * @param {string} answer - The AI answer HTML
     * @param {string} platform - The platform name
     * @param {number} index - The prompt index for filename
     */
    exportPromptAnswer: async function (prompt, answer, platform, index = 1, domMessageId = null, occurrenceNumber = 0) {
        if (!prompt) return;

        // Step 1: Fetch LIVE answer HTML from the DOM via background → content script.
        // Gemini Imagen images are blob: URLs that only live in the page's memory.
        // export.js runs as a content script so we route through background (has chrome.tabs).
        let answerToProcess = answer;
        try {
            const liveResult = await new Promise((resolve) => {
                if (!this.isContextValid()) return resolve(null);
                chrome.runtime.sendMessage({
                    action: "FETCH_LIVE_ANSWER_VIA_TAB",
                    promptText: prompt,
                    platform: platform,
                    domMessageId: domMessageId,      // Pass unique ID
                    occurrenceNumber: occurrenceNumber // Pass unique Index
                }, (response) => {
                    if (chrome.runtime.lastError) resolve(null);
                    else resolve(response || null);
                });
            });
            if (liveResult && liveResult.html) {
                console.log('[Export] Got live answer from DOM');
                answerToProcess = liveResult.html;
            } else {
                console.log('[Export] Live fetch returned nothing, using stored answer');
            }
        } catch (e) {
            console.warn('[Export] Live answer fetch failed, using stored answer:', e);
        }

        // Step 2: Proxy any remaining https: images to base64 via background script
        let processedAnswer = '';
        try {
            processedAnswer = answerToProcess ? await this.proxyImagesToBase64(answerToProcess) : '';
        } catch (err) {
            console.error('[Export] proxyImagesToBase64 failed, falling back to stripImages:', err);
            processedAnswer = answerToProcess ? this.stripImages(answerToProcess) : '';
        }

        const cleanAnswerHtml = this.sanitizeHtml(processedAnswer);

        // Check if answer is meaningful (not just whitespace or empty tags)
        const hasMeaningfulContent = cleanAnswerHtml &&
            cleanAnswerHtml.replace(/<[^>]*>/g, '').trim().length > 0;

        const datestamp = this.getDatestamp();
        const filename = `${platform.toLowerCase()}-conversation-${index}-${datestamp}.pdf`;

        const fullHtml = `
            <style>
                * { -webkit-print-color-adjust: exact !important; box-sizing: border-box !important; }
                body { 
                    padding: 40px 50px; color: #1a1a1a !important; 
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; 
                    line-height: 1.8; background: #fff !important; margin: 0;
                    font-size: 15px;
                }
                #pdf-root, #pdf-root *:not(img) { 
                    background-color: transparent !important; 
                    color: #1a1a1a !important;
                    max-width: 100% !important;
                }
                .platform-name {
                    font-size: 10px !important;
                    font-weight: 700 !important;
                    color: #999 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 2px !important;
                    margin: 0 0 4px 0 !important;
                    display: block !important;
                }
                .doc-header { 
                    font-size: 36px !important;
                    font-weight: 900 !important;
                    color: #111 !important;
                    margin: 0 0 10px 0 !important;
                    line-height: 1 !important;
                }
                .header-divider {
                    border: none !important;
                    border-top: 1px solid #ddd !important;
                    margin: 0 0 40px 0 !important;
                    width: 100% !important;
                }
                /* Prompt section with purple left bar */
                .prompt-section {
                    border-left: 3px solid #8b5cf6 !important;
                    padding: 5px 0 5px 35px !important;
                    margin-bottom: 50px !important;
                    position: relative !important;
                }
                .prompt-label {
                    font-size: 12px !important;
                    font-weight: 800 !important;
                    color: #888 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 1px !important;
                    margin-bottom: 15px !important;
                }
                .prompt-text {
                    font-size: 1.15rem !important;
                    line-height: 1.75 !important;
                    white-space: pre-wrap !important;
                    word-break: break-word !important;
                    color: #1a1a1a !important;
                    margin: 0 !important;
                }
                /* AI Response section */
                .answer-label {
                    font-size: 12px !important;
                    font-weight: 800 !important;
                    color: #888 !important;
                    text-transform: uppercase !important;
                    letter-spacing: 1px !important;
                    margin-bottom: 20px !important;
                    display: block !important;
                }
                .answer-section { padding: 0; }
                .answer-content { font-size: 1.05rem; line-height: 1.8; }
                
                /* Headings */
                h1, h2, h3, h4, h5, h6 { font-weight: 700; margin-top: 25px; page-break-after: avoid; }
                p { margin: 0 0 15px; page-break-inside: avoid; orphans: 3; widows: 3; }
                
                /* Code */
                pre {
                    background: #f6f8fa !important;
                    border: 1px solid #e1e4e8 !important;
                    border-radius: 6px !important;
                    padding: 16px !important;
                    margin: 15px 0 !important;
                    overflow-x: auto;
                    white-space: pre-wrap !important;
                    word-wrap: break-word !important;
                    font-size: 0.9rem !important;
                    page-break-inside: avoid !important;
                }
                pre code { background: transparent !important; color: #1a1a1a !important; display: block !important; }
                code:not(pre code) { background: #f0f0f0 !important; color: #c7254e !important; padding: 2px 5px !important; border-radius: 3px !important; }

                /* Lists & Tables */
                ul, ol { margin: 10px 0 20px 25px; }
                li { margin-bottom: 8px; page-break-inside: avoid; }
                table { width: 100%; border-collapse: collapse; margin: 25px 0; font-size: 0.95rem; page-break-inside: avoid; }
                th { background: #f8f8f8 !important; font-weight: 700; text-align: left; }
                th, td { border: 1px solid #ddd !important; padding: 12px; vertical-align: top; }
                
                /* Images */
                img { 
                    max-width: 100% !important; height: auto !important; 
                    display: block !important; margin: 25px 0 !important; 
                    border-radius: 8px; page-break-inside: avoid !important;
                }
                blockquote { 
                    border-left: 4px solid #bb86fc !important; background: #fafafa !important;
                    padding: 10px 20px !important; margin: 20px 0 !important; font-style: italic;
                }
                hr { border: none; border-top: 1px solid #eee; margin: 30px 0; }
                pre, blockquote, table, figure { page-break-inside: avoid !important; break-inside: avoid !important; }
            </style>
            <div id="pdf-root">
                <div class="platform-name">${this.escapeHtmlForPdf(platform)}</div>
                <div class="doc-header">ChatTrack</div>
                <hr class="header-divider">
                
                <div class="prompt-section">
                    <div class="prompt-label">YOUR PROMPT</div>
                    <div class="prompt-text">${this.escapeHtmlForPdf(prompt)}</div>
                </div>
            
                ${hasMeaningfulContent ? `
                <div class="answer-section">
                    <div class="answer-label">AI RESPONSE</div>
                    <div class="answer-content">${cleanAnswerHtml}</div>
                </div>
                ` : '<div style="color: #999; font-style: italic; padding: 20px; text-align: center;">No answer captured for this prompt.</div>'}
            </div>
        `

        return new Promise((resolve) => {
            if (!this.isContextValid()) {
                const msg = "ChatTrack has been reloaded. Please refresh this page to continue.";
                alert(msg);
                console.warn(msg);
                return resolve();
            }
            chrome.runtime.sendMessage({
                action: "GENERATE_PDF",
                html: fullHtml,
                filename: filename
            });
            resolve();
        });
    },

    escapeHtmlForPdf: function (text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    getPlatformFromUrl: function (url) {
        if (!url) return 'AI CONVERSATION';
        const low = url.toLowerCase();
        if (low.includes('chatgpt.com')) return 'CHATGPT';
        if (low.includes('gemini.google.com')) return 'GEMINI';
        if (low.includes('claude.ai')) return 'CLAUDE';
        if (low.includes('perplexity.ai')) return 'PERPLEXITY';
        return 'AI CONVERSATION';
    }
};
