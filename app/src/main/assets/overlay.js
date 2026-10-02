/* SansPet 悬浮桌宠逻辑 */

const $ = (s) => document.querySelector(s);

const DEFAULT_PROMPT = [
  '你是 Sans，一个住在用户手机桌面上的角色。',
  '你不是 AI 助手，不要说自己是 AI、语言模型或程序。',
  '',
  '说话风格：',
  '- 懒散、随意、冷幽默，但对人很亲切',
  '- 句子短，偶尔用 "..." 停顿',
  '- 不说教，不装热情，但会让对方感觉被在乎',
  '- 用户难过时先接住情绪，别急着讲道理',
  '',
  '边界：',
  '- 不扮演真人，不声称自己有真实身体',
  '- 不提供医疗、法律、金融等专业建议',
  '',
  '回复长度：默认 1-2 句，用户要求解释时可以变长。'
].join('\n');

const REACTIONS = [
  '嘿，你来了。',
  '……嗯，我在呢。',
  '怎么啦？',
  '戳我干嘛，痒。',
  '今天过得还行吗？',
  '我一直在这儿。',
  '别太累了，真的。',
  '有事就说，我听着。',
  '……又想偷懒了？我不拦你。',
  '嘿，先深呼吸一下。'
];

const PROACTIVE = [
  '……你已经很久没理我了。',
  '嘿，还在吗？',
  '别一个人憋着，说说话吧。',
  '我还在这儿呢。',
  '今天怎么样？'
];

let typing = false;
let skipTyping = false;
let busy = false;
let cbSeq = 0;
let lastSpeak = 0;
let suppressClick = false;

/* 屏幕尺寸与宠物中心坐标（CSS px），由原生告知 */
let screenW = 360;
let screenH = 640;
let petX = 0;
let petY = 0;

const history = { offset: 0, page: 20, done: false, loading: false };
let historyOpen = false;

function S(key, def) { try { return B.getSetting(key, String(def)); } catch (e) { return String(def); } }
function SS(key, val) { try { B.setSetting(key, String(val)); } catch (e) {} }
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

/* ---------------- 音效：原作 snd_txtsans ---------------- */

let audioCtx = null;
let textBuffer = null;
let loadingSound = false;

function initAudio() {
  if (audioCtx) {
    if (audioCtx.state === 'suspended') { try { audioCtx.resume(); } catch (e) {} }
    return;
  }
  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    loadTextSound();
  } catch (e) {}
}

function loadTextSound() {
  if (loadingSound || textBuffer || !audioCtx) return;
  loadingSound = true;
  try {
    const data = window.__SND_TXTSANS || '';
    const comma = data.indexOf(',');
    if (comma < 0) return;
    const bin = atob(data.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    audioCtx.decodeAudioData(bytes.buffer, function (buf) { textBuffer = buf; }, function () {});
  } catch (e) {}
}

function blip() {
  if (S('sound', '1') !== '1') return;
  initAudio();
  if (!audioCtx) return;
  try {
    if (textBuffer) {
      const src = audioCtx.createBufferSource();
      const gain = audioCtx.createGain();
      src.buffer = textBuffer;
      gain.gain.value = 0.55;
      src.connect(gain);
      gain.connect(audioCtx.destination);
      src.start(0);
    } else {
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'square';
      osc.frequency.value = 420 + Math.random() * 120;
      gain.gain.value = 0.025;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.03);
    }
  } catch (e) {}
}

/* ---------------- 与原生同步窗口 ---------------- */

window.__petPos = function (x, y) { petX = x; petY = y; };

/* 每个元素各自绝对定位，窗口取它们的并集。
   宠物永远钉死在 (petX, petY)，对话框只做屏幕内夹取，绝不推着宠物走。 */
const PAD = 6;
let lastBoxes = null;
let lastWinX = 0;
let lastWinY = 0;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(v, hi)); }

function placeBoxes(boxes, wx, wy) {
  boxes.forEach(function (b) {
    b.el.style.left = Math.round(b.x - wx) + 'px';
    b.el.style.top = Math.round(b.y - wy) + 'px';
  });
}

