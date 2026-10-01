/* SansPet 设置页逻辑 */

const $ = (s) => document.querySelector(s);

const FIELDS = [
  ['baseUrl', 'https://api.deepseek.com/v1'],
  ['apiKey', ''],
  ['model', 'deepseek-chat'],
  ['temperature', '0.8'],
  ['userName', ''],
  ['systemPrompt', ''],
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

loadSettings();
