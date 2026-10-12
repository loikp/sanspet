/* 把 prompt/*.txt 里的三份文本打包进 App
 * 用法： node tools/sync-prompt.js
 * 改完 prompt 里的 txt 就跑一次，然后重新打包 APK
 */

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const promptDir = path.join(root, 'prompt');
const outFile = path.join(root, 'app', 'src', 'main', 'assets', 'persona.js');

function read(name) {
  const p = path.join(promptDir, name);
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n').trim();
}

/* 以 # 开头的行是注释，不算真正内容 */
function clean(text) {
  return text
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n')
    .trim();
}

const builtin = read('内置人设.txt');
const append = clean(read('追加提示词.txt'));
const user = clean(read('用户人设.txt'));

const out =
  '/* 由 tools/sync-prompt.js 自动生成，请不要手改这个文件。\n' +
  '   要改内容请编辑 prompt/ 目录下的 txt，然后重新运行同步脚本。 */\n' +
  'window.__PERSONA = {\n' +
  '  builtin: ' + JSON.stringify(builtin) + ',\n' +
  '  append: ' + JSON.stringify(append) + ',\n' +
  '  user: ' + JSON.stringify(user) + '\n' +
  '};\n';

fs.writeFileSync(outFile, out, 'utf8');

console.log('已生成 persona.js');
console.log('  内置人设：' + builtin.length + ' 字');
console.log('  追加提示词：' + (append ? append.length + ' 字' : '（空）'));
console.log('  用户人设：' + (user ? user.length + ' 字' : '（空）'));
