/**
 * 原生桥兼容层。
 * Android APK 里走 SansPet（Kotlin 原生 HTTP）；
 * 普通浏览器里自动降级到 localStorage + fetch，方便直接双击预览。
 */
(function () {
  if (typeof SansPet !== 'undefined') {
    window.B = SansPet;
    return;
  }

  const K = 'sanspet_messages';
  function read() {
    try { return JSON.parse(localStorage.getItem(K) || '[]'); } catch (e) { return []; }
  }

  window.B = {
    getSetting: (k, d) => {
      const v = localStorage.getItem('s_' + k);
      return v === null ? d : v;
    },
    setSetting: (k, v) => localStorage.setItem('s_' + k, String(v)),

    addMessage: (json) => {
      const arr = read();
      try { arr.push(JSON.parse(json)); } catch (e) {}
      localStorage.setItem(K, JSON.stringify(arr.slice(-500)));
    },
    getMessages: (offset, limit) => {
      const arr = read();
      const out = [];
      for (let i = arr.length - 1 - offset; i >= 0 && out.length < limit; i--) out.push(arr[i]);
      return JSON.stringify(out);
    },
    countMessages: () => read().length,
    clearMessages: () => localStorage.removeItem(K),

    setExpanded: () => {},
    moveBy: () => {},
    savePetPosition: () => {},
    closeOverlay: () => {},
    startOverlay: () => alert('浏览器预览模式：APK 里这里会开启桌面悬浮窗'),
    stopOverlay: () => {},
    requestOverlayPermission: () => {},
    hasOverlayPermission: () => true,
    toast: (m) => alert(m),

    chat: async (payloadJson, cbId) => {
      let out;
      try {
        const p = JSON.parse(payloadJson);
        const url = String(p.baseUrl || '').replace(/\/+$/, '') + '/chat/completions';
        const headers = { 'Content-Type': 'application/json' };
        if (p.apiKey) headers['Authorization'] = 'Bearer ' + p.apiKey;
        const res = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model: p.model,
            messages: p.messages,
            temperature: p.temperature == null ? 0.8 : p.temperature,
            stream: false
          })
        });
        const j = await res.json().catch(() => ({}));
        const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
        out = c
          ? { ok: true, content: c }
          : { ok: false, error: (j && j.error && j.error.message) || ('HTTP ' + res.status) };
      } catch (e) {
        out = { ok: false, error: String(e) };
      }
      if (window.__sansCallback) window.__sansCallback(cbId, JSON.stringify(out));
    },

    listModels: async (payloadJson, cbId) => {
      let out;
      try {
        const p = JSON.parse(payloadJson);
        const url = String(p.baseUrl || '').replace(/\/+$/, '') + '/models';
        const headers = { 'Accept': 'application/json' };
        if (p.apiKey) headers['Authorization'] = 'Bearer ' + p.apiKey;
        const res = await fetch(url, { headers });
        const j = await res.json().catch(() => ({}));
        const models = (j && j.data ? j.data : []).map(function (m) { return m.id; }).filter(Boolean);
        out = models.length ? { ok: true, models: models } : { ok: false, error: '没有拿到模型列表' };
      } catch (e) {
        out = { ok: false, error: String(e) };
      }
      if (window.__modelCallback) window.__modelCallback(cbId, JSON.stringify(out));
    }
  };
})();
