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
  ['pokeLlmRate', '0.5']
];

function loadSettings() {
  FIELDS.forEach(function (f) {
    const el = $('#' + f[0]);
    if (el) el.value = B.getSetting(f[0], f[1]);
  });
  $('#sound').checked = B.getSetting('sound', '1') === '1';
  $('#proactive').checked = B.getSetting('proactive', '1') === '1';
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

$('#btnClear').addEventListener('click', function () {
  if (!confirm('确定清空全部对话历史？\n会同时清空上下文记忆，Sans 将不再记得之前聊过什么。')) return;
  B.clearMessages();          // 清空聊天记录
  try { B.notifyHistoryCleared(); } catch (e) {}   // 通知悬浮窗刷新，并丢掉上下文
  B.toast('已清空对话历史和上下文记忆');
  refreshCount();
  refreshPromptView();
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