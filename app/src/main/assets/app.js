/* SansPet 设置页逻辑 */

const $ = (s) => document.querySelector(s);

const FIELDS = [
  ['baseUrl', 'https://api.deepseek.com/v1'],
  ['apiKey', ''],
  ['model', 'deepseek-chat'],
  ['temperature', '0.8'],
  ['userName', ''],
  ['systemPrompt', ''],
  ['petScale', '1'],
  ['contextLimit', '20'],
  ['typeSpeed', '45'],
  ['proactiveRate', '0.08']
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

function refreshCount() {
  try { $('#msgCount').textContent = B.countMessages(); } catch (e) { $('#msgCount').textContent = '0'; }
}

function refreshPermission() {
  let ok = false;
  try { ok = B.hasOverlayPermission(); } catch (e) { ok = false; }
  const el = $('#permStatus');
  el.textContent = ok ? '已开启' : '未开启';
  el.className = ok ? 'ok' : 'bad';
}

$('#btnSave').addEventListener('click', saveSettings);

$('#btnPerm').addEventListener('click', function () {
  B.requestOverlayPermission();
  setTimeout(refreshPermission, 1500);
});

$('#btnStart').addEventListener('click', function () {
  saveSettings();
  refreshPermission();
  B.startOverlay();
});

$('#btnStop').addEventListener('click', function () { B.stopOverlay(); });

$('#btnClear').addEventListener('click', function () {
  if (confirm('确定清空全部对话历史？')) {
    B.clearMessages();
    refreshCount();
  }
});

$('#btnResetPrompt').addEventListener('click', function () {
  $('#systemPrompt').value = '';
  B.setSetting('systemPrompt', '');
  B.toast('已恢复默认人设');
});

document.addEventListener('visibilitychange', function () {
  if (!document.hidden) refreshPermission();
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