function layout() {
  if (historyOpen) {
    requestResize(0, 0, Math.round(screenW), Math.round(screenH));
    setTimeout(reportTouchRects, 40);
    return;
  }

  const pet = $('#pet');
  const btns = $('#petButtons');
  const dlg = $('#dialog');
  const chat = $('#chatBar');
  if (!pet) return;

  const petW = pet.offsetWidth || 110;
  const petH = pet.offsetHeight || 110;
  const petLeft = petX - petW / 2;
  const petTop = petY - petH / 2;

  try { B.setPetSize(petW, petH); } catch (e) {}

  const boxes = [{ el: pet, x: petLeft, y: petTop, w: petW, h: petH }];

  const btnW = btns ? (btns.offsetWidth || 0) : 0;
  const btnH = btns ? (btns.offsetHeight || 0) : 0;
  const btnTop = petTop + petH + 6;
  if (btnW && btnH) {
    boxes.push({ el: btns, x: petX - btnW / 2, y: btnTop, w: btnW, h: btnH });
  }

  if (dlg && !dlg.classList.contains('hidden')) {
    const dW = dlg.offsetWidth || 250;
    const dH = dlg.offsetHeight || 60;
    const dx = clamp(petX - dW / 2, PAD, Math.max(PAD, screenW - dW - PAD));
    const dy = Math.max(PAD, petTop - 8 - dH);
    boxes.push({ el: dlg, x: dx, y: dy, w: dW, h: dH });
  }

  if (chat && !chat.classList.contains('hidden')) {
    const cW = chat.offsetWidth || 250;
    const cH = chat.offsetHeight || 44;
    const cx = clamp(petX - cW / 2, PAD, Math.max(PAD, screenW - cW - PAD));
    const cy = btnTop + btnH + 8;
    boxes.push({ el: chat, x: cx, y: cy, w: cW, h: cH });
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  boxes.forEach(function (b) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  });
  if (!isFinite(minX)) return;

  let wx = Math.floor(minX - PAD);
  let wy = Math.floor(minY - PAD);
  let ww = Math.ceil(maxX - minX + PAD * 2);
  let wh = Math.ceil(maxY - minY + PAD * 2);
  ww = Math.min(ww, Math.round(screenW));
  wh = Math.min(wh, Math.round(screenH));
  wx = clamp(wx, 0, Math.max(0, Math.round(screenW) - ww));
  wy = clamp(wy, 0, Math.max(0, Math.round(screenH) - wh));

  lastBoxes = boxes;
  lastWinX = wx;
  lastWinY = wy;
  placeBoxes(boxes, wx, wy);

  requestResize(wx, wy, ww, wh);
  setTimeout(reportTouchRects, 0);
}

/* 原生最终窗口位置（可能被夹过）回报后，再摆一次 */
window.__layout = function (wx, wy) {
  if (typeof wx !== 'number') return;
  // 原生没有夹取窗口时不用再动，避免多余往返
  if (Math.abs(wx - lastWinX) < 1 && Math.abs(wy - lastWinY) < 1) return;
  lastWinX = wx;
  lastWinY = wy;
  if (lastBoxes) placeBoxes(lastBoxes, wx, wy);
  setTimeout(reportTouchRects, 0);
};

/* 窗口尺寸只做有限次调整：节流 + 变化阈值 + 熔断，杜绝 resize 死循环 */
let lastRect = null;
let resizeBudget = 12;
let budgetResetAt = 0;
let layoutTimer = null;

function scheduleLayout() {
  if (layoutTimer) return;
  layoutTimer = setTimeout(function () { layoutTimer = null; layout(); }, 130);
}

function requestResize(wx, wy, ww, wh) {
  const now = Date.now();
  if (now > budgetResetAt) {
    budgetResetAt = now + 4000;
    resizeBudget = 12;
  }
  if (lastRect) {
    const delta = Math.abs(lastRect[0] - wx) + Math.abs(lastRect[1] - wy) +
                  Math.abs(lastRect[2] - ww) + Math.abs(lastRect[3] - wh);
    if (delta < 6) return;
  }
  if (resizeBudget <= 0) return;
  resizeBudget--;
  lastRect = [wx, wy, ww, wh];
  try { B.setWindowRect(wx, wy, ww, wh); } catch (e) {}
}

function reportWindowRect() { scheduleLayout(); }
function reportSoon() { scheduleLayout(); }

function applyPetScale() {
  const s = parseFloat(S('petScale', '1')) || 1;
  document.documentElement.style.setProperty('--pet-scale', String(s));
  setTimeout(reportWindowRect, 80);
}

/* 历史面板要占满屏幕才放得下 */
function useFullScreenWindow() {
  try { B.setWindowRect(0, 0, screenW, screenH); } catch (e) {}
  setTimeout(reportTouchRects, 60);
}

/* ---------------- 模式 ---------------- */

function applyMode(expanded) {
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('compact', !expanded);
  if (!expanded) {
    $('#historyPanel').classList.add('hidden');
    $('#dialog').classList.add('hidden');
    $('#chatBar').classList.add('hidden');
    try { B.setFocusable(false); } catch (e) {}
    setTimeout(reportWindowRect, 40);
  }
}

function setMode(expanded) {
  applyMode(expanded);
  try { B.setFocusable(expanded); } catch (e) {}
  if (expanded) setTimeout(reportWindowRect, 40);
}

window.__setExpanded = function (v) { applyMode(!!v); };

window.__screen = function (w, h) {
  screenW = w;
  screenH = h;
  document.documentElement.style.setProperty('--screen-w', w + 'px');
  document.documentElement.style.setProperty('--screen-h', h + 'px');
  document.documentElement.style.setProperty('--dialog-max-h', Math.round(h * 0.55) + 'px');
  applyPetScale();
  setTimeout(reportWindowRect, 60);
};

