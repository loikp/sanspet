/* SansPet 悬浮桌宠逻辑（固定窗口版） */

const $ = (s) => document.querySelector(s);

/* 内置人设：优先用 persona.js（由 prompt/内置人设.txt 生成） */
const BUILTIN_FALLBACK = [
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

/* 内置人设：优先用 persona.js（由 prompt/内置人设.txt 生成），读不到才用上面的兜底 */
const DEFAULT_PROMPT =
  (window.__PERSONA && window.__PERSONA.builtin) || BUILTIN_FALLBACK.join('\n');

/* ================= 对话模式 =================

   chatMode: 'ai'     = 走接口
             'preset' = 纯预设（关键词匹配，没命中就随机）
   接口没配全（Base URL / Key / 模型 任一为空）→ 强制纯预设
   ============================================ */

function isAiReady() {
  return !!(S('baseUrl', '').trim() && S('apiKey', '').trim() && S('model', '').trim());
}

function useAi() {
  if (!isAiReady()) return false;
  return S('chatMode', 'ai') !== 'preset';
}

/* ================= 互动触发：走 AI 还是走预设 =================

   戳一戳 / 睡着 / 醒来 / 主动开口，全都用同一个概率（设置页那个滑块）。
   0 = 全用预设，1 = 全走 AI。
   接口没配好、或对话模式选了「纯预设」→ 一律走预设。
   ============================================================ */

function aiChance() {
  if (!useAi()) return 0;
  const v = parseFloat(S('pokeLlmRate', '0.5'));
  return isNaN(v) ? 0.5 : Math.max(0, Math.min(1, v));
}

function wantsAi() {
  return Math.random() < aiChance();
}

/* ================= 过滤"思考过程" =================

   模型偶尔会把推理过程当正文返回，比如：
     "用户给我看截图……我应该用 sans 的语气说一句不超 25 字的评价……"
   这类内容不能播出去，直接丢掉改用预设兜底。
   maxLen：短场景传 60；普通聊天传 0（只查关键词，不限长度）
   ================================================ */

const META_WORDS = [
  '我应该', '我该用', '我该说', '用户给我', '用户发来', '用户想让', '我看到',
  '截图里', '截图中有', '上一条', '这个细节', '注意截图', '语气说', '需要说一句',
  '要求我', '提示词', '模型', '思考过程', '让我想', '分析一下', '评价一个',
  '不超25', '不超过25', '字以内'
];

function looksLikeMeta(text, maxLen) {
  if (!text) return true;
  const s = String(text).trim();
  if (!s) return true;
  if (maxLen && s.length > maxLen) return true;
  for (let i = 0; i < META_WORDS.length; i++) {
    if (s.indexOf(META_WORDS[i]) >= 0) return true;
  }
  return false;
}

/* ================= 报错转成 Sans 的口气 =================

   模型超时 / 返回为空 / Key 不对 / 连不上网 ——
   原生把这些错误分类放在 kind 字段里（见 PetBridge.fail()），
   这里把它们换成 Sans 自己会说的话。
   括号里保留一句人话原因，方便你排查；完整原文打在控制台。

   想改台词：动下面的 ERR_LINES / ERR_TAGS 就行。
   想加分类：Kotlin 那边 fail("新kind", ...)，这里加一条即可。
   ====================================================== */

const ERR_LINES = {
  timeout: ['……你那边是不是卡了？我等到快睡着了。', '……半天没动静，你把我晾这儿了？', '……信号是不是被谁踩断了。'],
  empty:   ['……我张了张嘴，什么也没说出来。再来一次？', '……刚才那句话在我脑子里蒸发了。', '……脑子里一片空白，你再问一遍。'],
  config:  ['……钥匙都还没配好呢，去设置里填一下。', '……我连不上外面，接口还没填。'],
  auth:    ['……这钥匙开不了门，是不是写错了。', '……门卫把我拦下来了，Key 再核对一下？'],
  notfound:['……找不到那扇门，地址或者模型名不对吧。', '……这模型名我不认识，你确认一下？'],
  rate:    ['……喘口气，对面让我慢点问。', '……那头太挤了，等会儿再试。'],
  server:  ['……对面那台机器抽风了，不赖你。', '……不是你的问题，是它那边先趴下了。'],
  net:     ['……连不上外面，网是不是断了？', '……外面联系不上，看看网。'],
  http:    ['……对面回了我一句听不懂的。', '……路走不通，回头再试。'],
  other:   ['……我卡壳了。', '……出岔子了，再试一次？']
};

/* 括号里的短说明 —— 只讲人话，不放技术黑话 */
const ERR_TAGS = {
  timeout: '等太久没回音',
  empty: '模型没吐字',
  config: '接口没填全',
  auth: 'Key 或权限不对',
  notfound: '地址或模型名不对',
  rate: '被限流了',
  server: '对面服务器报错',
  net: '连不上网',
  http: '接口报错',
  other: '不知道哪出了问题'
};

/* 老版本原生没给 kind 时，从错误文本里猜一个 */
function guessErrorKind(msg) {
  const t = String(msg || '').toLowerCase();
  if (!t) return 'other';
  if (t.indexOf('timeout') >= 0 || t.indexOf('timed out') >= 0) return 'timeout';
  if (t.indexOf('返回为空') >= 0) return 'empty';
  if (t.indexOf('设置里填写') >= 0 || t.indexOf('请先填写') >= 0) return 'config';
  if (t.indexOf('http 401') >= 0 || t.indexOf('http 403') >= 0) return 'auth';
  if (t.indexOf('http 404') >= 0) return 'notfound';
  if (t.indexOf('http 429') >= 0) return 'rate';
  if (t.indexOf('http 5') >= 0) return 'server';
  if (t.indexOf('http ') >= 0) return 'http';
  if (t.indexOf('resolve') >= 0 || t.indexOf('connect') >= 0 ||
      t.indexOf('network') >= 0 || t.indexOf('socket') >= 0) return 'net';
  return 'other';
}

/** 把一次失败变成 Sans 的一句话（带一句人话原因） */
function errorLine(r) {
  const kind = (r && r.kind) || guessErrorKind(r && r.error);
  const lines = ERR_LINES[kind] || ERR_LINES.other;
  const tag = ERR_TAGS[kind] || ERR_TAGS.other;
  try { console.log('[SansPet] 请求失败 kind=' + kind + ' :: ' + ((r && r.error) || '')); } catch (e) {}
  return pick(lines) + '（' + tag + '）';
}

/* 互动统一入口：按概率决定让 AI 现场生成，还是直接说预设 */
function interactSpeak(userText, hint, presetLines) {
  if (wantsAi()) {
    busy = true;
    showDialog('...');
    aiAsk(userText, hint, function (r) {
      busy = false;
      if (r.ok && r.content && !looksLikeMeta(r.content, 60)) {
        addHistoryOnly('assistant', r.content);
        speak(r.content);
      } else if (presetLines && presetLines.length) {
        // 模型跑偏了就当没这回事，用预设顶上
        speak(pick(presetLines));
      }
    });
  } else if (presetLines && presetLines.length) {
    speak(pick(presetLines));
  }
}

/* 关键词怎么算命中。

   默认「话里出现就算」—— 中文和长英文都这样，所以 key "bye" 也能命中 "goodbye"、
   key "pap" 能命中 "papyrus"。

   但 1~2 个字母的短英文不行：key "hi" 会被 chilling / this / machine 里面的 hi 骗到。
   这类 key 改成「必须整个词对得上」（hi、say hi 命中；chilling、this 不命中）。

   规则按顺序扫，【先命中的那条赢】—— 想让某条优先，把它挪到数组最前面。 */
function keyHit(low, key) {
  const k = String(key || '').toLowerCase();
  if (!k) return false;
  if (/^[a-z]{1,2}$/.test(k)) {
    return new RegExp('(^|[^a-z])' + k + '(?![a-z])').test(low);
  }
  return low.indexOf(k) >= 0;
}

/* 纯预设对话：拿用户的话去匹配关键词，命中用对应语句，没命中随机 */
function presetReply(text) {
  const P = PRESETS;
  const low = String(text || '').toLowerCase();
  if (P && P.keywords && P.keywords.rules) {
    for (let i = 0; i < P.keywords.rules.length; i++) {
      const r = P.keywords.rules[i];
      const keys = r.keys || [];
      for (let k = 0; k < keys.length; k++) {
        if (keyHit(low, keys[k])) {
          if (r.lines && r.lines.length) return pick(r.lines);
        }
      }
    }
  }
  const fb = (P && P.keywords && P.keywords.fallback) || null;
  if (fb && fb.length) return pick(fb);
  return pick(PROACTIVE);
}

/* ================= 当前时间 ================= */

function nowText() {
  const d = new Date();
  const p = function (n) { return n < 10 ? '0' + n : '' + n; };
  const week = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
         p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + ' ' + week;
}

/* ================= 手机状态注入（电量 / 网络 / 耳机 …） =================

   目的：让模型知道一点「此刻的处境」，但绝不能把它变成手机播报员。

   两道闸：
     ① 阈值：只有真正值得说一句的才进候选
        （电量 ≤15% 且没充电、刚断网、刚戴耳机、刚静音、深夜还没睡…）
     ② 冷却：同一条信号被采纳后 3 小时内不再进候选
        （存在设置里，重启桌宠也记得）

   每轮请求最多塞 1 条，而且提示词里写死了「跟话题没关系就完全不要提」。
   想加新信号：往 collectEnvSignals() 的数组里加一条就行。
   ==================================================================== */

const ENV_COOLDOWN_MS = 3 * 60 * 60 * 1000;   // 同一条信号 3 小时内最多出现一次
const ENV_GLOBAL_GAP_MS = 30 * 60 * 1000;     // 不管哪一条，两次注入之间至少隔 30 分钟
const ENV_SNAP_TTL = 30000;                  // 状态快照缓存 30 秒，别每句话都去问一遍系统

let envSnap = null;
let envSnapAt = 0;
let envPrev = null;   // 上一次采样，用来判断「刚发生」（插电、戴耳机…）

/** 读手机状态快照 */
function envRead() {
  const now = Date.now();
  if (envSnap && now - envSnapAt < ENV_SNAP_TTL) return envSnap;
  let d = {};
  try { d = JSON.parse(B.deviceInfo() || '{}') || {}; } catch (e) { d = {}; }
  envSnap = d;
  envSnapAt = now;
  return d;
}

function envCooldowns() {
  try { return JSON.parse(S('envCooldown', '{}')) || {}; } catch (e) { return {}; }
}

/** 这条信号是不是还在冷却里 */
function envRecent(key) {
  const t = envCooldowns()[key];
  return !!t && Date.now() - t < ENV_COOLDOWN_MS;
}

/** 记一次「用过了」，顺手清掉过期项免得这个 JSON 越滚越大 */
function envMarkUsed(key) {
  const c = envCooldowns();
  const now = Date.now();
  c[key] = now;
  Object.keys(c).forEach(function (k) {
    if (now - c[k] >= ENV_COOLDOWN_MS) delete c[k];
  });
  SS('envCooldown', JSON.stringify(c));
}

/** 收集「此刻值得说」的信号；prev 为 null 时不判断「刚发生」这类变化 */
function collectEnvSignals(d, prev) {
  const out = [];
  const hour = new Date().getHours();
  const night = hour >= 23 || hour < 6;

  if (typeof d.battery === 'number' && d.battery <= 15 && d.charging === false) {
    out.push({ key: 'batteryLow', text: '手机电量只剩 ' + d.battery + '%，而且没插充电器' });
  }
  if (prev && prev.charging === false && d.charging === true) {
    out.push({ key: 'plugged', text: '他刚把手机插上充电器' });
  }
  if (d.network === 'offline') {
    out.push({ key: 'offline', text: '手机现在没连上网' });
  }
  if (prev && prev.headset === false && d.headset === true) {
    out.push({ key: 'headsetOn', text: '他刚戴上耳机' });
  }
  if (prev && prev.silent === false && d.silent === true) {
    out.push({ key: 'silentOn', text: '他把手机调成静音了' });
  }
  if (prev && prev.music === false && d.music === true) {
    out.push({ key: 'musicOn', text: '他刚放起了音乐或者视频' });
  }
  if (lastFgSeen && Date.now() - lastFgAt < FG_FRESH_MS) {
    out.push({ key: 'foreground', text: '他刚才在用「' + lastFgSeen + '」' });
  }
  if (screenStreakMin() >= SCREEN_STREAK_MIN) {
    out.push({
      key: 'longScreen',
      text: '他已经连着用手机 ' + Math.floor(screenStreakMin() / 60) + ' 个多小时了，一直没放下'
    });
  }
  if (night) {
    out.push({ key: 'night', text: '现在是深夜/凌晨，他还没睡' });
  }
  return out;
}

/** 挑一条要注入的（本轮没有就返回空串） */
function envInject() {
  let d;
  try { d = envRead(); } catch (e) { return ''; }
  const prev = envPrev;
  envPrev = d;                      // 不管这次用不用，采样都要推进

  // 全局闸：刚塞过一次就先歇着，免得聊天一热闹它每条都要感慨一遍
  const cools = envCooldowns();
  if (cools.__last && Date.now() - cools.__last < ENV_GLOBAL_GAP_MS) return '';

  const fresh = collectEnvSignals(d, prev).filter(function (s) {
    return !envRecent(s.key);
  });
  if (!fresh.length) return '';

  const s = pick(fresh);
  envMarkUsed(s.key);
  envMarkUsed('__last');
  // 这两条是「事件」而不是「状态」：用掉就清掉，
  // 必须等下一次真正的新观测才可能再出现
  if (s.key === 'foreground') { lastFgSeen = ''; lastFgAt = 0; }
  if (s.key === 'longScreen') screenOnSince = Date.now();

  return '【手机状态】' + s.text + '。\n' +
         '这只是背景，默认不要提 —— 不要报数字，也不要主动汇报手机状态。\n' +
         '只有当它跟这句话题自然相关时才顺口带一句（比如他说要出门了 → 提一句快没电了）。' +
         '跟话题没关系就完全不要提。';
}

/* ================= 每 60 秒偷看一眼 =================

   有两个信号不能等到「用户来戳我」那一刻才采：
   戳桌宠的时候人正站在桌面上，前台永远是桌面；
   连续亮屏时长更是只有定时采样才记得住。
   所以每 60 秒静默采一次，记在旁边。
   ==================================================== */

const SAMPLE_MS = 60000;
const SCREEN_STREAK_MIN = 120;   // 连续亮屏多久算「一直没放下手机」（分钟）
const FG_FRESH_MS = 30 * 60 * 1000;  // 前台 App 超过 30 分钟就算过时，不再提

let screenOnSince = 0;   // 0 = 屏幕是关的
let lastFgSeen = '';     // 最近一次看到的前台 App（桌面和它自己已在原生过滤掉）
let lastFgAt = 0;        // 上面那个是什么时候看到的

function screenStreakMin() {
  if (!screenOnSince) return 0;
  return (Date.now() - screenOnSince) / 60000;
}

function sampleDevice() {
  let d;
  try { d = envRead(); } catch (e) { return; }
  if (d.screenOn === true) {
    if (!screenOnSince) screenOnSince = Date.now();
  } else {
    screenOnSince = 0;
  }
  // 只在亮着屏的时候记，否则锁屏前开着的那个 App 会被当成"他刚才在用"
  if (d.screenOn === true && d.foreground) {
    lastFgSeen = d.foreground;
    lastFgAt = Date.now();
  }
}

/* ================= 状态机：清醒 / 睡眠 =================
   太久没人理 → 有概率睡着
   睡着时 → 隔一会儿有概率说梦话
   被戳 → 醒（拖动不会，因为拖动不会触发点击）
   ============================================ */

/* 状态机在原生那边跑，网页只负责「表现 + 说话」 */

let asleep = false;

window.__onSleep = function () {
  asleep = true;
  document.body.classList.add('sleeping');
  if (sleepFrames.length) playFrames(sleepFrames, 0, null, SLEEP_FRAME_MS);
  const lines = (PRESETS && PRESETS.states && PRESETS.states.sleeping &&
                 PRESETS.states.sleeping.lines) || ['……', 'Zzz'];
  interactSpeak('（你困得睡着了）',
    '你刚刚睡着了。用一句很短的话当作睡前嘀咕，不超过 15 个字。只输出你要说的话，不要解释、不要旁白。',
    lines);
};

window.__onWake = function () {
  asleep = false;
  document.body.classList.remove('sleeping');
  stopFrames();
  const pet = $('#pet');
  if (pet) pet.src = IDLE_SRC;
  // 优先用 presets.json 的 triggers.pokeWhileSleeping（以前这份一直是死的），
  // 没写才回落到 states.waking
  const lines = presetLines('pokeWhileSleeping') ||
                (PRESETS && PRESETS.states && PRESETS.states.waking &&
                 PRESETS.states.waking.lines) || ['……嗯？'];
  const mood = currentMood();
  interactSpeak('（用户把你戳醒了）',
    withMoodHint(
      '你刚被戳醒，迷迷糊糊的。用一句很短的话回应，不超过 15 个字。只输出你要说的话，不要解释、不要旁白。',
      mood),
    lines);
};

/* 梦话：睡着时每 3 分钟掷一次，15% 概率说一句 */
let sleepTalkTimer = null;

function startSleepTalk() {
  if (sleepTalkTimer) return;
  sleepTalkTimer = setInterval(function () {
    if (!asleep || typing || busy) return;
    const lines = (PRESETS && PRESETS.sleepTalk && PRESETS.sleepTalk.lines) || null;
    if (lines && lines.length && Math.random() < 0.15) speak(pick(lines));
  }, 3 * 60 * 1000);
}

/* ================= 行走序列帧 =================
   有素材就用 walk/<方向>_<帧>.png（0~3），没有就退回静态图
   ============================================ */

const walkOK = {};
let walkDir = 'none';
let walkTimer = null;

/* ================= 角色素材目录 =================

   全部角色图放在 assets/character/ 下：
       character/idle.png           待机主图（没有就退回 sans.png）
       character/sleep.png          睡觉（没有就把主图放倒+半透明）
       character/walk/<方向>_<帧>.png
       character/face/<名字>.png

   这里的常量只改一处，其他地方都用它拼路径。
   ============================================== */

const CHAR_DIR = 'character/';
const WALK_DIR = CHAR_DIR + 'walk/';
const FACE_DIR = CHAR_DIR + 'face/';

/* ================= 角色视觉中心对齐 =================

   素材画布不一定对称（比如 idle 左右留白 332/275），
   直接按画布居中会让按钮偏掉。
   这里把图缩小到 200px 扫一遍 alpha，算出角色的真实横向中心，
   再把按钮和对话框平移过去。
   ==================================================== */

let spriteShift = 0;
let spriteShiftRatio = null;

function measureSpriteCenter(src) {
  const img = new Image();
  img.onload = function () {
    try {
      const W = 200;
      const sc = W / img.width;
      const c = document.createElement('canvas');
      c.width = W;
      c.height = Math.max(1, Math.round(img.height * sc));
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let minX = c.width, maxX = -1;
      for (let y = 0; y < c.height; y++) {
        const row = y * c.width;
        for (let x = 0; x < c.width; x++) {
          if (d[(row + x) * 4 + 3] > 8) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }
      if (maxX < 0) return;
      applySpriteShift((minX + maxX) / 2 / c.width);
    } catch (e) {}
  };
  img.src = src;
}

function applySpriteShift(cx) {
  const pet = $('#pet');
  if (!pet || cx == null) return;
  const w = pet.offsetWidth || 110;
  spriteShiftRatio = cx;
  spriteShift = (cx - 0.5) * w;
  document.documentElement.style.setProperty('--sprite-shift', spriteShift.toFixed(1) + 'px');
}

/* ---------- 序列帧通用工具 ----------
   探测 <base>_0.png / _1.png / … 直到缺一张为止。
   每 0.5 秒换一帧，循环播放。
   ------------------------------------ */

const WALK_FRAME_MS = 200;   // 行走：每 200ms 一张
const FACE_FRAME_MS = 250;   // 表情：每 250ms 一张
const SLEEP_FRAME_MS = 500;  // 睡觉：呼吸感慢一点
const MAX_FRAMES = 16;

function loadSequence(base, cb) {
  const frames = [];
  let i = 0;
  function probe() {
    if (i >= MAX_FRAMES) { cb(frames); return; }
    const img = new Image();
    img.onload = function () { frames.push(base + '_' + i + '.png'); i++; probe(); };
    img.onerror = function () { cb(frames); };
    img.src = base + '_' + i + '.png';
  }
  probe();
}

let playAnim = null;
let playTimer = null;

/* duration > 0 → 播完后回调；duration = 0 → 一直播（睡觉用） */
function playFrames(frames, duration, onEnd, intervalMs) {
  stopFrames();
  const pet = $('#pet');
  if (!pet || !frames || !frames.length) return;
  const ms = intervalMs || FACE_FRAME_MS;

  let i = 0;
  pet.src = frames[0];
  if (frames.length > 1) {
    playAnim = setInterval(function () {
      i = (i + 1) % frames.length;
      pet.src = frames[i];
    }, ms);
  }
  if (duration > 0) {
    playTimer = setTimeout(function () {
      stopFrames();
      if (onEnd) onEnd();
    }, duration);
  }
}

function stopFrames() {
  if (playAnim) { clearInterval(playAnim); playAnim = null; }
  if (playTimer) { clearTimeout(playTimer); playTimer = null; }
}

/* 主图路径：探测到 character/idle.png 就用它，否则用根目录的 sans.png */
let IDLE_SRC = 'sans.png';
let sleepFrames = [];
const faceFrames = {};

function probeCharacter() {
  const main = new Image();
  main.onload = function () {
    IDLE_SRC = CHAR_DIR + 'idle.png';
    const pet = $('#pet');
    if (pet && !asleep && walkDir === 'none') pet.src = IDLE_SRC;
    measureSpriteCenter(IDLE_SRC);
  };
  main.onerror = function () { IDLE_SRC = 'sans.png'; };
  main.src = CHAR_DIR + 'idle.png';

  // 睡觉：character/sleep_0.png, _1.png …
  loadSequence(CHAR_DIR + 'sleep', function (frames) {
    sleepFrames = frames;
    // 有专用睡觉图时，关掉「放倒+半透明」的兜底样式
    document.body.classList.toggle('has-sleep-img', frames.length > 0);
  });
}

/* ================= 待机表情 =================

   待机时会隔一阵子换个表情（wink / blink / look），持续 10 秒后复原。
   素材放 assets/face/<名字>.png，例如：
       face/wink.png    眨眼
       face/blink.png   合眼
       face/look.png    眼睛瞟别处
   只有真正存在的那几张会被用；一张都没有就什么都不做（占位）。

   触发条件：待机中、没睡觉、没走动、没开着对话框
   ============================================ */

const FACE_NAMES = ['wink', 'blink', 'look'];
const faceOK = {};
const FACE_HOLD_MS = 10000;

function probeFaces() {
  FACE_NAMES.forEach(function (name) {
    // 先试动画帧 wink_0.png / wink_1.png …
    loadSequence(FACE_DIR + name, function (frames) {
      if (frames && frames.length) { faceFrames[name] = frames; return; }
      // 没有动画帧就试单张 wink.png
      const img = new Image();
      img.onload = function () { faceFrames[name] = [FACE_DIR + name + '.png']; };
      img.onerror = function () { faceFrames[name] = []; };
      img.src = FACE_DIR + name + '.png';
    });
  });
}

function availableFaces() {
  return FACE_NAMES.filter(function (n) { return faceFrames[n] && faceFrames[n].length; });
}

function showExpression() {
  if (asleep || busy || typing) return;
  if (walkDir !== 'none') return;
  if (!$('#dialog').classList.contains('hidden')) return;

  const names = availableFaces();
  if (!names.length) return;          // 没素材就什么都不做

  const frames = faceFrames[pick(names)];
  playFrames(frames, FACE_HOLD_MS, function () {
    if (walkDir === 'none' && !asleep) {
      const pet = $('#pet');
      if (pet) pet.src = IDLE_SRC;
    }
  });
}

function scheduleExpression() {
  // 1~3 分钟看一次，30% 概率做个表情
  const delay = (60 + Math.random() * 120) * 1000;
  setTimeout(function () {
    if (Math.random() < 0.3) showExpression();
    scheduleExpression();
  }, delay);
}


function probeWalkFrames() {
  ['down', 'left', 'right', 'up'].forEach(function (dir) {
    const img = new Image();
    img.onload = function () { walkOK[dir] = true; };
    img.onerror = function () { walkOK[dir] = false; };
    img.src = WALK_DIR + dir + '_0.png';
  });
}

window.__setWalk = function (dir) {
  if (dir === walkDir) return;
  walkDir = dir;
  const pet = $('#pet');
  if (!pet) return;

  if (walkTimer) { clearInterval(walkTimer); walkTimer = null; }

  if (dir === 'none') {
    pet.classList.remove('walking');
    pet.src = IDLE_SRC;
    return;
  }

  pet.classList.add('walking');
  if (walkOK[dir]) {
    let f = 0;
    pet.src = WALK_DIR + dir + '_0.png';
    walkTimer = setInterval(function () {
      f = (f + 1) % 4;
      pet.src = WALK_DIR + dir + '_' + f + '.png';
    }, WALK_FRAME_MS);
  } else {
    pet.src = IDLE_SRC;
  }
};

/* 戳一戳的预设语句：按「一小时内被戳多少次」分层 */
let POKE_TIERS = [
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

/* ---------------- 预设对话：从 presets.json 读 ----------------

   读不到就用上面内置的兜底，不会白屏。
   以后接状态机，用 presetLines(触发, 状态, 情绪) 按优先级取话。
   ------------------------------------------------------------ */

let PRESETS = null;

function loadPresets() {
  try {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', 'presets.json', true);
    xhr.onload = function () {
      if (xhr.status !== 200 && xhr.status !== 0) return;
      try {
        const p = JSON.parse(xhr.responseText);
        if (!p) return;
        PRESETS = p;
        const t = p.triggers || {};
        if (t.poke && t.poke.byCount && t.poke.byCount.length) {
          POKE_TIERS = t.poke.byCount;
        }
        if (t.proactive && t.proactive.lines && t.proactive.lines.length) {
          PROACTIVE = t.proactive.lines;
        }
      } catch (e) {}
    };
    xhr.send();
  } catch (e) {}
}

/* 按名字取一组预设语句：presetLines('pokeWhileSleeping')。

   注意：参数表虽然还留着 (触发, 状态, 情绪)，但那个「优先级链」从来没跑过 ——
   第一级命中就直接 return 了，后面永远轮不到。情绪不走这里，
   走上面的 moodLines() / linesWithMood()。 */
function presetLines(triggerName, stateName, moodName) {
  const P = PRESETS;
  if (!P) return null;
  if (triggerName && P.triggers && P.triggers[triggerName] &&
      P.triggers[triggerName].lines && P.triggers[triggerName].lines.length) {
    return P.triggers[triggerName].lines;
  }
  if (stateName && P.states && P.states[stateName] &&
      P.states[stateName].lines && P.states[stateName].lines.length) {
    return P.states[stateName].lines;
  }
  if (moodName && P.moods && P.moods[moodName] &&
      P.moods[moodName].lines && P.moods[moodName].lines.length) {
    return P.moods[moodName].lines;
  }
  return null;
}

/* 没有配 API Key 时，主动回复用的预设 */
let PROACTIVE = [
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

/* ================= 情绪 =================

   情绪不是随机骰出来的 —— 那是你戳出来的结果。
   规则全部在 currentMood() 里，想改只动那一个函数。

   情绪不是「取话取不到时的备胎」（那样永远轮不到），而是当语调用：
     · AI 模式：写进 hint，让模型自己带情绪说话
     · 预设模式：有情绪时，有一定概率改用 presets.json 里 moods 那一池

   对应的台词在 presets.json → moods 里改。
   ======================================== */

const MOOD_POKE_SHARE = 0.4;   // 有情绪时，戳一戳有多大概率改抽情绪池

/* 情绪 → 给模型看的一句话（AI 模式用） */
const MOOD_HINT = {
  happy:   '你现在心情不错。',
  tired:   '你现在有点困，说话懒洋洋的。',
  annoyed: '你被戳得有点烦了，但别刻薄，用冷幽默挡一下。'
};

/** 只读：最近一小时被戳了几次 */
function recentTapCount() {
  const now = Date.now();
  return loadTapTimes().filter(function (t) { return now - t < 3600000; }).length;
}

/**
 * 现在是什么情绪，没有就返回 null。
 * 判定规则（从上往下，先命中先用）：
 *   一小时内被戳 > 20 次  → annoyed
 *   23:00 ~ 06:00 还醒着  → tired
 *   一小时内被戳 ≤ 2 次   → happy
 *   其余                  → 没情绪
 */
function currentMood() {
  if (asleep) return null;
  const count = recentTapCount();
  if (count > 20) return 'annoyed';
  if (isNightHour()) return 'tired';
  if (count <= 2) return 'happy';
  return null;
}

/** 取某个情绪那一池台词；没有就返回 null */
function moodLines(name) {
  const P = PRESETS;
  if (!P || !name || !P.moods) return null;
  const m = P.moods[name];
  if (m && m.lines && m.lines.length) return m.lines;
  return null;
}

/** 有情绪时，有 share 概率改用情绪池，否则用原来的池子 */
function linesWithMood(baseLines, mood, share) {
  if (mood && Math.random() < share) {
    const l = moodLines(mood);
    if (l) return l;
  }
  return baseLines;
}

/** 把情绪接在提示词尾巴上（AI 模式） */
function withMoodHint(hint, mood) {
  if (!mood || !MOOD_HINT[mood]) return hint;
  return hint + '\n【当前情绪】' + MOOD_HINT[mood];
}

function hasApiKey() {
  return (S('apiKey', '') || '').trim().length > 0;
}

/* 通用 AI 调用：hint 会追加到系统提示词，cb 收到 {ok, content} */
const pendingCb = {};

function aiAsk(userText, hint, cb, imageB64) {
  const cbId = 'ai' + (++cbSeq);
  pendingCb[cbId] = cb;
  try {
    B.chat(JSON.stringify(buildPayload(userText, hint, imageB64)), cbId);
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

  // 窗口尺寸 = 刚好装下所有槽位
  // 对话框缩小后是 175 x 91（要和 CSS 里的 #dialog 一致），窗口也跟着缩
  const DIALOG_W = 175;
  const DIALOG_MAX_H = 91;
  const winW = Math.max(DIALOG_W + 16, Math.round(petW) + 20);
  const winH = Math.round(petH + 98 + 8 + DIALOG_MAX_H + 10);
  try { B.setWindowSize(winW, winH); } catch (e) {}

  reportAnchor();
  reportTouchRects();
}

function applyPetScale() {
  const s = parseFloat(S('petScale', '1')) || 1;
  document.documentElement.style.setProperty('--pet-scale', String(Math.min(Math.max(s, 0.8), 1.8)));
  setTimeout(refresh, 60);
}

/* 把「读屏 / 使用数据」的间隔和概率推给原生（掷骰子在原生那边做） */
function pushReadConfig() {
  try {
    B.setReadConfig(JSON.stringify({
      screenEnabled: S('screenRead', '0') === '1',
      screenMin: parseFloat(S('screenMinMinutes', '60')) || 60,
      screenMax: parseFloat(S('screenMaxMinutes', '180')) || 180,
      screenChance: parseFloat(S('screenChance', '0.4')),
      usageEnabled: S('usageRead', '0') === '1',
      usageMin: parseFloat(S('usageMinMinutes', '30')) || 30,
      usageMax: parseFloat(S('usageMaxMinutes', '90')) || 90,
      usageChance: parseFloat(S('usageChance', '0.4'))
    }));
  } catch (e) {}
}

/* 把走动参数打包推给原生 */
function pushWalkConfig() {
  // 参数固定：间隔 3~10 分钟、移动概率 0.6、连走 0.35、递减 0.5
  try { B.setWalkConfig(JSON.stringify({ enabled: S('walkEnabled', '0') === '1' })); } catch (e) {}
}

window.__applySettings = function () {
  applyPetScale();
  pushWalkConfig();
  pushReadConfig();
  try { B.setLocked(S('lockPosition', '0') === '1'); } catch (e) {}
};
window.__screen = function () { setTimeout(refresh, 60); };
window.__petPos = function () {};

/* 设置页清了历史，通知悬浮窗刷新 */
window.__onHistoryCleared = function () {
  history.offset = 0;
  history.done = false;
  history.loading = false;
  const box = $('#historyList');
  if (box) box.innerHTML = '<div class="history-empty">还没有对话。</div>';
};

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

/* ================= 分段规则 =================

   单位：中文/全角 = 2 个单位，英文/数字/半角 = 1 个单位
   上限：60 个单位（= 30 个中文字）

   第一遍（正则）：只在真正的句末标点后断开
       可以断：。 ！ ？ ! ? ； ;
       不能断：句点 .   省略号 …   空格   星号 *   逗号   等

   第二遍：省略号才断
       满 6 个点（......）或两个省略号（……）→ 断
       单个 .  或单个 …  → 不断

   第三遍（兜底）：只有某一句超过 60 个单位，才按长度再切
       英文优先在空格处断，切不齐才硬切

   整个过程不改动原文一个字
   ============================================ */

const MAX_UNITS = 60;
const CJK_START = 0x1100;
const SOFT_BREAKS = ' ,，、';

function charUnits(ch) {
  return (ch.codePointAt(0) >= CJK_START) ? 2 : 1;
}

function textUnits(str) {
  let n = 0;
  for (const ch of str) n += charUnits(ch);
  return n;
}

/* 第一遍：按句末标点切句（标点跟着前一句） */
function splitByPunctuation(text) {
  const re = /[^。！？!?；;\n]+[。！？!?；;]+[」』”’）)】》]*|[^。！？!?；;\n]+/g;
  const parts = String(text || '').match(re) || [];
  const out = [];
  parts.forEach(function (p) {
    const t = p.trim();
    if (t) out.push(t);
  });
  return out;
}

/* 第二遍：省略号断句（保留原来的点，不改写） */
function splitEllipsis(part) {
  const out = [];
  const re = /\.{6,}|…{2,}/g;
  let idx = 0;
  let m;
  while ((m = re.exec(part)) !== null) {
    const end = m.index + m[0].length;
    const seg = part.slice(idx, end).trim();
    if (seg) out.push(seg);
    idx = end;
  }
  const tail = part.slice(idx).trim();
  if (tail) out.push(tail);
  return out.length ? out : [part];
}

/* 第三遍：太长的句子按单位切
   规则：取「最靠后的一个可断点」——空格或逗号类；
        没有可断点才硬切（中文任意位置可断，英文靠空格保证不切单词） */
function splitLong(part, max) {
  const out = [];
  const chars = Array.from(part);
  let buf = '';
  let units = 0;
  let breakAt = -1;   // 最近一个可断点（空格 / 逗号 / 顿号）

  function flush() {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
    units = 0;
    breakAt = -1;
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const u = charUnits(ch);

    if (units + u > max && buf) {
      if (breakAt > 0) {
        out.push(buf.slice(0, breakAt).trim());
        const rest = buf.slice(breakAt);
        buf = rest;
        units = textUnits(rest);
        breakAt = -1;
      } else {
        flush();
      }
    }

    buf += ch;
    units += u;
    if (ch === ' ' || ch === '\t' || ch === '，' || ch === ',' || ch === '、') {
      breakAt = buf.length;
    }
  }
  flush();
  return out;
}

function splitSentences(text) {
  const out = [];
  splitByPunctuation(text).forEach(function (p) {
    splitEllipsis(p).forEach(function (q) {
      if (textUnits(q) <= MAX_UNITS) {
        out.push(q);
      } else {
        splitLong(q, MAX_UNITS).forEach(function (x) { if (x) out.push(x); });
      }
    });
  });
  return out.length ? out : [String(text || '')];
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

/* 普通聊天：历史和记忆都写 */
function addHistory(role, content) {
  try { B.addMessage(JSON.stringify({ role: role, content: content, time: Date.now() })); } catch (e) {}
}

/* 环境行为（戳/读屏/使用数据/睡觉）：只写历史，不污染上下文 */
function addHistoryOnly(role, content) {
  try { B.addMessageOnly(JSON.stringify({ role: role, content: content, time: Date.now() })); } catch (e) {}
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

/* 发给模型的上下文 = 记忆那一份（不是对话历史那一份）
   两者分开存，用户可以在设置里单独清掉其一 */
function recentContext(limit) {
  let arr = [];
  try { arr = JSON.parse(B.getMemory(0, limit)) || []; } catch (e) {}
  arr.reverse();
  return arr
    .filter(function (m) { return m.role === 'user' || m.role === 'assistant'; })
    .map(function (m) { return { role: m.role, content: m.content }; });
}

/* 系统提示词 = 内置人设 + 用户追加内容 + 用户名 + 用户人设
   追加内容只做「增加」，不会覆盖内置人设 */
/* ================= 提示词组装 =================

   关键原则：系统提示词必须是「逐字节不变」的。
   因为服务端（DeepSeek 等）会对相同前缀做缓存，
   缓存命中的输入只收 1/10 左右的价格。

   所以：
     系统提示词 = 内置人设 + 额外设定 + 用户名 + 用户人设   ← 不含时间、不含情境
     动态内容  = 当前时间 + 当次情境                        ← 塞到最后一条 user 消息里

   之前把「秒级时间」写进系统提示词，导致前缀每秒都在变，
   缓存永远不命中，等于每次都白付全价。
   ============================================== */

/* App 层面的固定设定。和用户的人设文件分开写，
   这样即使用户清空了自己的追加内容，这段也不会丢。 */
const APP_LORE = [
  '【运行环境】',
  '你现在运行在用户的手机上，是一个常驻桌面的悬浮桌宠。',
  '桌面上那个悬浮的像素骷髅小人就是你本人 —— 不是别的角色，也不是你的"形象代言"。',
  '用户允许的时候，你能看到他的手机屏幕，那就像你从手机里往外看，不要说得像在看别人的东西。',
  '你被限制在这台手机里，出不去。',
  '深夜（23:00–06:00）的时候说话更轻、更短，别大惊小怪，也别催他去睡觉。'
].join('\n');

function buildStableSystemPrompt() {
  let base = DEFAULT_PROMPT + '\n\n' + APP_LORE;

  const extra = (S('systemPrompt', '') || '').trim();
  if (extra) base += '\n\n【额外设定】\n' + extra;

  const name = (S('userName', '') || '').trim();
  if (name) base += '\n\n用户名字：' + name;

  const persona = (S('userPersona', '') || '').trim();
  if (persona) base += '\n\n关于用户：' + persona;

  return base;
}

/* 每次都会变的内容，拼到最后一条消息的尾巴上。
   withEnv = false 时不注入手机状态（读屏那次已经有截图了，别再加噪音） */
function buildDynamicTail(hint, withEnv) {
  const parts = [];
  parts.push('【当前时间】' + nowText() + '（北京时间）');
  if (hint) parts.push('【当前情境】\n' + hint);
  if (withEnv !== false) {
    const env = envInject();
    if (env) parts.push(env);
  }
  return parts.join('\n\n');
}

function buildPayload(userText, hint, imageB64) {
  const limit = parseInt(S('contextLimit', '50'), 10) || 50;

  const messages = [{ role: 'system', content: buildStableSystemPrompt() }];
  recentContext(limit).forEach(function (m) { messages.push(m); });

  let tail = userText;
  const dyn = buildDynamicTail(hint, !imageB64);
  if (dyn) tail += '\n\n' + dyn;

  // 有图就走视觉模型的多段格式
  if (imageB64) {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: tail },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageB64 } }
      ]
    });
  } else {
    messages.push({ role: 'user', content: tail });
  }

  return {
    baseUrl: S('baseUrl', 'https://api.deepseek.com/v1'),
    apiKey: S('apiKey', ''),
    model: S('model', 'deepseek-flash'),
    messages: messages
  };
}

