/* SansPet 悬浮桌宠逻辑（固定窗口版） */

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

/* 戳一戳的预设语句：按「一小时内被戳多少次」分层 */
const POKE_TIERS = [
  {
    max: 2,
    hint: '他才刚开始戳你，语气亲切、随意，像老朋友打招呼。',
    lines: [
      '嘿，你来了。',
      '……嗯，我在呢。',
      '怎么啦？',
      '今天过得还行吗？',
      '我一直在这儿。'
    ]
  },
  {
    max: 5,
    hint: '他连着戳了你几下，你有点疑惑，但态度还是好的。',
    lines: [
      '戳我干嘛，痒。',
      '……又在玩我。',
      '有事就说，我听着。',
      '你手挺闲啊。'
    ]
  },
  {
    max: 10,
    hint: '他戳得有点多了，你开始吐槽他，但别刻薄。',
    lines: [
      '……你是不是没别的事干了。',
      '喂，我可看见了。',
      '再戳我就要收费了。',
      '……行吧，随你。'
    ]
  },
  {
    max: 20,
    hint: '他被戳得挺频繁，你有点烦，但不想伤他，用冷幽默挡一下。',
    lines: [
      '……你这手是坏了吗。',
      '我知道你在，别戳了。',
      '……我装作没感觉。',
      '再戳也不会有新反应。'
    ]
  },
  {
    max: 999999,
    hint: '他已经戳得离谱了，你彻底躺平，用极简短的回应表示放弃。',
    lines: [
      '……',
      '……我睡了。',
      'ZZZ',
      '……你开心就好。'
    ]
  }
];

/* 没有配 API Key 时，主动回复用的预设 */
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
let historyOpen = false;
let autoTimer = null;
const AUTO_NEXT_MS = 7000;

const history = { offset: 0, page: 20, done: false, loading: false };

/* ---------- 戳一戳计数：滑动一小时窗口，存在本地 ---------- */

function loadTapTimes() {
  try { return JSON.parse(S('tapTimes', '[]')) || []; } catch (e) { return []; }
}

/** 记一次戳，返回「最近一小时内的戳击次数」（含这次） */
function recordTap() {
  const now = Date.now();
  const arr = loadTapTimes().filter(function (t) { return now - t < 3600000; });
  arr.push(now);
  SS('tapTimes', JSON.stringify(arr));
  return arr.length;
}

function tierFor(count) {
  for (let i = 0; i < POKE_TIERS.length; i++) {
    if (count <= POKE_TIERS[i].max) return POKE_TIERS[i];
  }
  return POKE_TIERS[POKE_TIERS.length - 1];
}

function hasApiKey() {
  return (S('apiKey', '') || '').trim().length > 0;
}

/* 通用 AI 调用：hint 会追加到系统提示词，cb 收到 {ok, content} */
const pendingCb = {};

function aiAsk(userText, hint, cb) {
  const cbId = 'ai' + (++cbSeq);
  pendingCb[cbId] = cb;
  try {
    B.chat(JSON.stringify(buildPayload(userText, hint)), cbId);
  } catch (e) {
    delete pendingCb[cbId];
    cb({ ok: false, error: '调用失败' });
  }
}

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

/* ---------------- 上报给原生（只在需要时，绝不循环） ---------------- */

/* 宠物中心相对窗口左上角的偏移 —— 这就是拖拽基准点 */
function reportAnchor() {
  const pet = $('#pet');
  if (!pet || !pet.offsetWidth) return;
  // 用 offset* 而不是 getBoundingClientRect：
  // 后者会把「上下浮动」的动画位移算进去，导致锚点抖动、宠物被带着微移。
  // 纵坐标按「距窗口底边」算，这样窗口长高时宠物不会跟着跑。
  const winH = document.documentElement.clientHeight || 600;
  const ax = pet.offsetLeft + pet.offsetWidth / 2;
  const ay = winH - (pet.offsetTop + pet.offsetHeight / 2);
  try { B.setAnchor(ax, ay); } catch (e) {}
}

