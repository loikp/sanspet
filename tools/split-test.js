/* SansPet 分段规则测试
 *
 * 用法： node tools/split-test.js
 *
 * 规则来自 app/src/main/assets/overlay.js 里的分段代码（下面这段是自动同步的，
 * 改完 overlay.js 可以重新生成，或直接手改这里）。
 */
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

/* 第三遍：太长的句子按单位切，英文优先在空格断 */
function splitLong(part, max) {
  const out = [];
  let buf = '';
  let units = 0;
  let breakAt = -1;

  function flush() {
    const t = buf.trim();
    if (t) out.push(t);
    buf = '';
    units = 0;
    breakAt = -1;
  }

  for (const ch of part) {
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
    if (SOFT_BREAKS.indexOf(ch) >= 0) breakAt = buf.length;
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


/* ---------------- 测试用例 ---------------- */

function units(s) { let n = 0; for (const c of s) n += charUnits(c); return n; }

function show(label, text) {
  const parts = splitSentences(text);
  console.log('--- ' + label);
  parts.forEach(function (p, i) {
    console.log('  [' + (i + 1) + '] (' + (units(p) / 2) + ' 字) ' + p);
  });
}

show('1. 三个点：不该断', '嘿...你今天怎么样？我有点累。');
show('2. 两个省略号(6点)：该断', '我……不知道。');
show('3. 星号：不该断', '*他强调*了这一点，然后走了。');
show('4. 单个句点：不该断', '3.14 是圆周率，U.S. 是美国。');
show('5. 六个点：该断，且原文不变', '他说完了......然后走了。');
show('6. 长英文：按空格断，不切断单词', 'This is a fairly long English sentence that should be broken into pieces at word boundaries instead of cutting a word in half.');
show('7. 长中文：按 30 字断', '这是一段很长的中文用来测试字数截断的规则是否按照三十个中文字符来切分并且不会把标点符号弄丢');
show('8. 引号收尾：跟着前一句', '他说：「今天不去了。」然后就走开了。');
show('9. 半角计数：英文占 1 个单位', 'OK, I see you. Fine.');
show('10. 单个省略号：不该断', '嗯…我懂了。');