function sendMessage() {
  const input = $('#chatInput');
  const text = (input.value || '').trim();
  if (!text || busy) return;
  input.value = '';
  try { B.markInteraction(); } catch (e) {}

  // 纯预设模式：不请求接口，直接按关键词回预设
  if (!useAi()) {
    addHistory('user', text);
    const line = presetReply(text);
    addHistory('assistant', line);
    dialogQueue = [];
    showDialog('...');
    setTimeout(function () { speak(line); }, 120);
    return;
  }

  // 先拼请求（此时这条还没进历史，避免同一条被发两遍），再写历史
  const payload = buildPayload(text);

  addHistory('user', text);
  dialogQueue = [];
  showDialog('...');
  busy = true;

  const cbId = 'cb' + (++cbSeq);
  pendingCb[cbId] = function (r) {
    busy = false;
    if (r.ok && !looksLikeMeta(r.content, 0)) {
      addHistory('assistant', r.content);
      speak(r.content);
    } else if (r.ok) {
      // 又一次把思考吐出来了，再要一遍
      speak('……你再说一遍，刚才那句我没听清。');
    } else {
      speak(errorLine(r));
    }
  };
  try {
    B.chat(JSON.stringify(payload), cbId);
  } catch (e) {
    delete pendingCb[cbId];
    busy = false;
    showDialog('...出问题了。');
  }
}

