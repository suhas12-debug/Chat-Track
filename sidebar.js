/**
 * sidebar.js - Handles injection and management of the in-page sidebar.
 * Optimized for local chat history and navigation.
 */

(function () {
    if (window.hasAisHistorySidebar) return;
    window.hasAisHistorySidebar = true;

    // Pre-warm the PDF offscreen engine on injection
    chrome.runtime.sendMessage({ action: "PREWARM_OFFSCREEN" });

    // --- Template & Styles ---
    const sidebarHtml = `
        <div id="sidebar-container" class="hidden">
            <header>
                <h1>ChatTrack</h1>
                <div style="display: flex; gap: 8px; align-items: center;">
                    <!-- Performance mode removed -->
                    <button id="close-sidebar" title="Close">×</button>
                </div>
            </header>
            


            <div class="composer-section">
                <div class="composer-header">
                    <span>Custom PDF</span>
                    <button id="sidebar-export-pdf" class="btn-icon">PDF</button>
                </div>
                <div id="sidebar-composer-input" contenteditable="true" placeholder="Paste or type content here for PDF..."></div>
            </div>

            <div class="controls">
                <input type="text" id="sidebar-search" placeholder="Search prompts..." />
                <div class="filter-row">
                    <select id="sidebar-sort">
                        <option value="newest">Newest</option>
                        <option value="oldest">Oldest</option>
                    </select>
                    <label class="toggle-label">
                        <input type="checkbox" id="sidebar-bookmark-filter"> ⭐
                    </label>
                </div>
            </div>

            <main id="sidebar-list">
                <div class="loading">Loading...</div>
            </main>

            <div class="danger-zone">
                <div id="storage-stats" style="font-size: 0.7rem; color: #888; text-align: center; margin-bottom: 8px;">
                    Storage: <span id="storage-count">0</span>/5000 prompts
                </div>
                <button id="sidebar-clear-all" class="danger">Clear History</button>
            </div>
        </div>
        <button id="sidebar-toggle-btn">📜</button>
    `;

    // Inject host
    const host = document.createElement('div');
    host.id = 'ai-history-sidebar-host';
    // Fix for Mac/Webkit: Explicitly set host dimensions and pointer events
    host.style.position = 'fixed';
    host.style.top = '0';
    host.style.right = '0';
    host.style.width = '0'; // Grow inside shadow if needed, or keep 0 to not block page
    host.style.height = '100vh';
    host.style.zIndex = '999999';
    host.style.pointerEvents = 'none';
    document.body.appendChild(host);

    // Ensure the sidebar stays in the DOM even if the SPA (ChatGPT) re-renders the body
    setInterval(() => {
        if (host && !host.parentNode && document.body) {
            document.body.appendChild(host);
        }
    }, 1000);

    const shadow = host.attachShadow({ mode: 'open' });

    // Inject Styles
    const styleLink = document.createElement('style');
    styleLink.textContent = `
        :host { --accent: #bb86fc; --bg: #121212; --card: #1e1e1e; --text: #e0e0e0; --danger: #cf6679; --border: #333; pointer-events: none; }
        #sidebar-container {
            position: fixed; top: 0; right: 0; width: 320px; height: 100vh;
            background: var(--bg); color: var(--text); z-index: 999999;
            display: flex; flex-direction: column; border-left: 1px solid var(--border);
            transition: transform 0.3s ease; box-shadow: -5px 0 15px rgba(0,0,0,0.5);
            font-family: sans-serif; pointer-events: auto;
            overscroll-behavior: contain;
        }
        #sidebar-container.hidden { transform: translateX(100%); }
        header { padding: 16px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--border); }
        header h1 { font-size: 1.1rem; margin: 0; }
        #close-sidebar { background: none; border: none; color: white; font-size: 1.5rem; cursor: pointer; }
        .composer-section { padding: 12px; border-bottom: 1px solid var(--border); background: #1a1a1a; }
        .composer-header { display: flex; justify-content: space-between; align-items: center; font-size: 0.75rem; margin-bottom: 8px; color: #888; }
        #sidebar-composer-input { 
            width: 100%; height: 80px; padding: 8px; border-radius: 4px; border: 1px solid #444; 
            background: #222; color: white; box-sizing: border-box; resize: none; font-size: 0.8rem; 
            overflow-y: auto; white-space: pre-wrap; word-break: break-word; outline: none;
        }
        #sidebar-composer-input:empty:before { content: attr(placeholder); color: #555; pointer-events: none; }
        #sidebar-composer-input:focus { border-color: var(--accent); }
        .btn-icon { background: var(--accent); color: black; border: none; padding: 2px 8px; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: bold; }
        .controls { padding: 12px; background: var(--card); border-bottom: 1px solid var(--border); }
        #sidebar-search { width: 100%; padding: 8px; border-radius: 4px; border: 1px solid #444; background: #222; color: white; margin-bottom: 8px; box-sizing: border-box; }
        .filter-row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
        #sidebar-sort { flex: 1; min-width: 80px; padding: 4px; background: #222; color: white; border: 1px solid #444; border-radius: 4px; font-size: 0.8rem; }
        .toggle-label { font-size: 0.75rem; display: flex; align-items: center; gap: 3px; cursor: pointer; color: #aaa; }
        .danger-zone { padding: 10px; border-top: 1px solid var(--border); }
        .danger-zone button { width: 100%; padding: 6px; font-size: 0.7rem; cursor: pointer; background: transparent; color: var(--danger); border: 1px solid var(--danger); border-radius: 4px; }
        main { 
            flex: 1; 
            overflow-y: auto; 
            min-height: 0; /* CRITICAL for Mac flex scroll */
            padding: 12px; 
            display: flex; 
            flex-direction: column; 
            gap: 10px; 
            -webkit-overflow-scrolling: touch;
            will-change: transform; /* Hardware acceleration for Mac trackpad momentum */
            overscroll-behavior-y: contain; /* Prevents background page from scrolling */
        }
        /* Custom scrollbar to ensure visibility/reliability on Mac */
        main::-webkit-scrollbar { width: 6px; }
        main::-webkit-scrollbar-track { background: transparent; }
        main::-webkit-scrollbar-thumb { background: #444; border-radius: 10px; }
        main::-webkit-scrollbar-thumb:hover { background: #555; }
        .prompt-card { background: var(--card); padding: 10px; border-radius: 8px; border: 1px solid var(--border); font-size: 0.85rem; cursor: pointer; position: relative; }
        .prompt-card:hover { border-color: var(--accent); }
        .platform-badge { font-size: 0.65rem; background: var(--accent); color: black; padding: 1px 4px; border-radius: 3px; font-weight: bold; }
        .card-meta { font-size: 0.7rem; color: #888; margin-bottom: 5px; display: flex; justify-content: space-between; align-items: center; }
        .has-answer-badge { font-size: 0.65rem; color: #4caf50; margin-top: 6px; font-weight: 500; }
        .card-text { 
            white-space: pre-wrap; 
            word-break: break-word; 
            line-height: 1.4; 
            transition: max-height 0.3s ease;
        }
        .card-text.collapsed {
            max-height: 75px;
            overflow: hidden;
            mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
            -webkit-mask-image: linear-gradient(to bottom, black 50%, transparent 100%);
        }
        .toggle-text-btn {
            color: var(--accent);
            font-size: 0.7rem;
            font-weight: bold;
            cursor: pointer;
            margin-top: 4px;
            display: inline-block;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .toggle-text-btn:hover { text-decoration: underline; }
        .star { cursor: pointer; color: #444; font-size: 1rem; }
        .star.active { color: gold; }
        .copy-btn { cursor: pointer; font-size: 0.9rem; }
        .export-btn { cursor: pointer; font-size: 0.7rem; font-weight: bold; background: #bb86fc; color: #000; padding: 3px 6px; border-radius: 4px; border: none; opacity: 0.9; transition: opacity 0.2s, background 0.2s; }
        .export-btn:hover { opacity: 1; background: #a370e0; }
        #sidebar-toggle-btn {
            position: fixed; top: 50%; right: 0; transform: translateY(-50%);
            z-index: 999998; background: var(--accent); border: none;
            padding: 12px 8px; border-radius: 8px 0 0 8px; cursor: pointer;
            font-size: 1.2rem; box-shadow: -2px 0 5px rgba(0,0,0,0.3);
            transition: right 0.3s ease; pointer-events: auto;
        }
        .welcome-guide { padding: 20px; text-align: center; color: #888; font-style: italic; font-size: 0.9rem; line-height: 1.5; }
        .prompt-images { display: flex; gap: 4px; overflow-x: auto; margin-top: 6px; padding-bottom: 2px; }
        .prompt-thumb { width: 50px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border); background: #333; }
    `;
    shadow.appendChild(styleLink);

    const content = document.createElement('div');
    content.innerHTML = sidebarHtml;
    shadow.appendChild(content);

    // --- Elements ---
    const container = shadow.getElementById('sidebar-container');
    const toggleBtn = shadow.getElementById('sidebar-toggle-btn');
    const closeBtn = shadow.getElementById('close-sidebar');
    const list = shadow.getElementById('sidebar-list');
    const searchInput = shadow.getElementById('sidebar-search');
    const sortSelect = shadow.getElementById('sidebar-sort');
    const bookmarkFilter = shadow.getElementById('sidebar-bookmark-filter');
    const composerInput = shadow.getElementById('sidebar-composer-input');
    // perfModeBtn removed
    const storageCountSpan = shadow.getElementById('storage-count');

    let allPrompts = [];
    let currentUrl = window.location.href;
    const expandedMessageIds = new Set(); // Persistent expansion state in-memory

    // Perf mode logic removed

    let isSidebarContextInvalidated = false;
    function checkSidebarContext() {
        if (isSidebarContextInvalidated) return false;
        if (!chrome.runtime?.id) {
            isSidebarContextInvalidated = true;
            if (refreshInterval) clearInterval(refreshInterval);
            if (watchIntervalSidebar) clearInterval(watchIntervalSidebar);
            return false;
        }
        return true;
    }

    // --- Logic ---
    async function loadData() {
        if (!checkSidebarContext()) return;
        allPrompts = await StorageManager.getPrompts();
        if (storageCountSpan) {
            storageCountSpan.textContent = allPrompts.length;
        }
        render();
    }

    function render() {
        if (!checkSidebarContext() || !searchInput) return;
        const query = searchInput.value.toLowerCase();
        const sort = sortSelect.value;
        const onlyStars = bookmarkFilter.checked;

        const currentSession = StorageManager.getSessionId(currentUrl);

        let filtered = allPrompts.filter(p => {
            const matchesSearch = p.prompt.toLowerCase().includes(query);
            const matchesStar = onlyStars ? p.bookmarked : true;
            const promptSession = StorageManager.getSessionId(p.url);

            // STRICT CHAT FILTER: Only show prompts from current chat session
            const matchesContext = (promptSession && currentSession && promptSession === currentSession);
            return matchesSearch && matchesStar && matchesContext;
        });

        // SORTING: Correct newest vs oldest (using date field + messageIndex tie-breaker)
        filtered.sort((a, b) => {
            const aTime = new Date(a.date || 0).getTime();
            const bTime = new Date(b.date || 0).getTime();

            if (aTime !== bTime) {
                return sort === 'newest' ? (bTime - aTime) : (aTime - bTime);
            }
            // Tie-breaker: Use messageIndex
            const aIdx = a.messageIndex || 0;
            const bIdx = b.messageIndex || 0;
            return sort === 'newest' ? (bIdx - aIdx) : (aIdx - bIdx);
        });

        list.innerHTML = "";

        if (filtered.length === 0) {
            const noFilters = !query && !onlyStars;
            if (noFilters) {
                if (currentSession) {
                    list.innerHTML = `<div class="welcome-guide">No history for THIS chat yet. Send a message to capture it!</div>`;
                } else {
                    list.innerHTML = `<div class="welcome-guide">🚀 Start a new conversation to see its history here!</div>`;
                }
            } else {
                list.innerHTML = `<div class="welcome-guide">No matching prompts found.</div>`;
            }
            return;
        }

        filtered.forEach((p, index) => {
            const item = document.createElement('div');
            item.className = 'prompt-card';

            const isLong = p.prompt.length > 250 || (p.prompt.match(/\n/g) || []).length > 4;

            item.innerHTML = `
                <div class="card-meta">
                    <span><span class="platform-badge">${escapeHtml(p.platform)}</span></span>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="export-btn" title="Export with Answer">PDF</span>
                        <span class="copy-btn" title="Copy">📋</span>
                        <span class="star ${p.bookmarked ? 'active' : ''}" title="Bookmark">${p.bookmarked ? '★' : '☆'}</span>
                    </div>
                </div>
                <div class="card-text ${isLong && !expandedMessageIds.has(p.id) ? 'collapsed' : ''}">${escapeHtml(p.prompt)}</div>
                ${isLong ? `<div class="toggle-text-btn">${expandedMessageIds.has(p.id) ? 'Hide' : 'Show more'}</div>` : ''}
                ${p.promptImages && p.promptImages.length > 0 ? `
                    <div class="prompt-images">
                        ${p.promptImages.map(img => `<img src="${img}" class="prompt-thumb" loading="lazy">`).join('')}
                    </div>
                ` : ''}
                ${p.answer ? '<div class="has-answer-badge">✓ Answer captured</div>' : ''}
            `;

            // ONE-CLICK DIRECT & SCROLL: Navigation for current chat
            item.onclick = () => {
                if (p.url && StorageManager.getSessionId(p.url) === currentSession) {
                    scrollToMessage(p.prompt, p.occurrenceNumber, p.domMessageId);
                }
            };

            if (isLong) {
                const toggle = item.querySelector('.toggle-text-btn');
                const textEl = item.querySelector('.card-text');
                toggle.onclick = (e) => {
                    e.stopPropagation();
                    const isNowCollapsed = textEl.classList.toggle('collapsed');
                    if (isNowCollapsed) {
                        expandedMessageIds.delete(p.id);
                        toggle.textContent = 'Show more';
                    } else {
                        expandedMessageIds.add(p.id);
                        toggle.textContent = 'Hide';
                    }
                };
            }

            item.querySelector('.copy-btn').onclick = (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(p.prompt);
                const btn = e.target;
                btn.textContent = "✅";
                setTimeout(() => btn.textContent = "📋", 1200);
            };

            item.querySelector('.star').onclick = async (e) => {
                e.stopPropagation();
                await StorageManager.toggleBookmark(p.id);
                loadData();
            };

            item.querySelector('.export-btn').onclick = async (e) => {
                e.stopPropagation();
                const btn = e.target;
                const originalText = btn.textContent;
                try {
                    btn.textContent = "⏳";
                    await ExportHelper.exportPromptAnswer(p.prompt, p.answer, p.platform, index + 1, p.domMessageId, p.occurrenceNumber);
                    btn.textContent = "✅";
                } catch (err) {
                    console.error("Export failed:", err);
                    if (err.message && err.message.includes("Extension context invalidated")) {
                        btn.textContent = "🔄";
                        alert("Extension updated! Please refresh the page to continue.");
                    } else {
                        btn.textContent = "❌";
                    }
                } finally {
                    setTimeout(() => btn.textContent = originalText, 2000);
                }
            };

            list.appendChild(item);
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // --- Events ---
    watchIntervalSidebar = setInterval(() => {
        if (!checkSidebarContext()) return;
        if (window.location.href !== currentUrl) {
            currentUrl = window.location.href;
            render();
        }
    }, 1500);

    function toggleSidebar() {
        if (!checkSidebarContext()) return;
        container.classList.toggle('hidden');
        if (!container.classList.contains('hidden')) {
            // Give the host width so Mac gestures (trackpad) are captured
            host.style.width = '320px';
            // Pre-warm again on open to ensure it hasn't timed out
            chrome.runtime.sendMessage({ action: "PREWARM_OFFSCREEN" });
            loadData();
            toggleBtn.style.right = '320px';
        } else {
            host.style.width = '0';
            toggleBtn.style.right = '0';
        }
    }

    toggleBtn.onclick = toggleSidebar;

    closeBtn.onclick = () => {
        container.classList.add('hidden');
        host.style.width = '0';
        toggleBtn.style.right = '0';
    };



    searchInput.oninput = () => checkSidebarContext() && render();
    sortSelect.onchange = () => checkSidebarContext() && render();
    bookmarkFilter.onchange = () => checkSidebarContext() && render();

    composerInput.onpaste = (e) => {
        // Handle direct image file paste (e.g. screenshot from clipboard)
        const files = e.clipboardData.files;
        if (files && files.length > 0) {
            for (const file of files) {
                if (file.type.startsWith('image/')) {
                    e.preventDefault();
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const img = `<img src="${ev.target.result}" style="max-width: 100%; height: auto; display: block; margin: 8px 0; border-radius: 4px;">`;
                        document.execCommand('insertHTML', false, img);
                    };
                    reader.readAsDataURL(file);
                    return;
                }
            }
        }

        // Handle HTML paste (preserve images)
        const html = e.clipboardData.getData('text/html');
        if (html) {
            e.preventDefault();
            const temp = document.createElement('div');
            temp.innerHTML = html;
            // Security: strip dangerous elements and attributes
            temp.querySelectorAll('script, iframe, object, embed, form, link, meta').forEach(el => el.remove());
            const all = temp.querySelectorAll('*');
            all.forEach(el => {
                // Strip on* event handlers and javascript: URLs
                Array.from(el.attributes).forEach(attr => {
                    if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
                        el.removeAttribute(attr.name);
                    }
                });
                // Style images for proper display in composer
                if (el.tagName === 'IMG') {
                    el.style.maxWidth = '100%';
                    el.style.height = 'auto';
                    el.style.display = 'block';
                    el.style.margin = '8px 0';
                    el.style.borderRadius = '4px';
                } else {
                    el.style.width = ''; el.style.height = ''; el.style.position = '';
                    el.style.top = ''; el.style.left = ''; el.style.margin = '';
                    if (el.style.display && el.style.display.includes('flex')) el.style.display = 'inline';
                }
                if (el.tagName === 'SPAN' && (el.className.includes('citation') || el.innerText.match(/^\[\d+\]$/))) {
                    el.style.fontSize = '0.7rem'; el.style.verticalAlign = 'super'; el.style.color = 'var(--accent)';
                }
            });
            document.execCommand('insertHTML', false, temp.innerHTML);
        }
    };

    shadow.getElementById('sidebar-export-pdf').onclick = async (e) => {
        const text = composerInput.innerHTML;
        if (!text.trim() || text === '<br>') return alert("Please enter text to export.");
        const btn = e.target;
        const oldText = btn.textContent;
        try {
            btn.textContent = "⌛ Generating...";
            btn.disabled = true;
            await ExportHelper.toPdf(text);
            btn.textContent = "✅ Done!";
            composerInput.innerHTML = "";
        } catch (err) {
            btn.textContent = "❌ Error";
        } finally {
            setTimeout(() => {
                btn.textContent = oldText;
                btn.disabled = false;
            }, 2000);
        }
    };

    shadow.getElementById('sidebar-clear-all').onclick = async () => {
        if (confirm("Permanently clear ALL history?")) {
            await StorageManager.clearAll();
            loadData();
        }
    };

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes) => {
            if (!checkSidebarContext()) return;
            if (changes.prompts) {
                allPrompts = changes.prompts.newValue || [];
                if (!container.classList.contains('hidden')) render();
            }
        });
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message) => {
            if (!checkSidebarContext()) return;
            if (message.action === "TOGGLE_SIDEBAR") toggleSidebar();
        });
    }

    loadData();
})();