/* 只有这些方块接收触摸，窗口里的空白处穿透到桌面 */
function reportTouchRects() {
  const ids = ['pet', 'petButtons', 'dialog', 'chatBar', 'historyPanel'];
  const rects = [];
  ids.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.classList.contains('hidden')) return;
    if (!el.offsetWidth || !el.offsetHeight) return;
    const r = el.getBoundingClientRect();
    rects.push({ l: r.left, t: r.top, r: r.right, b: r.bottom });
  });
  try { B.setTouchRects(JSON.stringify(rects)); } catch (e) {}
}

function refresh() {
  const pet = $('#pet');
  const petH = pet && pet.offsetHeight ? pet.offsetHeight : 150;
  const petW = pet && pet.offsetWidth ? pet.offsetWidth : 110;

  // 对话框就贴在宠物正上方（跟着宠物高度走，不会留大片空隙）
  const dlg = $('#dialog');
  if (dlg) dlg.style.bottom = Math.round(petH + 98 + 8) + 'px';

  // 窗口尺寸 = 刚好装下所有槽位（只在尺寸真的变了的时候才会生效）
  const winW = Math.max(264, Math.round(petW) + 20);
  const winH = Math.round(petH + 98 + 8 + 130 + 10);
  try { B.setWindowSize(winW, winH); } catch (e) {}

  reportAnchor();
  reportTouchRects();
}

function applyPetScale() {
  const s = parseFloat(S('petScale', '1')) || 1;
  document.documentElement.style.setProperty('--pet-scale', String(Math.min(Math.max(s, 0.8), 1.8)));
  setTimeout(refresh, 60);
}

window.__applySettings = function () { applyPetScale(); };
window.__screen = function () { setTimeout(refresh, 60); };
window.__petPos = function () {};

window.__suppressClick = function () {
  suppressClick = true;
  setTimeout(function () { suppressClick = false; }, 400);
};

/* ---------------- 模式 ---------------- */

function applyMode(expanded) {
  document.body.classList.toggle('expanded', expanded);
  document.body.classList.toggle('compact', !expanded);
  if (!expanded) {
    $('#historyPanel').classList.add('hidden');
    $('#dialog').classList.add('hidden');
    $('#chatBar').classList.add('hidden');
    try { B.setFocusable(false); } catch (e) {}
  }
  setTimeout(refresh, 40);
}

function setMode(expanded) {
  applyMode(expanded);
  try { B.setFocusable(expanded); } catch (e) {}
}

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
  setTimeout(reportTouchRects, 40);

  const speed = parseInt(S('typeSpeed', '45'), 10) || 45;
  let i = 0;

  function tick() {
    if (!typing) return;
    if (skipTyping) {
      el.textContent = text;
      typing = false;
      scheduleAutoNext();
      return;
    }
    i++;
    el.textContent = text.slice(0, i);
    const ch = text.charAt(i - 1);
    if (ch && ch.trim() !== '') blip();
    if (i < text.length) {
      setTimeout(tick, speed);
    } else {
      typing = false;
      scheduleAutoNext();
    }
  }
  tick();
}

/* ---------- 分段：按句末标点断句，每句不超过 30 个字符 ---------- */

let dialogQueue = [];

function splitSentences(text) {
  const out = [];
  let buf = '';
  let dots = 0;
  const hardEnds = '。！？!?；;';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\n') {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      dots = 0;
      continue;
    }
    buf += ch;
    // 点类计数：英文句点算 1 个点，中文省略号算 3 个点
    if (ch === '.') dots += 1;
    else if (ch === '…') dots += 3;
    else dots = 0;

    let cut = false;
    if (hardEnds.indexOf(ch) >= 0) cut = true;
    else if (dots >= 6) cut = true;        // 满 6 个点才算省略号，才分段
    if (buf.length >= 30) cut = true;      // 单句不超过 30 字

    if (cut) {
      const s = buf.trim();
      if (s) out.push(s);
      buf = '';
      dots = 0;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.length ? out : [text];
}