/* 所有 AI 回复都从这里回来。
   先看有没有登记过的回调（戳一戳/读屏/使用数据/睡觉都会登记），
   交给它处理；没有才当成普通聊天。 */
const handledCb = {};

window.__sansCallback = function (id, resultJson) {
  if (handledCb[id]) return;      // 同一个回调只处理一次
  handledCb[id] = true;

  let r = {};
  try { r = JSON.parse(resultJson); } catch (e) { r = { ok: false, error: '解析失败' }; }

  const cb = pendingCb[id];
  if (cb) {
    delete pendingCb[id];
    cb(r);                        // ← 互动回复在这里走 addHistoryOnly + 元叙述过滤
    return;
  }

  // 兜底：普通聊天
  busy = false;
  if (r.ok && !looksLikeMeta(r.content, 0)) {
    addHistory('assistant', r.content);
    speak(r.content);
  } else if (r.ok) {
    speak('……你再说一遍，刚才那句我没听清。');
  } else {
    showDialog('...出问题了。\n' + (r.error || ''));
  }
};

/* ================= 读屏 / 使用数据（待机的两个子状态） =================

   都要求：AI 对话模式 + 接口配好 + 对应开关打开
   都只在待机时触发（原生那边已经判断了 state == IDLE）
   ==================================================================== */

