/* SansPet 设置页逻辑 */

const $ = (s) => document.querySelector(s);

const FIELDS = [
  ['baseUrl', 'https://api.deepseek.com/v1'],
  ['apiKey', ''],
  ['model', 'deepseek-flash'],
  ['userName', ''],
  ['systemPrompt', (window.__PERSONA && window.__PERSONA.append) || ''],
  ['userPersona', (window.__PERSONA && window.__PERSONA.user) || ''],
  ['petScale', '1'],
  ['contextLimit', '50'],
  ['proactiveRate', '0.08'],
  ['pokeLlmRate', '0.5'],
  ['screenMinMinutes', '20'],
  ['screenMaxMinutes', '40'],
  ['screenChance', '0.5'],
  ['usageMinMinutes', '15'],
  ['usageMaxMinutes', '30'],
  ['usageChance', '0.5'],
];

function loadSettings() {
  FIELDS.forEach(function (f) {
    const el = $('#' + f[0]);
    if (el) el.value = B.getSetting(f[0], f[1]);
  });
  $('#sound').checked = B.getSetting('sound', '1') === '1';
  $('#proactive').checked = B.getSetting('proactive', '1') === '1';
  $('#walkEnabled').checked = B.getSetting('walkEnabled', '0') === '1';
  $('#screenRead').checked = B.getSetting('screenRead', '0') === '1';
  $('#usageRead').checked = B.getSetting('usageRead', '0') === '1';
  refreshReadPerms();
  $('#lockPosition').checked = B.getSetting('lockPosition', '0') === '1';

  const mode = B.getSetting('chatMode', 'ai');
  document.querySelectorAll('input[name=chatMode]').forEach(function (r) {
    r.checked = (r.value === mode);
  });
  refreshAiWarn();
  refreshCount();
  refreshPermission();
  refreshToggle();
  refreshPromptView();
}

function saveSettings() {
  FIELDS.forEach(function (f) {
    const el = $('#' + f[0]);
    if (el) B.setSetting(f[0], el.value);
  });
  B.setSetting('sound', $('#sound').checked ? '1' : '0');
  B.setSetting('proactive', $('#proactive').checked ? '1' : '0');
  B.setSetting('walkEnabled', $('#walkEnabled').checked ? '1' : '0');
  B.setSetting('screenRead', $('#screenRead').checked ? '1' : '0');
  B.setSetting('usageRead', $('#usageRead').checked ? '1' : '0');
  B.setSetting('lockPosition', $('#lockPosition').checked ? '1' : '0');

  const checkedMode = document.querySelector('input[name=chatMode]:checked');
  if (checkedMode) B.setSetting('chatMode', checkedMode.value);
  refreshAiWarn();
  try { B.refreshPet(); } catch (e) {}
  B.toast('已保存');
}

/* 把内置人设和「实际发给模型的完整提示词」显示出来，方便查看 */
function refreshPromptView() {
  const builtin = $('#builtinPrompt');
  if (builtin) builtin.value = (window.__PERSONA && window.__PERSONA.builtin) || '（读不到内置人设）';

  const full = $('#fullPrompt');
  if (!full) return;
  const parts = [];
  parts.push('【内置人设】');
  parts.push((window.__PERSONA && window.__PERSONA.builtin) || '');
  const extra = ($('#systemPrompt') && $('#systemPrompt').value || '').trim();
  if (extra) { parts.push(''); parts.push('【追加提示词】'); parts.push(extra); }
  const name = ($('#userName') && $('#userName').value || '').trim();
  if (name) { parts.push(''); parts.push('用户名字：' + name); }
  const persona = ($('#userPersona') && $('#userPersona').value || '').trim();
  if (persona) { parts.push(''); parts.push('关于用户：' + persona); }
  full.value = parts.join('\n');
}

function refreshCount() {
  const el = $('#msgCount');
  if (!el) return;
  try { el.textContent = B.countMessages(); } catch (e) { el.textContent = '0'; }
}

function refreshPermission() {
  let ok = false;
  try { ok = B.hasOverlayPermission(); } catch (e) { ok = false; }
  const el = $('#permStatus');
  el.textContent = ok ? '已开启' : '未开启';
  el.className = ok ? 'ok' : 'bad';
}