/* 一整段话 → 拆成几句，逐句重新打字 */
function speak(text) {
  dialogQueue = splitSentences(text || '');
  showNextSegment();
}

function showNextSegment() {
  const seg = dialogQueue.shift();
  if (!seg) return;
  showDialog(seg, { expand: true });
}

/* 7 秒没人点，就自动播下一句 */
function scheduleAutoNext() {
  clearTimeout(autoTimer);
  if (dialogQueue.length > 0) {
    autoTimer = setTimeout(function () { showNextSegment(); }, AUTO_NEXT_MS);
  }
}

function closeDialog() {
  clearTimeout(autoTimer);
  autoTimer = null;
  dialogQueue = [];
  $('#dialog').classList.add('hidden');
  $('#chatBar').classList.add('hidden');
  setMode(false);
}

function onClickDialog() {
  clearTimeout(autoTimer);
  // 点对话框 = 直接显示完整这一句（不打断，只是加速）
  if (typing) {
    skipTyping = true;
    return;
  }
  if (dialogQueue.length > 0) {
    showNextSegment();
    return;
  }
  closeDialog();
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
}

function openHistory() {
  historyOpen = true;
  setMode(true);
  try { B.setCentered(true); } catch (e) {}
  $('#dialog').classList.add('hidden');
  $('#chatBar').classList.add('hidden');
  $('#historyPanel').classList.remove('hidden');

  // 每次打开都从头重新拉取，否则新消息不会出现
  history.offset = 0;
  history.done = false;
  history.loading = false;
  const box = $('#historyList');
  box.innerHTML = '';
  box.scrollTop = 0;
  loadMoreHistory();

  setTimeout(reportTouchRects, 40);
}

function closeHistory() {
  historyOpen = false;
  $('#historyPanel').classList.add('hidden');
  try { B.setCentered(false); } catch (e) {}
  setMode(false);
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
  const persona = (S('userPersona', '') || '').trim();
  if (persona) base += '\n\n关于用户：' + persona;
  return base;
}