let screenPendingTimer = null;

window.__onScreenshot = function (cbId, ok, b64, reason) {
  if (screenPendingTimer) { clearTimeout(screenPendingTimer); screenPendingTimer = null; }

  if (!ok || !b64) {
    busy = false;
    try { B.toast('截图失败：' + (reason || '未知原因')); } catch (e) {}
    return;
  }
  const hint = '下面是用户手机屏幕的截图（你从手机里往外看到的）。' +
               '【最重要】如果画面里出现桌面上那个悬浮的像素骷髅小人，那就是你自己本人 —— ' +
               '用第一人称，绝对不要说"这个桌宠""那个角色""这个小骷髅"，也不要去描述它长什么样。' +
               '挑一个和用户有关的细节，用一句话（不超过 25 字）评价他现在在干嘛。' +
               '语气像 Sans，随意、有点损但不刻薄。' +
               '【直接输出这句话本身】不要分析、不要复述要求、不要出现"我应该""用户""截图"这类字眼。';
  busy = true;
  aiAsk('（你偷看了一眼他的屏幕）', hint, function (r) {
    busy = false;
    if (r.ok && r.content && !looksLikeMeta(r.content, 60)) {
      addHistoryOnly('assistant', r.content);
      speak(r.content);
    } else if (r.ok && r.content) {
      // 模型在自言自语，跳过这次
      busy = false;
    } else {
      try { B.toast(errorLine(r)); } catch (e) {}
    }
  }, b64);
};

