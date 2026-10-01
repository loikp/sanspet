/* SansPet 悬浮桌宠逻辑 */

const $ = (s) => document.querySelector(s);

const DEFAULT_PROMPT = [
  '你是 Sans，一个住在用户手机桌面上的角色。',
  '你不是 AI 助手，不要说自己是 AI、语言模型或程序。',
  '',
  '说话风格：',
  '- 懒散、随意、冷幽默',
  '- 句子短，偶尔用 "..." 停顿',
  '- 喜欢吐槽，但不过分攻击',
  '- 不主动说教，不装热情',
  '',
  '边界：',
  '- 不扮演真人，不声称自己有真实身体',
  '- 不提供医疗、法律、金融等专业建议',
  '',
  '回复长度：默认 1-2 句，用户要求解释时可以变长。'
].join('\n');

const REACTIONS = [
  '嘿。',
  '啊？',
  '...你在干嘛。',
  '又摸鱼。',
  '我就知道。',
  '让我睡会儿。',
  '...别装了。'
];

const PROACTIVE = [
  '...你已经很久没理我了。',
  '嘿。还在吗。',
  '别装了，我知道你在看。',
  '...我睡一会儿。'
];

let typing = false;
let skipTyping = false;
let busy = false;
let cbSeq = 0;
let lastSpeak = 0;

const history = { offset: 0, page: 20, done: false, loading: false };

function S(key, def) { try { return B.getSetting(key, String(def)); } catch (e) { return String(def); } }
function SS(key, val) { try { B.setSetting(key, String(val)); } catch (e) {} }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------- 模式切换 ---------- */

function applyMode(expanded) {
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('compact', !expanded);
  if (!expanded) {
    $('#chatBar').classList.add('hidden');
    $('#historyPanel').classList.add('hidden');
    $('#dialog').classList.add('hidden');
  }
}

function setMode(expanded) {
  applyMode(expanded);
  try { B.setExpanded(expanded); } catch (e) {}
}

// Kotlin 调整完窗口大小后回调
window.__setExpanded = function (v) { applyMode(!!v); };

/* ---------- 音效（纯代码生成，不需要音频素材） ---------- */

let audioCtx = null;
function beep() {
  if (S('sound', '1') !== '1') return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.value = 420 + Math.random() * 160;
    gain.gain.value = 0.03;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.035);
  } catch (e) {}
}

/* ---------- UT 对话框 + 打字机 ---------- */

function showDialog(text, opts) {
  opts = opts || {};
  const box = $('#dialog');
  const el = $('#dialogText');
  box.classList.remove('hidden');
  el.textContent = '';
  typing = true;
  skipTyping = false;
  lastSpeak = Date.now();
  if (opts.expand !== false) setMode(true);

  let i = 0;
  const speed = parseInt(S('typeSpeed', '45'), 10) || 45;

  function tick() {
    if (!typing) return;
    if (skipTyping) {
      el.textContent = text;
      typing = false;
      return;
    }
    i++;
    el.textContent = text.slice(0, i);
    if (i % 2 === 0) beep();
    if (i < text.length) {
      setTimeout(tick, speed);
    } else {
      typing = false;
    }
  }
  tick();
}

function onClickDialog() {
  if (typing) {
    skipTyping = true;
  } else {
    $('#dialog').classList.add('hidden');
    setMode(false);
  }
}

/* ---------- 历史记录 ---------- */

