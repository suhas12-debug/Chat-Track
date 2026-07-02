const StorageManager = {
  _isSaving: false,
  _saveQueue: [],
  MAX_PROMPTS: 1000,

  /**
   * Checks if the extension context is still valid. 
   * Pre-empts "Extension context invalidated" errors after reloads.
   */
  isContextValid: function () {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  },

  getPrompts: function () {
    return new Promise((resolve) => {
      if (!this.isContextValid()) {
        console.warn("[Storage] Context invalidated. Returning empty prompts.");
        return resolve([]);
      }
      chrome.storage.local.get(["prompts"], (result) => {
        resolve(result.prompts || []);
      });
    });
  },

  getSessionId: function (url) {
    if (!url) return "";
    try {
      const u = new URL(url);
      if (u.hostname.includes("chatgpt.com")) {
        const parts = u.pathname.split("/");
        const cIndex = parts.indexOf("c");
        if (cIndex !== -1) return parts[cIndex + 1] || "";
        const shareIndex = parts.indexOf("share");
        if (shareIndex !== -1) return "share-" + (parts[shareIndex + 1] || "");
        return "";
      }
      if (u.hostname.includes("gemini.google.com")) {
        const id = u.pathname.split("/app/")[1] || "";
        return id.split("?")[0].split("#")[0];
      }
      return u.pathname;
    } catch (e) { return ""; }
  },

  savePrompts: async function (promptArray) {
    if (!promptArray || promptArray.length === 0) return;
    if (!this.isContextValid()) return;

    if (this._isSaving) {
      return new Promise((resolve) => {
        this._saveQueue.push({ promptArray, resolve });
      });
    }

    this._isSaving = true;

    try {
      const prompts = await this.getPrompts();
      const newItems = [];

      const sessionCache = new Map();
      const getCachedSessionId = (url) => {
        if (!url) return "";
        if (sessionCache.has(url)) return sessionCache.get(url);
        const sid = this.getSessionId(url);
        sessionCache.set(url, sid);
        return sid;
      };

      let hasUpdates = false;

      for (const data of promptArray) {
        const text = data.prompt?.trim();
        if (!text) continue;

        const url = data.url || "";
        const sessionId = getCachedSessionId(url);

        const existingIndex = prompts.findIndex(p => {
          const pSId = getCachedSessionId(p.url);
          const isSameSession = pSId && sessionId && pSId === sessionId;

          if (!isSameSession) {
            const pUrlNorm = p.url?.split('?')[0].split('#')[0];
            const dataUrlNorm = url?.split('?')[0].split('#')[0];
            return p.prompt === text && pUrlNorm === dataUrlNorm;
          }

          if (data.domMessageId && p.domMessageId) {
            return p.domMessageId === data.domMessageId;
          }
          const hasOcc = data.occurrenceNumber !== undefined && p.occurrenceNumber !== undefined;
          if (hasOcc) {
            return p.prompt === text && p.occurrenceNumber === data.occurrenceNumber;
          }
          return p.prompt === text;
        });

        if (existingIndex !== -1) {
          let updated = false;
          const p = prompts[existingIndex];
          if (p.prompt !== text) { p.prompt = text; updated = true; }
          if (data.answer && (!p.answer || data.answer !== p.answer)) { p.answer = data.answer; updated = true; }
          if (data.messageIndex !== undefined && p.messageIndex !== data.messageIndex) { p.messageIndex = data.messageIndex; updated = true; }
          if (data.occurrenceNumber !== undefined && p.occurrenceNumber !== data.occurrenceNumber) { p.occurrenceNumber = data.occurrenceNumber; updated = true; }
          if (data.domMessageId && p.domMessageId !== data.domMessageId) { p.domMessageId = data.domMessageId; updated = true; }
          if (data.promptImages && (!p.promptImages || JSON.stringify(p.promptImages) !== JSON.stringify(data.promptImages))) {
            p.promptImages = data.promptImages;
            updated = true;
          }
          if (updated) hasUpdates = true;
          continue;
        }

        const inNewItems = newItems.some(p => {
          const pSId = getCachedSessionId(p.url);
          const isSameSession = pSId && sessionId && pSId === sessionId;
          if (!isSameSession) return p.prompt === text && p.url?.split('?')[0] === url?.split('?')[0];
          if (data.domMessageId && p.domMessageId) return p.domMessageId === data.domMessageId;
          const hasOcc = data.occurrenceNumber !== undefined && p.occurrenceNumber !== undefined;
          if (hasOcc) return p.prompt === text && p.occurrenceNumber === data.occurrenceNumber;
          return p.prompt === text;
        });

        if (!inNewItems) {
          newItems.push({
            id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : (Date.now() + Math.random()).toString(),
            platform: data.platform,
            prompt: text,
            answer: data.answer || '',
            url: url,
            messageIndex: data.messageIndex,
            occurrenceNumber: data.occurrenceNumber !== undefined ? data.occurrenceNumber : 0,
            domMessageId: data.domMessageId || null,
            date: new Date().toISOString(),
            promptImages: data.promptImages || [],
            bookmarked: false
          });
        }
      }

      if (newItems.length > 0 || hasUpdates) {
        // ATOMIC-ISH MERGE: Fetch the very latest data again right before writing
        // This handles cases where two tabs save at the exact same time.
        const freshPrompts = await this.getPrompts();
        let finalPrompts = [...freshPrompts];

        for (const item of newItems) {
          if (!finalPrompts.find(p => p.id === item.id)) {
            finalPrompts.push(item);
          }
        }
        
        // Final trim to MAX_PROMPTS
        if (finalPrompts.length > this.MAX_PROMPTS) {
          const bookmarked = finalPrompts.filter(p => p.bookmarked);
          const nonBookmarked = finalPrompts.filter(p => !p.bookmarked);
          nonBookmarked.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));
          const keepCount = Math.max(0, this.MAX_PROMPTS - bookmarked.length);
          finalPrompts = [...bookmarked, ...nonBookmarked.slice(-keepCount)];
        }

        await new Promise((resolve, reject) => {
          if (!this.isContextValid()) return resolve();
          chrome.storage.local.set({ prompts: finalPrompts }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        });
      }
    } finally {
      this._isSaving = false;
      this._processQueue();
    }
  },

  _processQueue: function () {
    if (this._saveQueue.length > 0) {
      const { promptArray, resolve } = this._saveQueue.shift();
      this.savePrompts(promptArray).then(resolve);
    }
  },

  savePrompt: async function (promptData) {
    return this.savePrompts([promptData]);
  },

  toggleBookmark: async function (id) {
    if (!this.isContextValid()) return;
    const prompts = await this.getPrompts();
    const index = prompts.findIndex(p => p.id === id);
    if (index !== -1) {
      prompts[index].bookmarked = !prompts[index].bookmarked;
      return new Promise((resolve) => {
        if (!this.isContextValid()) return resolve();
        chrome.storage.local.set({ prompts: prompts }, resolve);
      });
    }
  },

  deletePrompt: async function (id) {
    if (!this.isContextValid()) return;
    let prompts = await this.getPrompts();
    prompts = prompts.filter(p => p.id !== id);
    return new Promise((resolve) => {
      if (!this.isContextValid()) return resolve();
      chrome.storage.local.set({ prompts: prompts }, resolve);
    });
  },

  clearAll: function () {
    return new Promise((resolve) => {
      if (!this.isContextValid()) {
        console.warn("[Storage] Context invalidated during clearAll.");
        return resolve();
      }
      chrome.storage.local.set({ prompts: [] }, resolve);
    });
  }
};

if (typeof module !== 'undefined') {
  module.exports = StorageManager;
}