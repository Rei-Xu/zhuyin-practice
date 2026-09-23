/* 題庫檢查工具  —  用法：node tools/check-words.js
 *
 * 老師平常不需要用這支。它是給 AI／維護者在「改過 words.js」之後跑的，
 * 用來擋下打錯注音這類肉眼很難發現的錯誤（例如把「字」的 ㄗˋ 打成 ㄟˋ）。
 *
 * 它會：
 *   1. 檢查每一筆 zhuyin 的格數跟字數一不一樣
 *   2. 檢查每個音節只有合法的注音符號，聲調最多一個而且在最後面
 *   3. 檢查音節結構合法（聲母? 介音? 韻母?，順序不能亂、不能重複）
 *   4. 檢查每個音節都能被遊戲的 keySeq() 轉成按鍵（這是遊戲真正在用的邏輯）
 *   5. 檢查「同一個國字在整份題庫的注音要一致」← 最會抓到手誤的一條
 *   6. 檢查有沒有重複的題目
 *   7. 印出統計表：37 個注音符號各用了幾次、五個聲調的分布、常用字排行
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const sandbox = { window: {}, console, String, Object, Math, JSON, RegExp, Array, Set, Map };
vm.createContext(sandbox);
for (const f of ['core.js', 'words.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const ZY = sandbox.window.ZY;
const BANK = sandbox.window.WORD_BANK;

// ---------- 注音符號分類 ----------
const INITIALS = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙ';
const MEDIALS = 'ㄧㄨㄩ';
const FINALS = 'ㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ';
const TONES = 'ˊˇˋ˙';
const ALL_SYMBOLS = (INITIALS + MEDIALS + FINALS).split('');

// 真正的破音字：同一個字在不同詞裡本來就唸不同音，不算錯。
// 新增之前請先查教育部國語辭典確認，不要拿來掩蓋打錯的注音。
const POLYPHONE_OK = {
  '長': ['ㄔㄤˊ', 'ㄓㄤˇ'],        // 長頸鹿 / 校長
  '樂': ['ㄌㄜˋ', 'ㄩㄝˋ'],        // 快樂 / 音樂課
  '頭': ['ㄊㄡˊ', 'ㄊㄡ˙'],        // 頭髮 / 石頭（輕聲）
};

// ---------- 門檻 ----------
const MIN_PER_SYMBOL = 12;   // 每個注音符號至少要出現幾次
const MIN_NEUTRAL = 40;      // 輕聲音節至少要有幾個
const MAX_CHAR_IN_WORDS = 8; // 同一個國字在 words + words3 最多出現幾次

const errors = [];
const warnings = [];
const SECTIONS = ['chars', 'words', 'words3', 'sentences', 'bossWords'];

// ---------- 檢查每一筆 ----------
function checkSyllable(syl) {
  if (!syl) return '空的注音';
  const toneCount = [...syl].filter(c => TONES.includes(c)).length;
  if (toneCount > 1) return '有兩個以上的聲調符號';
  if (toneCount === 1 && !TONES.includes(syl[syl.length - 1])) return '聲調符號沒有放在最後面';
  const body = toneCount ? syl.slice(0, -1) : syl;
  if (!body) return '只有聲調、沒有注音符號';
  for (const c of body) {
    if (!ALL_SYMBOLS.includes(c)) return '出現不是注音符號的字元「' + c + '」';
  }
  // 結構：聲母? 介音? 韻母?
  let i = 0, got = [];
  if (i < body.length && INITIALS.includes(body[i])) { got.push('聲母'); i++; }
  if (i < body.length && MEDIALS.includes(body[i])) { got.push('介音'); i++; }
  if (i < body.length && FINALS.includes(body[i])) { got.push('韻母'); i++; }
  if (i !== body.length) return '音節結構不合法（' + body + '）';
  if (!got.length) return '音節是空的';
  // keySeq 必須能轉成按鍵
  const seq = ZY.keySeq(syl);
  for (const k of seq) {
    if (!k.code) return '有注音打不出按鍵（keySeq 產生 undefined）';
  }
  return null;
}

const charZhuyin = new Map();   // 國字 → Map(注音 → [出處])
const seenText = new Map();     // 題目 → [出處]
const symbolCount = {};
ALL_SYMBOLS.forEach(c => (symbolCount[c] = 0));
const toneCount = { '一聲': 0, 'ˊ': 0, 'ˇ': 0, 'ˋ': 0, '˙': 0 };
const charInWords = new Map();

for (const sec of SECTIONS) {
  const list = BANK[sec];
  if (!Array.isArray(list)) { errors.push(`[${sec}] 這個區塊不存在或不是陣列`); continue; }
  list.forEach((entry, idx) => {
    const where = `${sec}[${idx}] ${entry && entry.text}`;
    if (!entry || typeof entry.text !== 'string' || !Array.isArray(entry.zhuyin)) {
      errors.push(`${where}：格式不對，要有 text 與 zhuyin`); return;
    }
    if (entry.text.length !== entry.zhuyin.length) {
      errors.push(`${where}：有 ${entry.text.length} 個字，但注音只寫了 ${entry.zhuyin.length} 格`);
      return;
    }
    if (!seenText.has(entry.text)) seenText.set(entry.text, []);
    seenText.get(entry.text).push(sec);

    entry.zhuyin.forEach((syl, i) => {
      const bad = checkSyllable(syl);
      if (bad) { errors.push(`${where}：第 ${i + 1} 個字「${entry.text[i]}」的注音「${syl}」${bad}`); return; }
      // 統計
      for (const c of syl) if (c in symbolCount) symbolCount[c]++;
      const last = syl[syl.length - 1];
      if (TONES.includes(last)) toneCount[last]++; else toneCount['一聲']++;
      // 同字同音
      const ch = entry.text[i];
      if (!charZhuyin.has(ch)) charZhuyin.set(ch, new Map());
      const m = charZhuyin.get(ch);
      if (!m.has(syl)) m.set(syl, []);
      m.get(syl).push(where);
    });

    if (sec === 'words' || sec === 'words3') {
      for (const ch of entry.text) charInWords.set(ch, (charInWords.get(ch) || 0) + 1);
    }
  });
}

// ---------- 同字不同音 ----------
for (const [ch, m] of charZhuyin) {
  if (m.size < 2) continue;
  const readings = [...m.keys()].sort();
  const allowed = POLYPHONE_OK[ch] ? [...POLYPHONE_OK[ch]].sort() : null;
  if (allowed && allowed.length === readings.length && allowed.every((r, i) => r === readings[i])) continue;
  const detail = readings.map(r => `${r}（${m.get(r).slice(0, 3).join('、')}${m.get(r).length > 3 ? ' 等' : ''}）`).join('  vs  ');
  if (allowed) errors.push(`「${ch}」的讀音跟破音字白名單對不起來：${detail}`);
  else errors.push(`「${ch}」在不同題目標了不同注音，可能有一個打錯：${detail}`);
}

// ---------- 重複題目 ----------
for (const [text, where] of seenText) {
  if (where.length > 1) warnings.push(`題目「${text}」重複出現在：${where.join('、')}`);
}

// ---------- 平衡度 ----------
const thin = ALL_SYMBOLS.filter(c => symbolCount[c] < MIN_PER_SYMBOL);
if (thin.length) warnings.push(`這些注音符號練得太少（不到 ${MIN_PER_SYMBOL} 次）：` + thin.map(c => c + symbolCount[c]).join(' '));
if (toneCount['˙'] < MIN_NEUTRAL) warnings.push(`輕聲只有 ${toneCount['˙']} 個音節，建議至少 ${MIN_NEUTRAL} 個`);
const hot = [...charInWords.entries()].filter(([, n]) => n > MAX_CHAR_IN_WORDS).sort((a, b) => b[1] - a[1]);
if (hot.length) warnings.push(`這些字在語詞裡出現太多次（超過 ${MAX_CHAR_IN_WORDS} 次），變化性會變差：` + hot.map(([c, n]) => c + n).join(' '));

// ---------- 報表 ----------
const L = console.log;
L('');
L('===== 題庫統計 =====');
let total = 0;
for (const sec of SECTIONS) {
  const n = Array.isArray(BANK[sec]) ? BANK[sec].length : 0;
  total += n;
  L(`  ${sec.padEnd(10)} ${String(n).padStart(4)} 筆`);
}
L(`  ${'合計'.padEnd(9)} ${String(total).padStart(4)} 筆`);
L('');
L('注音符號使用次數：');
for (let i = 0; i < ALL_SYMBOLS.length; i += 10) {
  L('  ' + ALL_SYMBOLS.slice(i, i + 10).map(c => c + String(symbolCount[c]).padStart(3)).join('  '));
}
L('');
L(`聲調分布： 一聲 ${toneCount['一聲']}   二聲 ${toneCount['ˊ']}   三聲 ${toneCount['ˇ']}   四聲 ${toneCount['ˋ']}   輕聲 ${toneCount['˙']}`);
const topChars = [...charInWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
L('語詞裡最常出現的字： ' + topChars.map(([c, n]) => c + n).join(' '));
L('');

if (warnings.length) {
  L('===== 提醒（不影響遊戲，但建議改善） =====');
  warnings.forEach(w => L('  ! ' + w));
  L('');
}
if (errors.length) {
  L('===== 錯誤（一定要修） =====');
  errors.forEach(e => L('  X ' + e));
  L('');
  L(`共 ${errors.length} 個錯誤。`);
  process.exit(1);
}
L('✅ 沒有錯誤。');