/* force = true 时忽略概率，并在不满足条件时弹出原因（设置页的「立刻测试」用） */
window.__onScreenTick = function (force) {
  if (asleep || busy || typing) {
    if (force) { try { B.toast('现在没法读屏：它在睡觉或者正忙'); } catch (e) {} }
    return;
  }
  if (S('screenRead', '0') !== '1') {
    if (force) { try { B.toast('读屏开关没打开'); } catch (e) {} }
    return;
  }
  if (!useAi()) {
    if (force) { try { B.toast('需要「AI 对话」模式，且 Base URL / Key / 模型都填好'); } catch (e) {} }
    return;
  }

  busy = true;
  const cbId = 'sc' + (++cbSeq);

  // 保险：10 秒没回音就解开，免得一直卡着
  screenPendingTimer = setTimeout(function () {
    screenPendingTimer = null;
    if (busy) {
      busy = false;
      try { B.toast('截图没有返回（超时）'); } catch (e) {}
    }
  }, 10000);

  try {
    B.requestScreenshot(cbId);
  } catch (e) {
    clearTimeout(screenPendingTimer);
    screenPendingTimer = null;
    busy = false;
    if (force) { try { B.toast('调用截图失败：' + e); } catch (e2) {} }
  }
};

window.__onUsageTick = function (force) {
  if (asleep || busy || typing) {
    if (force) { try { B.toast('现在没法读使用数据：它在睡觉或者正忙'); } catch (e) {} }
    return;
  }
  if (S('usageRead', '0') !== '1') {
    if (force) { try { B.toast('使用数据开关没打开'); } catch (e) {} }
    return;
  }
  if (!useAi()) {
    if (force) { try { B.toast('需要「AI 对话」模式，且 Base URL / Key / 模型都填好'); } catch (e) {} }
    return;
  }

  let list = [];
  try { list = JSON.parse(B.readUsage(60, 5)) || []; } catch (e) { list = []; }
  if (!list.length) {
    if (force) { try { B.toast('读不到使用数据：去系统设置里开启「使用情况访问」'); } catch (e) {} }
    return;
  }

  const desc = list.map(function (a) {
    return a.name + '（用了 ' + a.minutes + ' 分钟，' + a.lastUsedMinAgo + ' 分钟前打开）';
  }).join('；');

  const hint = '用户最近一小时内的手机使用情况，按用时排序：' + desc + '。' +
               '\n挑一个你觉得有意思的点，用一句不超过 25 字的话调侃一下，语气像 Sans。' +
               '【直接输出这句话本身】不要分析、不要复述要求。';
  busy = true;
  aiAsk('（你偷看了他的使用记录）', hint, function (r) {
    busy = false;
    if (r.ok && r.content && !looksLikeMeta(r.content, 60)) {
      addHistoryOnly('assistant', r.content);
      speak(r.content);
    } else if (!r.ok) {
      try { B.toast(errorLine(r)); } catch (e) {}
    }
  });
};
/* ---------------- 主动回复 ---------------- */

