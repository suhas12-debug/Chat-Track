// popup.js - logic for the standalone extension popup.
document.addEventListener("DOMContentLoaded", async function () {
    // Pre-warm the PDF offscreen engine as soon as the UI opens
    chrome.runtime.sendMessage({ action: "PREWARM_OFFSCREEN" });

    const promptList = document.getElementById("promptList");
    const searchInput = document.getElementById("searchInput");
    const bookmarkFilter = document.getElementById("bookmarkFilter");
    const sortOrder = document.getElementById("sortOrder");
    const clearFiltersBtn = document.getElementById("clearFiltersBtn");
    const clearAllBtn = document.getElementById("clearAllBtn");
    const confirmModal = document.getElementById("confirmModal");
    const confirmClear = document.getElementById("confirmClear");
    const cancelClear = document.getElementById("cancelClear");
    const composerInput = document.getElementById("composerInput");

    let allPrompts = [];
    let activeTabUrl = "";

    async function loadPrompts() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        activeTabUrl = tab?.url || "";
        allPrompts = await StorageManager.getPrompts();
        renderPrompts();
    }

    function renderPrompts() {
        const searchTerm = searchInput.value.toLowerCase();
        const onlyBookmarked = bookmarkFilter.checked;
        const sortValue = sortOrder.value;
        const currentSession = StorageManager.getSessionId(activeTabUrl);

        let filtered = allPrompts.filter(item => {
            const matchesSearch = item.prompt.toLowerCase().includes(searchTerm);
            const matchesBookmark = onlyBookmarked ? item.bookmarked : true;
            const promptSession = StorageManager.getSessionId(item.url);
            const matchesContext = (promptSession && currentSession && promptSession === currentSession);
            return matchesSearch && matchesBookmark && matchesContext;
        });

        // SORTING: use messageIndex which is the loop position (0,1,2,3...) in the chat.
        // This is reliable because every prompt — including duplicates — gets its own
        // unique loop position. date is the fallback for cross-session ordering.
        filtered.sort((a, b) => {
            const aHasIdx = a.messageIndex !== undefined && a.messageIndex !== null;
            const bHasIdx = b.messageIndex !== undefined && b.messageIndex !== null;

            if (aHasIdx && bHasIdx) {
                if (a.messageIndex !== b.messageIndex) {
                    return sortValue === 'newest'
                        ? b.messageIndex - a.messageIndex
                        : a.messageIndex - b.messageIndex;
                }
            }

            // Fallback: sort by captured date
            const aTime = new Date(a.date || 0).getTime();
            const bTime = new Date(b.date || 0).getTime();
            if (aTime !== bTime) {
                return sortValue === 'newest' ? bTime - aTime : aTime - bTime;
            }

            return 0;
        });

        promptList.innerHTML = "";

        if (filtered.length === 0) {
            if (searchTerm || onlyBookmarked) {
                promptList.innerHTML = `<div class="empty-state">No matching prompts found.</div>`;
            } else {
                if (currentSession) {
                    promptList.innerHTML = `<div class="empty-state">No history for THIS chat yet. Send a message to capture it!</div>`;
                } else {
                    promptList.innerHTML = `<div class="welcome-guide">🚀 <strong>Start chatting</strong> to see your history here!</div>`;
                }
            }
            return;
        }

        filtered.forEach((item, index) => {
            const div = document.createElement("div");
            div.className = "prompt-item";
            const isLong = item.prompt.length > 250 || (item.prompt.match(/\n/g) || []).length > 4;

            div.innerHTML = `
                <div class="prompt-header">
                    <span class="platform-tag">${escapeHtml(item.platform)}</span>
                    <div style="display: flex; gap: 10px; align-items: center;">
                        <span class="export-btn" title="Export with Answer">PDF</span>
                        <span class="copy-btn" title="Copy">📋</span>
                        <span class="bookmark-icon ${item.bookmarked ? 'active' : ''}">${item.bookmarked ? '★' : '☆'}</span>
                    </div>
                </div>
                <div class="prompt-text ${isLong ? 'collapsed' : ''}">${escapeHtml(item.prompt)}</div>
                ${isLong ? '<div class="toggle-text-btn">Show more</div>' : ''}
                ${item.promptImages && item.promptImages.length > 0 ? `
                    <div class="prompt-images">
                        ${item.promptImages.map(img => `<img src="${img}" class="prompt-thumb" loading="lazy">`).join('')}
                    </div>
                ` : ''}
                ${item.answer ? '<div class="has-answer-badge">✓ Answer captured</div>' : ''}
            `;

            if (isLong) {
                const toggle = div.querySelector('.toggle-text-btn');
                const textEl = div.querySelector('.prompt-text');
                toggle.onclick = (e) => {
                    e.stopPropagation();
                    const isCollapsed = textEl.classList.toggle('collapsed');
                    toggle.textContent = isCollapsed ? 'Show more' : 'Hide';
                };
            }

            div.onclick = () => {
                if (item.url && StorageManager.getSessionId(item.url) === currentSession) {
                    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
                        if (tabs[0]?.id) {
                            chrome.tabs.sendMessage(tabs[0].id, {
                                action: "SCROLL_TO_PROMPT",
                                text: item.prompt,
                                // occurrenceNumber is the navigation anchor (0=first "hii", 1=second "hii")
                                // messageIndex is NOT sent here — that's only for sorting
                                occurrenceNumber: item.occurrenceNumber !== undefined ? item.occurrenceNumber : 0,
                                domMessageId: item.domMessageId || null
                            });
                            window.close();
                        }
                    });
                } else if (item.url) {
                    window.open(item.url, '_blank');
                }
            };

            div.querySelector('.copy-btn').onclick = (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(item.prompt);
                const btn = e.target;
                btn.textContent = "✅";
                setTimeout(() => btn.textContent = "📋", 1200);
            };

            div.querySelector('.bookmark-icon').onclick = async (e) => {
                e.stopPropagation();
                await StorageManager.toggleBookmark(item.id);
                loadPrompts();
            };

            div.querySelector('.export-btn').onclick = async (e) => {
                e.stopPropagation();
                const btn = e.target;
                const originalText = btn.textContent;
                try {
                    btn.textContent = "⏳";
                    await ExportHelper.exportPromptAnswer(item.prompt, item.answer, item.platform, index + 1);
                    btn.textContent = "✅";
                } catch (err) {
                    console.error("Export failed:", err);
                    btn.textContent = "❌";
                } finally {
                    setTimeout(() => btn.textContent = originalText, 2000);
                }
            };

            promptList.appendChild(div);
        });
    }

    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    searchInput.oninput = renderPrompts;
    bookmarkFilter.onchange = renderPrompts;
    sortOrder.onchange = renderPrompts;

    clearFiltersBtn.onclick = () => {
        searchInput.value = "";
        bookmarkFilter.checked = false;
        sortOrder.value = "newest";
        renderPrompts();
    };

    clearAllBtn.onclick = () => confirmModal.style.display = "block";
    cancelClear.onclick = () => confirmModal.style.display = "none";
    confirmClear.onclick = async () => {
        await StorageManager.clearAll();
        confirmModal.style.display = "none";
        loadPrompts();
    };

    // Performance mode logic removed

    composerInput.onpaste = (e) => {
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

        const html = e.clipboardData.getData('text/html');
        if (html) {
            e.preventDefault();
            const temp = document.createElement('div');
            temp.innerHTML = html;
            temp.querySelectorAll('script, iframe, object, embed, form, link, meta').forEach(el => el.remove());
            const all = temp.querySelectorAll('*');
            all.forEach(el => {
                Array.from(el.attributes).forEach(attr => {
                    if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
                        el.removeAttribute(attr.name);
                    }
                });
                if (el.tagName === 'IMG') {
                    el.style.maxWidth = '100%';
                    el.style.height = 'auto';
                    el.style.display = 'block';
                    el.style.margin = '8px 0';
                    el.style.borderRadius = '4px';
                } else {
                    el.style.width = ''; el.style.height = ''; el.style.position = ''; el.style.margin = '';
                }
                if (el.tagName === 'SPAN' && (el.className.includes('citation') || el.innerText.match(/^\[\d+\]$/))) {
                    el.style.fontSize = '0.7rem'; el.style.verticalAlign = 'super'; el.style.color = '#bb86fc';
                }
            });
            document.execCommand('insertHTML', false, temp.innerHTML);
        }
    };

    document.getElementById("exportPdf").onclick = async (e) => {
        const html = composerInput.innerHTML;
        if (!html.trim() || html === '<br>') return alert("Paste text first!");
        const btn = e.currentTarget;
        const oldText = btn.textContent;
        try {
            btn.textContent = "⌛...";
            await ExportHelper.toPdf(html);
            btn.textContent = "✅";
            composerInput.innerHTML = "";
        } catch (err) {
            btn.textContent = "❌";
        } finally {
            setTimeout(() => btn.textContent = oldText, 2000);
        }
    };

    loadPrompts();
    // initPerformanceModeToggle();
});