/* 视觉能力自检：画一张纯红小图发过去，看原始返回 */
window.__sansCallback = function (id, json) {
  const out = $('#visionResult');
  if (out) {
    let pretty = json;
    try { pretty = JSON.stringify(JSON.parse(json), null, 2); } catch (e) {}
    out.value = pretty;
  }
};

$('#btnTestVision').addEventListener('click', function () {
  saveSettings();
  const out = $('#visionResult');
  if (out) out.value = '测试中…';

  // 现画一张 64x64 纯红图，转成 dataURL
  let dataUrl = '';
  try {
    const c = document.createElement('canvas');
    c.width = 64; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#ff0000';
    g.fillRect(0, 0, 64, 64);
    dataUrl = c.toDataURL('image/png');
  } catch (e) {
    if (out) out.value = '画测试图失败：' + e;
    return;
  }

  const payload = {
    baseUrl: ($('#baseUrl').value || '').trim(),
    apiKey: ($('#apiKey').value || '').trim(),
    model: ($('#model').value || '').trim(),
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: '这张图是什么颜色？只回答颜色。' },
        { type: 'image_url', image_url: { url: dataUrl } }
      ]
    }]
  };

  try {
    B.chat(JSON.stringify(payload), 'vision-test');
  } catch (e) {
    if (out) out.value = '调用失败：' + e;
  }
});

/* 读屏 / 使用数据的权限状态 */
function refreshReadPerms() {
  const as = $('#accStatus');
  if (as) {
    let ok = false;
    try { ok = B.hasAccessibility(); } catch (e) { ok = false; }
    as.textContent = ok ? '已开启' : '未开启';
    as.className = ok ? 'ok' : 'bad';
  }
  const cs = $('#captureStatus');
  if (cs) {
    let ok = false;
    try { ok = B.hasScreenCapture(); } catch (e) { ok = false; }
    cs.textContent = ok ? '已授权' : '未授权';
    cs.className = ok ? 'ok' : 'bad';
  }
  const ce = $('#captureError');
  if (ce) {
    let err = '';
    try { err = B.screenError() || ''; } catch (e) { err = ''; }
    ce.textContent = err ? ('上次失败原因：' + err) : '';
  }
  const us = $('#usageStatus');
  if (us) {
    let ok = false;
    try { ok = B.hasUsageAccess(); } catch (e) { ok = false; }
    us.textContent = ok ? '已授权' : '未授权';
    us.className = ok ? 'ok' : 'bad';
  }
}

$('#btnCapture').addEventListener('click', function () {
  B.requestScreenCapture();
  setTimeout(refreshReadPerms, 3000);
});

$('#btnTestScreen').addEventListener('click', function () {
  saveSettings();
  setTimeout(function () { try { B.testScreenRead(); } catch (e) {} }, 200);
});

$('#btnTestUsage').addEventListener('click', function () {
  saveSettings();
  setTimeout(function () { try { B.testUsageRead(); } catch (e) {} }, 200);
});

$('#btnAcc').addEventListener('click', function () {
  B.openAccessibilitySettings();
  setTimeout(refreshReadPerms, 3000);
});

$('#btnUsage').addEventListener('click', function () {
  B.openUsageAccessSettings();
  setTimeout(refreshReadPerms, 3000);
});

/* 随机走动 和 锁定位置 互斥：只能选一个，或者都不选 */
$('#walkEnabled').addEventListener('change', function () {
  if (this.checked) $('#lockPosition').checked = false;
});
$('#lockPosition').addEventListener('change', function () {
  if (this.checked) $('#walkEnabled').checked = false;
});

/* 接口没填全时提示会强制用纯预设 */
function refreshAiWarn() {
  const el = $('#aiModeWarn');
  if (!el) return;
  const base = ($('#baseUrl').value || '').trim();
  const key = ($('#apiKey').value || '').trim();
  const model = ($('#model').value || '').trim();
  const ready = !!(base && key && model);
  const checked = document.querySelector('input[name=chatMode]:checked');
  const mode = checked ? checked.value : 'ai';

  if (!ready) {
    el.style.color = '#ff5c5c';
    el.textContent = '⚠ Base URL / API Key / 模型 没填全，当前强制使用「纯预设对话」。';
  } else if (mode === 'preset') {
    el.style.color = '#ffe600';
    el.textContent = '当前：纯预设对话（不联网，不花钱）';
  } else {
    el.textContent = '';
  }
}

