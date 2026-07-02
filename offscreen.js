/**
 * offscreen.js - Isolated PDF rendering engine.
 * Immune to host page CSP rules. Generates PDF and sends as Base64.
 * Optimized for performance and reused state.
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "RENDER_PDF_OFFSCREEN") {
        renderPdf(message.html, message.filename);
        if (sendResponse) sendResponse({ status: "started" });
        return false;
    }
});

/**
 * Sanitize untrusted HTML to prevent XSS attacks while preserving STYLES.
 */
function sanitizeUntrustedHtml(html) {
    if (!html) return '';
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const dangerousTags = [
        'script', 'iframe', 'object', 'embed', 'form', 'input', 'textarea', 
        'link', 'meta', 'base', 'svg', 'math', 'picture', 'canvas', 'video', 'audio'
    ];
    dangerousTags.forEach(tag => {
        doc.querySelectorAll(tag).forEach(el => el.remove());
    });

    // Move any style tags from head to body (so they aren't lost by body.innerHTML)
    doc.head.querySelectorAll('style').forEach(style => {
        doc.body.insertBefore(style, doc.body.firstChild);
    });

    doc.querySelectorAll('*').forEach(el => {
        Array.from(el.attributes).forEach(attr => {
            if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
                el.removeAttribute(attr.name);
            }
        });
        if (el.tagName === 'A' && el.getAttribute('href')?.toLowerCase().startsWith('javascript:')) {
            el.setAttribute('href', '#');
        }
    });

    return doc.body.innerHTML;
}

async function renderPdf(html, filename) {
    const root = document.getElementById('render-area');
    root.innerHTML = sanitizeUntrustedHtml(html);

    // Fix image display and force immediate loading
    const images = Array.from(root.querySelectorAll('img'));
    images.forEach(img => {
        const src = img.getAttribute('src');
        if (src && src.startsWith('data:')) {
            img.style.display = 'block';
            img.style.maxWidth = '100%';
            img.style.height = 'auto';
            img.crossOrigin = 'anonymous';
        }
    });

    // Wait for all images to settle
    if (images.length > 0) {
        await Promise.all(images.map(img => {
            return new Promise((resolve) => {
                if (img.complete && img.naturalHeight !== 0) {
                    resolve();
                } else {
                    img.onload = () => resolve();
                    img.onerror = () => resolve();
                    // Shorter timeout for images that are already data URLs
                    setTimeout(resolve, 5000);
                }
            });
        }));
    }

    // Force a single reflow/paint cycle
    root.offsetHeight; 

    // Minimal delay to ensure styles are applied
    await new Promise(resolve => setTimeout(resolve, 200));

    const opt = {
        margin: [15, 15, 15, 15],
        filename: filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
            scale: 1.5,
            useCORS: false,
            letterRendering: true,
            allowTaint: true,
            backgroundColor: '#ffffff',
            removeContainer: false
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: {
            mode: ['css', 'legacy'],
            avoid: 'img, table, pre, blockquote, h1, h2, h3, h4, h5, h6, [class*="code-block"], [class*="code-container"], figure, .prompt-section'
        }
    };

    try {
        const dataUrl = await html2pdf().from(root).set(opt).output('datauristring');
        chrome.runtime.sendMessage({ action: "PDF_RENDER_COMPLETE", dataUrl: dataUrl, filename: filename });
    } catch (err) {
        console.error("[Offscreen] Render Error:", err);
        chrome.runtime.sendMessage({ action: "PDF_RENDER_ERROR", error: err.message });
    } finally {
        root.innerHTML = "";
    }
}
