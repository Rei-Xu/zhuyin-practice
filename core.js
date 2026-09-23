/* 注音打字小勇士 — 共用核心
 * 「闖關模式」(app.js) 與「注音塔防」(td.js) 共用的東西都放這裡：
 * 鍵盤配置、注音↔按鍵對照表、螢幕鍵盤畫面、音效、localStorage 小工具。
 *
 * ⚠ 改這個檔會同時影響兩個模式，改完兩邊都要測過。
 */
window.ZY = (function () {
  'use strict';

  // ---------- 鍵盤配置（標準注音排列）：[code, 英文標示, 注音/功能標示, 尺寸class] ----------
  const BSLASH = String.fromCharCode(92);
  const ROWS = [
    [['Backquote', '`', ''], ['Digit1', '1', 'ㄅ'], ['Digit2', '2', 'ㄉ'], ['Digit3', '3', 'ˇ'], ['Digit4', '4', 'ˋ'],
     ['Digit5', '5', 'ㄓ'], ['Digit6', '6', 'ˊ'], ['Digit7', '7', '˙'], ['Digit8', '8', 'ㄚ'], ['Digit9', '9', 'ㄞ'],
     ['Digit0', '0', 'ㄢ'], ['Minus', '-', 'ㄦ'], ['Equal', '=', ''], ['Backspace', '', '← 刪除', 'wide']],
    [['Tab', 'Tab', '', 'wide'], ['KeyQ', 'Q', 'ㄆ'], ['KeyW', 'W', 'ㄊ'], ['KeyE', 'E', 'ㄍ'], ['KeyR', 'R', 'ㄐ'],
     ['KeyT', 'T', 'ㄔ'], ['KeyY', 'Y', 'ㄗ'], ['KeyU', 'U', 'ㄧ'], ['KeyI', 'I', 'ㄛ'], ['KeyO', 'O', 'ㄟ'],
     ['KeyP', 'P', 'ㄣ'], ['BracketLeft', '[', ''], ['BracketRight', ']', ''], ['Backslash', BSLASH, '']],
    [['CapsLock', '', 'Caps Lock', 'wide'], ['KeyA', 'A', 'ㄇ'], ['KeyS', 'S', 'ㄋ'], ['KeyD', 'D', 'ㄎ'], ['KeyF', 'F', 'ㄑ'],
     ['KeyG', 'G', 'ㄕ'], ['KeyH', 'H', 'ㄘ'], ['KeyJ', 'J', 'ㄨ'], ['KeyK', 'K', 'ㄜ'], ['KeyL', 'L', 'ㄠ'],
     ['Semicolon', ';', 'ㄤ'], ['Quote', "'", ''], ['Enter', '', 'Enter 送出', 'wider']],
    [['ShiftLeft', '', 'Shift 切換中/英', 'wider'], ['KeyZ', 'Z', 'ㄈ'], ['KeyX', 'X', 'ㄌ'], ['KeyC', 'C', 'ㄏ'], ['KeyV', 'V', 'ㄒ'],
     ['KeyB', 'B', 'ㄖ'], ['KeyN', 'N', 'ㄙ'], ['KeyM', 'M', 'ㄩ'], ['Comma', ',', 'ㄝ'], ['Period', '.', 'ㄡ'],
     ['Slash', '/', 'ㄥ'], ['ShiftRight', '', 'Shift 切換中/英', 'wider']],
    [['ControlLeft', '', 'Ctrl', 'wide'], ['Space', '', '空白鍵（一聲）', 'space'], ['ArrowDown', '', '↓ 選字', 'wide']],
  ];
  const ZHUYIN_RE = /[ㄅ-ㄩ]/;
  const TONE_MARKS = 'ˊˇˋ˙';
  const TONE_KEY = { 'ˉ': 'Space', 'ˊ': 'Digit6', 'ˇ': 'Digit3', 'ˋ': 'Digit4', '˙': 'Digit7' };
  const ZHUYIN_KEY = {};   // 注音符號 → code
  const CODE_INFO = {};    // code → {en, label}
  ROWS.forEach(r => r.forEach(([code, en, label]) => {
    CODE_INFO[code] = { en, label };
    if (ZHUYIN_RE.test(label) || TONE_MARKS.includes(label)) ZHUYIN_KEY[label] = code;
  }));
  const MODIFIERS = new Set(['ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'CapsLock', 'MetaLeft', 'MetaRight', 'Tab']);

  // 一個字的注音字串 → 依打字順序的按鍵清單（注音符號…最後是聲調鍵）
  function keySeq(zy) {
    const seq = [];
    let tone = 'ˉ';
    for (const ch of zy) {
      if (ZHUYIN_RE.test(ch)) seq.push({ code: ZHUYIN_KEY[ch], label: ch });
      else if (TONE_MARKS.includes(ch)) tone = ch;
    }
    seq.push({ code: TONE_KEY[tone], label: tone === 'ˉ' ? '空白' : tone, tone: true });
    return seq;
  }

  // 整個語詞的按鍵清單（把每個字的 keySeq 串起來，並記住屬於第幾個字）
  // 塔防用這個來判定「這串鍵按對了沒」，不看輸入法把注音轉成哪個國字。
  function wordKeySeq(zhuyinArr) {
    const out = [];
    zhuyinArr.forEach((syl, si) => {
      const seq = keySeq(syl);
      const start = out.length;
      seq.forEach(k => out.push({ code: k.code, label: k.label, tone: !!k.tone, syl: si, sylStart: start }));
    });
    return out;
  }

  function codeLabel(code) {
    const info = CODE_INFO[code];
    if (!info) return code;
    if (code === 'Space') return '空白鍵';
    if (code === 'Enter') return 'Enter';
    if (code === 'Backspace') return 'Backspace';
    if (code === 'ArrowDown') return '↓';
    if (code.startsWith('Shift')) return 'Shift';
    return info.en.toLowerCase() + (info.label ? `(${info.label})` : '');
  }

  // ---------- 螢幕鍵盤 ----------
  function renderKeyboard(container) {
    container.innerHTML = '';
    ROWS.forEach(row => {
      const div = document.createElement('div'); div.className = 'kb-row';
      row.forEach(([code, en, label, size]) => {
        const k = document.createElement('div');
        k.className = 'key' + (size ? ' ' + size : '');
        k.dataset.code = code;
        const isZy = ZHUYIN_RE.test(label) || TONE_MARKS.includes(label);
        const toneName = { 'ˊ': '二聲', 'ˇ': '三聲', 'ˋ': '四聲', '˙': '輕聲' }[label];
        k.innerHTML = `<span class="en">${en}</span>` + (isZy ? `<span class="zy">${label}</span>` : `<span class="lbl">${label}</span>`) + (toneName ? `<span class="lbl tone">${toneName}</span>` : '');
        if (!isZy && !label) k.classList.add('dim');
        div.appendChild(k);
      });
      container.appendChild(div);
    });
  }
  function keyEls(container, code) { return container.querySelectorAll(`.key[data-code="${code}"]`); }
  function flashKey(container, code, cls) {
    keyEls(container, code).forEach(k => { k.classList.add(cls); setTimeout(() => k.classList.remove(cls), 160); });
  }
  function setNextKey(container, code) {
    container.querySelectorAll('.key.next').forEach(k => k.classList.remove('next'));
    if (code) keyEls(container, code).forEach(k => k.classList.add('next'));
  }

  // ---------- 音效（Web Audio，不需外部檔案） ----------
  let actx = null, soundOn = true;
  function setSound(on) { soundOn = !!on; }
  function beep(freq, dur, type, delay) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
      const t = actx.currentTime + (delay || 0);
      g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
    } catch (e) { /* 忽略 */ }
  }
  const playGood = () => { beep(660, .12); beep(880, .2, 'sine', .1); };
  const playBad = () => beep(180, .25, 'square');
  const playWin = () => [523, 659, 784, 1047].forEach((f, i) => beep(f, .25, 'sine', i * .13));
  const playTick = () => beep(1100, .05, 'triangle');          // 打中一個注音
  const playBoom = () => { beep(420, .1, 'square'); beep(160, .25, 'square', .06); };  // 怪獸爆炸
  const playHurt = () => { beep(300, .18, 'sawtooth'); beep(150, .3, 'sawtooth', .12); }; // 城牆被撞

  // ---------- localStorage 小工具 ----------
  function loadJSON(key, fallback) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; } }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* 無痕模式等情況忽略 */ } }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  // ---------- 洗牌發牌器 ----------
  // 純隨機抽（Math.random 挑一個）會讓同一波怪獸出現一樣的語詞，題庫再大也一樣。
  // 這裡改成像發撲克牌：洗好一疊，一張一張發，發完才重洗，
  // 所以走完一整輪之前不會重複，重洗時也會避開「接縫剛好又是同一張」。
  function makePicker(list) {
    const pool = (list || []).slice();
    let queue = [], last = null;
    function next() {
      if (!pool.length) return null;
      if (!queue.length) {
        queue = shuffle(pool);
        if (pool.length > 1 && queue[0] === last) queue.push(queue.shift());
      }
      last = queue.shift();
      return last;
    }
    return {
      next,
      // 一次拿 n 個，保證這 n 個彼此不重複
      take(n) {
        const out = [];
        const max = Math.min(n, pool.length);
        while (out.length < max) {
          const v = next();
          if (v == null) break;
          if (out.indexOf(v) === -1) out.push(v);
        }
        return out;
      },
      size() { return pool.length; },
    };
  }

  // ---------- 畫面切換（app.js 與 td.js 共用同一組 section.screen）----------
  function showScreen(name) {
    document.querySelectorAll('section.screen').forEach(el => el.classList.toggle('active', el.id === 'screen-' + name));
  }

  // 判斷這個 keydown 是不是「輸入法正在處理」（＝目前是中文模式）
  function isIMEKey(e) { return e.key === 'Process' || e.isComposing || e.keyCode === 229; }

  return {
    ROWS, ZHUYIN_RE, TONE_MARKS, TONE_KEY, ZHUYIN_KEY, CODE_INFO, MODIFIERS,
    keySeq, wordKeySeq, codeLabel,
    renderKeyboard, keyEls, flashKey, setNextKey,
    setSound, beep, playGood, playBad, playWin, playTick, playBoom, playHurt,
    loadJSON, saveJSON, escapeHtml, shuffle, isIMEKey, showScreen, makePicker,
    LS_SETTINGS: 'zhuyinTrainer.settings',
    LS_RECORDS: 'zhuyinTrainer.records',
    LS_BEST: 'zhuyinTrainer.best',
    LS_TD_BEST: 'zhuyinTrainer.tdBest',
  };
})();