document.querySelectorAll('input[name=chatMode]').forEach(function (r) {
  r.addEventListener('change', refreshAiWarn);
});
['#baseUrl', '#apiKey', '#model'].forEach(function (sel) {
  const el = $(sel);
  if (el) el.addEventListener('input', refreshAiWarn);
});

/* API Key 显示 / 隐藏 */
$('#btnKeyToggle').addEventListener('click', function () {
  const input = $('#apiKey');
  const icon = $('#iconKeyToggle');
  const masked = input.classList.toggle('masked');
  icon.src = masked ? 'icons/eye.svg' : 'icons/eye-off.svg';
  icon.alt = masked ? '显示' : '隐藏';
});

$('#btnSave').addEventListener('click', saveSettings);

$('#btnPerm').addEventListener('click', function () {
  B.requestOverlayPermission();
  setTimeout(refreshPermission, 1500);
});

function refreshToggle() {
  let running = false;
  try { running = B.isRunning(); } catch (e) { running = false; }
  const btn = $('#btnToggle');
  btn.textContent = running ? '关闭桌宠' : '开启桌宠';
  btn.className = running ? 'brutal-btn orange' : 'brutal-btn blue';
}

$('#btnToggle').addEventListener('click', function () {
  let running = false;
  try { running = B.isRunning(); } catch (e) { running = false; }
  if (running) {
    B.stopOverlay();
  } else {
    saveSettings();
    refreshPermission();
    B.startOverlay();
  }
  setTimeout(refreshToggle, 700);
});

/* 清空对话历史：只清历史窗口里的记录，记忆保留（Sans 还记得） */
$('#btnClear').addEventListener('click', function () {
  if (!confirm('确定清空对话历史？\n只会清空历史窗口的记录，Sans 还记得你们聊过什么。')) return;
  B.clearMessages();
  try { B.notifyHistoryCleared(); } catch (e) {}
  B.toast('已清空对话历史');
  refreshCount();
});

/* 清除记忆：只清发给模型的上下文，历史记录保留（Sans 失忆但记录还在） */
$('#btnClearMemory').addEventListener('click', function () {
  if (!confirm('确定清除记忆？\n历史记录会保留，但 Sans 会忘记你们之前聊过什么。')) return;
  B.clearMemory();
  B.toast('已清除上下文记忆');
});

$('#btnResetPrompt').addEventListener('click', function () {
  $('#systemPrompt').value = '';
  B.setSetting('systemPrompt', '');
  B.setSetting('userPersona', '');
  $('#userPersona').value = '';
  refreshPromptView();
  B.toast('已清空追加内容，回到内置人设');
});

['#systemPrompt', '#userName', '#userPersona'].forEach(function (sel) {
  const el = $(sel);
  if (el) el.addEventListener('input', refreshPromptView);
});

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) {
    refreshPermission();
    refreshToggle();
    refreshReadPerms();
  }
});

/* ---------- 模型列表 ---------- */

function requestModels() {
  const baseUrl = ($('#baseUrl').value || '').trim();
  const apiKey = ($('#apiKey').value || '').trim();
  if (!baseUrl) { B.toast('先填 Base URL'); return; }
  B.toast('正在获取模型列表…');
  const cbId = 'm' + Date.now();
  try {
    B.listModels(JSON.stringify({ baseUrl: baseUrl, apiKey: apiKey }), cbId);
  } catch (e) {
    B.toast('获取失败');
  }
}

window.__modelCallback = function (id, json) {
  let r = {};
  try { r = JSON.parse(json); } catch (e) { r = { ok: false, error: '解析失败' }; }
  if (!r.ok) { B.toast('获取失败：' + (r.error || '')); return; }
  const sel = $('#modelSelect');
  sel.innerHTML = '';
  r.models.forEach(function (m) {
    const o = document.createElement('option');
    o.value = m;
    o.textContent = m;
    sel.appendChild(o);
  });
  sel.classList.remove('hidden');
  const cur = ($('#model').value || '').trim();
  sel.value = (cur && r.models.indexOf(cur) >= 0) ? cur : r.models[0];
  $('#model').value = sel.value;
  B.toast('拿到 ' + r.models.length + ' 个模型');
};

$('#btnModels').addEventListener('click', requestModels);

$('#modelSelect').addEventListener('change', function () {
  $('#model').value = $('#modelSelect').value;
});

loadSettings();