function buildPayload(userText, hint) {
  const limit = parseInt(S('contextLimit', '50'), 10) || 50;
  let sys = buildSystemPrompt();
  if (hint) sys += '\n\n【当前情境】\n' + hint;
  const messages = [{ role: 'system', content: sys }];
  recentContext(limit).forEach(function (m) { messages.push(m); });
  messages.push({ role: 'user', content: userText });

  return {
    baseUrl: S('baseUrl', 'https://api.deepseek.com/v1'),
    apiKey: S('apiKey', ''),
    model: S('model', 'deepseek-flash'),
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
  dialogQueue = [];
  showDialog('...');
  busy = true;

  const cbId = 'cb' + (++cbSeq);
  pendingCb[cbId] = function (r) {
    busy = false;
    if (r.ok) {
      addHistory('assistant', r.content);
      speak(r.content);
    } else {
      speak('...出问题了。\n' + (r.error || ''));
    }
  };
  try {
    B.chat(JSON.stringify(buildPayload(text)), cbId);
  } catch (e) {
    delete pendingCb[cbId];
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
    speak(r.content);
  } else {
    showDialog('...出问题了。\n' + (r.error || ''));
  }
};

/* ---------------- 主动回复 ---------------- */

/* 戳一戳：没有 Key 一律预设；有 Key 按概率走 LLM */
function pokeOnce() {
  const count = recordTap();
  const tier = tierFor(count);
  let rate = parseFloat(S('pokeLlmRate', '0.5'));
  if (isNaN(rate)) rate = 0.5;

  const useLlm = hasApiKey() && Math.random() < rate;
  if (!useLlm) {
    speak(pick(tier.lines));
    return;
  }

  busy = true;
  showDialog('...');
  const hint = '用户刚刚戳了你一下。最近一小时内，他总共戳了你 ' + count + ' 次（包含刚才这次）。' +
               tier.hint +
               '\n\n现在用一句很短的话回应他，不超过 20 个字。只输出你要说的话，不要解释、不要旁白。';
  aiAsk('（用户戳了你一下）', hint, function (r) {
    busy = false;
    if (r.ok && r.content) {
      addHistory('assistant', r.content);
      speak(r.content);
    } else {
      speak(pick(tier.lines));
    }
  });
}

/* 主动回复：没 Key 用预设；有 Key 就让模型顺着之前的话题追问 */
function proactiveTick() {
  if (S('proactive', '1') !== '1') return;
  if (busy || typing) return;
  if (historyOpen) return;
  if (Date.now() - lastSpeak < 3 * 60 * 1000) return;

  const rate = parseFloat(S('proactiveRate', '0.08')) || 0;
  if (Math.random() >= rate) return;

  if (!hasApiKey()) {
    speak(pick(PROACTIVE));
    return;
  }

  busy = true;
  const hint = '现在你决定主动开口。' +
               '如果之前聊过什么，就顺着那个话题追问一句（比如问后来怎么样了、有没有好转）；' +
               '如果没什么可追问的，就说一句日常的关心。' +
               '\n\n不超过 25 个字。只输出你要说的话，不要解释、不要旁白。';
  aiAsk('（你决定主动开口）', hint, function (r) {
    busy = false;
    if (r.ok && r.content) {
      addHistory('assistant', r.content);
      speak(r.content);
    } else {
      speak(pick(PROACTIVE));
    }
  });
}

/* ---------------- 事件 ---------------- */

document.addEventListener('touchstart', function () { initAudio(); }, { passive: true, once: true });
document.addEventListener('mousedown', function () { initAudio(); }, { once: true });

/* 戳一戳限频：一秒最多 2 次 */
let lastTapAt = 0;

$('#pet').addEventListener('click', function () {
  if (suppressClick) return;

  // 正在打字 / 正在等回复：不响应
  if (typing || busy) return;

  clearTimeout(autoTimer);

  // 1. 还有没说完的句子 → 显示下一句
  if (dialogQueue.length > 0) {
    showNextSegment();
    return;
  }

  // 2. 话说完了但框还开着 → 先收起
  if (!$('#dialog').classList.contains('hidden')) {
    closeDialog();
    return;
  }

  // 3. 还有面板开着 → 关掉
  if (!$('#historyPanel').classList.contains('hidden')) {
    closeHistory();
    return;
  }

  // 4. 全关着，才是「戳一戳」（一秒最多 2 次）
  const now = Date.now();
  if (now - lastTapAt < 500) return;
  lastTapAt = now;
  initAudio();
  pokeOnce();
});

$('#dialog').addEventListener('click', onClickDialog);
$('#chatBar').addEventListener('click', function (e) { e.stopPropagation(); });

$('#btnChat').addEventListener('click', function () {
  initAudio();
  if (!$('#chatBar').classList.contains('hidden')) {
    closeDialog();
    return;
  }
  setMode(true);
  $('#historyPanel').classList.add('hidden');
  $('#dialog').classList.remove('hidden');
  $('#chatBar').classList.remove('hidden');
  const dt = $('#dialogText');
  if (!dt.textContent.trim()) dt.textContent = '……说吧，我听着。';
  setTimeout(function () {
    reportTouchRects();
    $('#chatInput').focus();
  }, 200);
});

$('#btnSend').addEventListener('click', sendMessage);

$('#btnHistory').addEventListener('click', openHistory);
$('#btnHistoryClose').addEventListener('click', closeHistory);
$('#btnHistoryTop').addEventListener('click', function () {
  const el = $('#historyList');
  if (el.scrollTo) el.scrollTo({ top: 0, behavior: 'smooth' });
  else el.scrollTop = 0;
});

$('#historyList').addEventListener('scroll', function () {
  const el = $('#historyList');
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) loadMoreHistory();
});

setInterval(proactiveTick, 45000);

window.addEventListener('load', function () {
  initAudio();
  applyPetScale();
  setTimeout(refresh, 100);
  setTimeout(refresh, 400);
});

$('#pet').addEventListener('load', function () { setTimeout(refresh, 60); });