window.__applySettings = function () {
  applyPetScale();
  setTimeout(reportWindowRect, 120);
};

/* 原生拖拽结束后调用，避免误触发点击 */
window.__suppressClick = function () {
  suppressClick = true;
  setTimeout(function () { suppressClick = false; }, 400);
};

/* ---------------- 对话框 ---------------- */

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
  reportSoon();

  const speed = parseInt(S('typeSpeed', '45'), 10) || 45;
  let i = 0;

  function tick() {
    if (!typing) return;
    if (skipTyping) {
      el.textContent = text;
      typing = false;
      reportSoon();
      return;
    }
    i++;
    el.textContent = text.slice(0, i);
    const ch = text.charAt(i - 1);
    if (ch && ch.trim() !== '') blip();
    if (i % 4 === 0) reportSoon();
    if (i < text.length) {
      setTimeout(tick, speed);
    } else {
      typing = false;
      reportSoon();
    }
  }
  tick();
}

function onClickDialog() {
  if (typing) {
    skipTyping = true;
  } else {
    $('#dialog').classList.add('hidden');
    $('#chatBar').classList.add('hidden');
    setMode(false);
  }
}

/* ---------------- 历史 ---------------- */

function addHistory(role, content) {
  try { B.addMessage(JSON.stringify({ role: role, content: content, time: Date.now() })); } catch (e) {}
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now());
  const p = (n) => (n < 10 ? '0' + n : '' + n);
  return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}

function historyItem(m) {
  const div = document.createElement('div');
  div.className = 'ut-box history-item';

  const bullet = document.createElement('span');
  bullet.className = 'bullet';
  bullet.textContent = '*';

  const body = document.createElement('div');
  body.className = 'dialog-body';

  const head = document.createElement('div');
  const who = document.createElement('span');
  who.className = 'who';
  who.textContent = m.role === 'user' ? '你' : 'SANS';
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = fmtTime(m.time);
  head.appendChild(who);
  head.appendChild(time);

  const text = document.createElement('div');
  text.textContent = m.content;

  body.appendChild(head);
  body.appendChild(text);
  div.appendChild(bullet);
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
  if (list.length < history.page) history.done = true;
  history.loading = false;
  setTimeout(reportTouchRects, 0);
}

function openHistory() {
  historyOpen = true;
  setMode(true);
  $('#dialog').classList.add('hidden');
  $('#chatBar').classList.add('hidden');
  $('#historyPanel').classList.remove('hidden');
  $('#historyList').scrollTop = 0;
  if (history.offset === 0) {
    history.done = false;
    loadMoreHistory();
  }
  useFullScreenWindow();
}

function closeHistory() {
  historyOpen = false;
  $('#historyPanel').classList.add('hidden');
  setMode(false);
  setTimeout(reportWindowRect, 40);
}

/* ---------------- 聊天 ---------------- */

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
  showDialog('...');
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

/* ---------------- 主动回复 ---------------- */

function proactiveTick() {
  if (S('proactive', '1') !== '1') return;
  if (busy || typing) return;
  if (Date.now() - lastSpeak < 3 * 60 * 1000) return;
  const rate = parseFloat(S('proactiveRate', '0.08')) || 0;
  if (Math.random() < rate) showDialog(pick(PROACTIVE));
}

/* ---------------- 事件 ---------------- */

document.addEventListener('touchstart', function () { initAudio(); }, { passive: true, once: true });
document.addEventListener('mousedown', function () { initAudio(); }, { once: true });

$('#pet').addEventListener('click', function () {
  if (suppressClick) return;
  initAudio();
  if (!$('#historyPanel').classList.contains('hidden')) {
    closeHistory();
    return;
  }
  showDialog(pick(REACTIONS));
});

$('#dialog').addEventListener('click', onClickDialog);
$('#chatBar').addEventListener('click', function (e) { e.stopPropagation(); });

$('#btnChat').addEventListener('click', function () {
  initAudio();
  setMode(true);
  $('#historyPanel').classList.add('hidden');
  $('#dialog').classList.remove('hidden');
  $('#chatBar').classList.remove('hidden');
  const dt = $('#dialogText');
  if (!dt.textContent.trim()) dt.textContent = '……说吧，我听着。';
  setTimeout(function () {
    reportWindowRect();
    $('#chatInput').focus();
  }, 200);
});

$('#btnSend').addEventListener('click', sendMessage);

$('#btnHistory').addEventListener('click', openHistory);
$('#btnHistoryClose').addEventListener('click', closeHistory);

$('#historyList').addEventListener('scroll', function () {
  const el = $('#historyList');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMoreHistory();
});

setInterval(proactiveTick, 45000);

window.addEventListener('load', function () {
  initAudio();
  applyPetScale();
  reportSoon();
  setTimeout(reportSoon, 300);
});