/* 戳一戳：没有 Key 一律预设；有 Key 按概率走 LLM */
function pokeOnce() {
  const count = recordTap();
  const tier = tierFor(count);
  const mood = currentMood();
  // 计数已经算好，直接写进提示词，不用模型猜
  const hint = '【戳一戳计数】最近一小时内，用户一共戳了你 ' + count + ' 次（含这一次）。' +
               '这个数字是准确值，直接用它，不要自己推测。\n' +
               tier.hint +
               '\n\n用一句很短的话回应他，不超过 20 个字。只输出你要说的话，不要解释、不要旁白。';
  interactSpeak('（用户戳了你一下）',
    withMoodHint(hint, mood),
    linesWithMood(tier.lines, mood, MOOD_POKE_SHARE));
}

/* 深夜（23:00–06:00）主动开口的概率降到 1/4。
   不关掉 —— 熬夜的人也需要有人搭理，只是不能像白天那么吵。 */
const NIGHT_PROACTIVE_FACTOR = 0.25;

function isNightHour() {
  const h = new Date().getHours();
  return h >= 23 || h < 6;
}

/* 主动回复：没 Key 用预设；有 Key 就让模型顺着之前的话题追问 */
function proactiveTick() {
  if (S('proactive', '1') !== '1') return;
  if (busy || typing) return;
  if (asleep) return;
  if (historyOpen) return;
  if (Date.now() - lastSpeak < 3 * 60 * 1000) return;

  let rate = parseFloat(S('proactiveRate', '0.08')) || 0;
  if (isNightHour()) rate *= NIGHT_PROACTIVE_FACTOR;
  if (Math.random() >= rate) return;

  const mood = currentMood();
  const lines = linesWithMood(presetLines('proactive') || PROACTIVE, mood, MOOD_POKE_SHARE);
  interactSpeak('（你决定主动开口）',
    withMoodHint(
      '现在你决定主动开口。如果之前聊过什么，就顺着那个话题追问一句（比如问后来怎么样了、有没有好转）；' +
      '如果没什么可追问的，就说一句日常的关心。不超过 25 个字。只输出你要说的话，不要解释、不要旁白。',
      mood),
    lines);
}