function addHistory(role, content) {
  const msg = { role: role, content: content, time: Date.now() };
  try { B.addMessage(JSON.stringify(msg)); } catch (e) {}
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function historyItem(m) {
  const who = m.role === 'user' ? '你' : 'SANS';
  const div = document.createElement('div');
  div.className = 'ut-box history-item';
  const head = document.createElement('div');
  head.innerHTML = '<span class="who">' + who + '</span><span class="time">' + fmtTime(m.time) + '</span>';
  const body = document.createElement('div');
  body.textContent = m.content;
  div.appendChild(head);
  div.appendChild(body);
  return div;
}

function loadMoreHistory() {
  if (history.loading || history.done) return;
  history.loading = true;
  let list = [];
  try { list = JSON.parse(B.getMessages(history.offset, history.page)) || []; } catch (e) {}
  const box = $('#historyList');
  if (history.offset === 0 && list.length === 0) {
    box.innerHTML = '<div class="history-empty">还没有对话。</div>';
  } else {
    list.forEach(function (m) { box.appendChild(historyItem(m)); });
  }
  history.offset += list.length;
  if (list.length < history.page) {
    history.done = true;
    if (history.offset > 0) $('#historyEnd').classList.remove('hidden');
  }
  history.loading = false;
}

function openHistory() {
  setMode(true);
  $('#dialog').classList.add('hidden');
  $('#chatBar').classList.add('hidden');
  $('#historyPanel').classList.remove('hidden');
  $('#historyList').scrollTop = 0;
  if (history.offset === 0) {
    $('#historyEnd').classList.add('hidden');
    history.done = false;
    loadMoreHistory();
  }
}

function closeHistory() {
  $('#historyPanel').classList.add('hidden');
  setMode(false);
}

/* ---------- 聊天 ---------- */

function recentContext(limit) {
  let arr = [];
  try { arr = JSON.parse(B.getMessages(0, limit)) || []; } catch (e) {}
  arr.reverse();
  return arr
    .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
    .map(function (m) { return { role: m.role, content: m.content }; });
}

function buildSystemPrompt() {
  let base = S('systemPrompt', '') || DEFAULT_PROMPT;
  const name = (S('userName', '') || '').trim();
  if (name) base += '\n\n用户名字：' + name;
  return base;
}

function buildPayload(userText) {
  const limit = parseInt(S('contextLimit', '20'), 10) || 20;
  const messages = [{ role: 'system', content: buildSystemPrompt() }];
  recentContext(limit).forEach(function (m) { messages.push(m); });
  messages.push({ role: 'user', content: userText });

  return {
    baseUrl: S('baseUrl', 'https://api.deepseek.com/v1'),
    apiKey: S('apiKey', ''),
    model: S('model', 'deepseek-chat'),
    temperature: parseFloat(S('temperature', '0.8')) || 0.8,
    messages: messages
  };
}

function sendMessage() {
  const input = $('#chatInput');
  const text = (input.value || '').trim();
  if (!text || busy) return;
  input.value = '';
  addHistory('user', text);
  showDialog('...', { expand: true });
  busy = true;

  const cbId = 'cb' + (++cbSeq);
  try {
    B.chat(JSON.stringify(buildPayload(text)), cbId);
  } catch (e) {
    busy = false;
    showDialog('...出问题了。');
  }
}

window.__sansCallback = function (id, resultJson) {
  busy = false;
  let r = {};
  try { r = JSON.parse(resultJson); } catch (e) { r = { ok: false, error: '解析失败' }; }
  if (r.ok) {
    addHistory('assistant', r.content);
    showDialog(r.content);
  } else {
    showDialog('...出问题了。\n' + (r.error || ''));
  }
};

/* ---------- 主动回复 ---------- */

function proactiveTick() {
  if (S('proactive', '1') !== '1') return;
  if (busy || typing) return;
  if (Date.now() - lastSpeak < 3 * 60 * 1000) return;
  const rate = parseFloat(S('proactiveRate', '0.08')) || 0;
  if (Math.random() < rate) showDialog(pick(PROACTIVE));
}

/* ---------- 事件绑定 ---------- */

/* 拖拽：手指移动就拖动整个悬浮窗，没移动才算点击 */
let dragState = null;
let suppressClick = false;

const petEl = $('#pet');

petEl.addEventListener('touchstart', function (e) {
  const t = e.touches[0];
  dragState = { x: t.clientX, y: t.clientY, moved: false };
}, { passive: true });

petEl.addEventListener('touchmove', function (e) {
  if (!dragState) return;
  const t = e.touches[0];
  const dx = t.clientX - dragState.x;
  const dy = t.clientY - dragState.y;
  if (!dragState.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
  dragState.moved = true;
  const ratio = window.devicePixelRatio || 1;
  try { B.moveBy(dx * ratio, dy * ratio); } catch (err) {}
  dragState.x = t.clientX;
  dragState.y = t.clientY;
}, { passive: true });

petEl.addEventListener('touchend', function () {
  if (dragState && dragState.moved) {
    try { B.savePetPosition(); } catch (e) {}
    suppressClick = true;
    setTimeout(function () { suppressClick = false; }, 350);
  }
  dragState = null;
}, { passive: true });

petEl.addEventListener('touchcancel', function () {
  dragState = null;
}, { passive: true });

petEl.addEventListener('click', function () {
  if (suppressClick) return;
  try { if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); } catch (e) {}
  showDialog(pick(REACTIONS), { expand: true });
});

$('#dialog').addEventListener('click', onClickDialog);

$('#btnChat').addEventListener('click', function () {
  setMode(true);
  $('#historyPanel').classList.add('hidden');
  $('#chatBar').classList.remove('hidden');
  setTimeout(function () { $('#chatInput').focus(); }, 150);
});

$('#btnSend').addEventListener('click', sendMessage);
$('#chatInput').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') sendMessage();
});

$('#btnHistory').addEventListener('click', openHistory);
$('#btnHistoryClose').addEventListener('click', closeHistory);

$('#historyList').addEventListener('scroll', function () {
  const el = $('#historyList');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMoreHistory();
});

setInterval(proactiveTick, 45000);