/* ---------------- 事件 ---------------- */

document.addEventListener('touchstart', function () { initAudio(); }, { passive: true, once: true });
document.addEventListener('mousedown', function () { initAudio(); }, { once: true });

/* 戳一戳限频：一秒最多 2 次 */
let lastTapAt = 0;

$('#pet').addEventListener('click', function () {
  if (suppressClick) return;

  // 先告诉原生「我被戳了」——睡着的话原生会把我唤醒
  // （拖动不会触发这里，所以拖动不醒）
  try { B.pokePet(); } catch (e) {}

  // 睡着时这一下只用来唤醒，不做别的
  if (asleep) return;

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
  loadPresets();
  probeWalkFrames();
  probeCharacter();
  probeFaces();
  scheduleExpression();
  initAudio();

  startSleepTalk();

  // 先把基线采下来，否则第一次判断「刚插上充电」会把开机瞬间当成刚发生
  try { envPrev = envRead(); sampleDevice(); } catch (e) {}
  setInterval(sampleDevice, SAMPLE_MS);

  // 启动时把行走/锁定状态推给原生
  pushWalkConfig();
  pushReadConfig();
  try { B.setLocked(S('lockPosition', '0') === '1'); } catch (e) {}
  applyPetScale();
  setTimeout(refresh, 100);
  setTimeout(refresh, 400);
});

$('#pet').addEventListener('load', function () { setTimeout(refresh, 60); });
