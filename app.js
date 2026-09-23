/* 注音打字小勇士 — 遊戲邏輯
 * 純前端、不連網。用瀏覽器的 composition 事件觀察「微軟注音」真實的組字過程，
 * 再用 event.code 得知學生按了哪個實體鍵，藉此亮起螢幕鍵盤並給提示。
 */
(function () {
  'use strict';

  // ---------- 共用核心（core.js）----------
  const ZY = window.ZY;
  const { ZHUYIN_RE, TONE_MARKS, TONE_KEY, ZHUYIN_KEY, CODE_INFO, MODIFIERS,
          keySeq, codeLabel, renderKeyboard, keyEls, flashKey, setNextKey,
          loadJSON, saveJSON, escapeHtml, shuffle, makePicker,
          beep, playGood, playBad, playWin } = ZY;

  // ---------- 關卡 ----------
  const LEVELS = [
    { id: 0, name: '切換中英文', icon: '🔀', desc: '學會用 Shift 切換中文／英文', defaultN: 6 },
    { id: 1, name: '注音在哪裡', icon: '🔍', desc: '找到鍵盤上的注音符號', defaultN: 10 },
    { id: 2, name: '聲調與送出', icon: '🎵', desc: '打出一個字，按 Enter 送出', defaultN: 10 },
    { id: 3, name: '選字高手', icon: '🎯', desc: '用 ↓ 和數字選出正確的字', defaultN: 8 },
    { id: 4, name: '綜合挑戰', icon: '🏆', desc: '打出完整句子，計時！', defaultN: 5, timer: true },
  ];
  const ALL_SYMBOLS = 'ㄅㄆㄇㄈㄉㄊㄋㄌㄍㄎㄏㄐㄑㄒㄓㄔㄕㄖㄗㄘㄙㄧㄨㄩㄚㄛㄜㄝㄞㄟㄠㄡㄢㄣㄤㄥㄦ'.split('');
  const EN_WORDS = ['hi', 'ok', 'go', 'abc', 'yes', 'no', 'cat', 'dog'];

  const bank = () => window.WORD_BANK || { chars: [], words: [], sentences: [] };

  function makeQuestions(level, n) {
    if (level.id === 0) {
      const qs = [];
      const zh = shuffle(['ㄅ', 'ㄇ', 'ㄚ', 'ㄧ', 'ㄨ', 'ㄋ', 'ㄉ', 'ㄏ']);
      const en = shuffle(EN_WORDS);
      for (let i = 0; i < n; i++) qs.push(i % 2 === 0 ? { kind: 'en', text: en[i % en.length] } : { kind: 'symbol', text: zh[i % zh.length] });
      return qs;
    }
    if (level.id === 1) {
      const first = ALL_SYMBOLS.slice(0, 4), rest = shuffle(ALL_SYMBOLS.slice(4));
      return first.concat(rest).slice(0, n).map(s => ({ kind: 'symbol', text: s }));
    }
    // 用發牌器出題：同一次不重複，而且連玩好幾場也要把整個題庫走完一輪才會再遇到同一題
    const items = picker(level.id).take(n);
    return items.map(w => ({ kind: 'text', text: w.text, zhuyin: w.zhuyin }));
  }

  // 每個題源一個發牌器，整個分頁共用（重玩不會重置）
  const PICKERS = {};
  function picker(levelId) {
    if (!PICKERS[levelId]) {
      const b = bank();
      const src = levelId === 2 ? (b.chars || [])
                : levelId === 3 ? (b.words || []).concat(b.words3 || [])   // 第 3 關：二字詞＋三字詞混著出
                : (b.sentences || []);
      PICKERS[levelId] = makePicker(src);
    }
    return PICKERS[levelId];
  }

  // ---------- 設定與記錄（localStorage，只存本機） ----------
  const LS_SETTINGS = 'zhuyinTrainer.settings', LS_RECORDS = 'zhuyinTrainer.records', LS_BEST = 'zhuyinTrainer.best';
  const DEFAULT_SETTINGS = { n: { 0: 6, 1: 10, 2: 10, 3: 8, 4: 5 }, enabled: { 0: true, 1: true, 2: true, 3: true, 4: true }, timerAll: false, askName: true, sound: true,
    tdEnabled: true, tdSpeed: 'normal', tdHearts: 3, tdBoss: true, tdKeyHint: true };
  let settings = Object.assign({}, DEFAULT_SETTINGS, loadJSON(LS_SETTINGS, {}));
  settings.n = Object.assign({}, DEFAULT_SETTINGS.n, settings.n);
  settings.enabled = Object.assign({}, DEFAULT_SETTINGS.enabled, settings.enabled);
  ZY.setSound(settings.sound);

  // ---------- DOM ----------
  const $ = id => document.getElementById(id);
  const box = $('ime-box');
  function showScreen(name) {
    ZY.showScreen(name);
    if (name === 'game') setTimeout(() => box.focus(), 50);
    if (name === 'demo') setTimeout(() => $('demo-box').focus(), 50);
  }

  // ---------- 診斷紀錄（按 F9 開關）----------
  // 真實的微軟注音行為沒辦法用程式模擬，若以後又出現怪的正確率，
  // 請在遊戲畫面按 F9 打開這個紀錄，打一題後截圖給我。紀錄只存在畫面上，不會傳出去。
  let dbgOn = false, dbgEl = null;
  const dbgLines = [];
  function dbgPanel() {
    if (dbgEl) return dbgEl;
    dbgEl = document.createElement('pre');
    dbgEl.id = 'debug-log';
    dbgEl.style.cssText = 'position:fixed;right:8px;bottom:8px;width:360px;height:220px;overflow:auto;' +
      'background:rgba(0,0,0,.85);color:#7CFC98;font:12px/1.45 Consolas,monospace;padding:8px;' +
      'border-radius:8px;z-index:9999;white-space:pre-wrap;margin:0';
    document.body.appendChild(dbgEl);
    return dbgEl;
  }
  function dbg(tag, info) {
    if (!dbgOn) return;
    dbgLines.push(tag + ' ' + info + '  [對' + G.correct + ' 錯' + G.wrong + ']');
    if (dbgLines.length > 80) dbgLines.shift();
    const el = dbgPanel();
    el.textContent = dbgLines.join(String.fromCharCode(10));
    el.scrollTop = el.scrollHeight;
  }
  window.addEventListener('keydown', e => {
    if (e.key !== 'F9') return;
    dbgOn = !dbgOn;
    dbgPanel().style.display = dbgOn ? 'block' : 'none';
    if (dbgOn) { dbgLines.length = 0; dbg('debug', '開啟（再按一次 F9 關閉）'); }
  });

  function tempHighlight(container, code, ms) {
    keyEls(container, code).forEach(k => { k.classList.add('next'); setTimeout(() => { if (G.nextCode !== code) k.classList.remove('next'); }, ms); });
  }

  // ---------- 遊戲狀態 ----------
  const G = { level: null, qs: [], i: 0, correct: 0, wrong: 0, wrongOnQ: 0, start: 0, timerId: null, composing: '', committed: '', busy: false, lastBad: false, nextCode: null, mode: 'unknown' };
  const MAX_WRONG_PER_Q = 5;   // 同一題最多只記 5 次錯，避免任何誤判把數字灌爆
  const kb = $('keyboard');
  const cur = () => G.qs[G.i];

  function setMode(m) {
    G.mode = m;
    const b = $('mode-badge');
    b.className = 'mode-badge ' + m;
    b.textContent = m === 'zh' ? '輸入法：中文 ㄅ' : m === 'en' ? '輸入法：英文 A' : '輸入法：？';
  }
  function setHint(msg, cls) { const h = $('hint'); h.textContent = msg || ''; h.className = 'hint ' + (cls || ''); }
  // 「已經送出的文字」。
  // 舊版是用 box.value 減掉組字串的長度去推算，但 compositionupdate 與 input.value 的更新順序
  // 在各瀏覽器／輸入法並不一致（有時 e.data 已經變了、box.value 還是上一刻的值），
  // 推算出來的字串會瞬間變成亂的 → 被判成「打錯字」，正確率因此爆掉。
  // 改成只在「沒有在組字」時記錄一次，組字期間一律沿用上次的值（組字中本來就不會改到已送出的字）。
  function committedValue() { return G.committed; }
  function syncCommitted() { if (!G.composing) G.committed = box.value; }

  function startLevel(level) {
    G.level = level;
    G.qs = makeQuestions(level, settings.n[level.id] || level.defaultN);
    if (!G.qs.length) { alert('題庫是空的，請檢查 words.js'); return; }
    G.i = 0; G.correct = 0; G.wrong = 0; G.wrongOnQ = 0; G.composing = ''; G.committed = ''; G.busy = false; G.lastBad = false;
    G.start = Date.now();
    setMode('unknown');
    $('level-name').textContent = `第 ${level.id} 關 ${level.icon} ${level.name}`;
    const showTimer = level.timer || settings.timerAll;
    $('timer').classList.toggle('hidden', !showTimer);
    clearInterval(G.timerId);
    G.timerId = setInterval(() => { $('timer').textContent = `⏱ ${Math.floor((Date.now() - G.start) / 1000)} 秒`; }, 500);
    box.value = '';
    showScreen('game');
    renderQuestion();
  }

  function renderQuestion() {
    const q = cur();
    $('progress').textContent = `${G.i + 1} / ${G.qs.length}`;
    $('composing').textContent = '';
    setHint('');
    const tiles = $('target-tiles'), guide = $('key-guide');
    tiles.innerHTML = ''; guide.innerHTML = '';
    if (q.kind === 'en') {
      $('task-instruction').innerHTML = '切換成 <span style="color:#4a90e2">英文</span>，打出：';
      tiles.innerHTML = q.text.split('').map(c => `<div class="tile"><div class="ch">${c}</div></div>`).join('');
      setHint('小提醒：按一下 Shift 可以切換中文／英文');
    } else if (q.kind === 'symbol') {
      q.code = ZHUYIN_KEY[q.text]; q.passed = false;
      $('task-instruction').innerHTML = (G.level.id === 0 ? '切換成 <span style="color:#3cb371">中文</span>，' : '') + '找到這個注音，按下去：';
      tiles.innerHTML = `<div class="tile big current"><div class="ch">${q.text}</div><div class="zy">${CODE_INFO[q.code].en} 鍵</div></div>`;
      if (G.level.id === 0) setHint('小提醒：按一下 Shift 可以切換中文／英文');
    } else {
      $('task-instruction').textContent = q.text.length === 1 ? '打出這個字，再按 Enter 送出：' : '打出這些字，再按 Enter 送出：';
    }
    renderState();
  }

  // 分析目前「已送出的文字 + 組字串」與目標的關係
  function analyze(q) {
    const target = q.text, value = committedValue(), comp = G.composing;
    const r = { status: 'ok', idx: 0, next: null, msg: '', symDone: 0 };
    if (!target.startsWith(value)) {
      let d = 0; while (d < value.length && value[d] === target[d]) d++;
      r.status = 'valueWrong'; r.idx = d; r.next = 'Backspace';
      r.msg = `第 ${d + 1} 個字打錯了，按 Backspace 刪掉`;
      return r;
    }
    let idx = value.length, j = 0;
    while (j < comp.length && idx < target.length && comp[j] === target[idx]) { j++; idx++; }
    const rem = comp.slice(j);
    r.idx = idx;
    if (idx >= target.length) {
      if (rem.length) { r.status = 'extra'; r.next = 'Backspace'; r.msg = '多打了，按 Backspace 刪掉'; }
      else if (comp.length) { r.status = 'needEnter'; r.next = 'Enter'; r.msg = '都對了！按 Enter 送出'; }
      else r.status = 'complete';
      return r;
    }
    const seq = keySeq(q.zhuyin[idx]);
    // full = 這個字的注音（含最後面的聲調符號；一聲沒有符號）。
    // 舊版只比對不含聲調的 symbols，學生按下二/三/四/輕聲後、
    // 輸入法還沒轉成國字的那一瞬間，組字串是「ㄏㄠˇ」，會被誤判成按錯鍵。
    const full = q.zhuyin[idx];
    if (rem === '') { r.status = 'typing'; r.next = seq[0].code; return r; }
    if (/^[ㄅ-ㄩˊˇˋ˙]+$/.test(rem)) {
      if (full.startsWith(rem)) {
        r.status = 'typing'; r.symDone = rem.length;
        r.next = seq[rem.length] ? seq[rem.length].code : null;   // 聲調也打完了，等輸入法轉字
      } else {
        let p = 0; while (p < rem.length && p < full.length && rem[p] === full[p]) p++;
        r.status = 'symWrong'; r.symDone = p; r.next = 'Backspace'; r.msg = '注音按錯了，按 Backspace 刪掉再打';
      }
      return r;
    }
    if (rem.length > 1) { r.status = 'extra'; r.next = 'Backspace'; r.msg = `前面的字不對，先按 Backspace 刪掉，再用 ↓ 選「${target[idx]}」`; return r; }
    r.status = 'wrongChar'; r.next = 'ArrowDown';
    r.msg = `這個字不是「${target[idx]}」！按 ↓ 找到「${target[idx]}」，再按它前面的數字`;
    return r;
  }

  function renderState() {
    if (G.busy) return;
    const q = cur();
    $('composing').textContent = G.composing ? `正在打：${G.composing}` : '';
    if (q.kind === 'en') {
      const v = box.value.toLowerCase();
      const ok = q.text.startsWith(v);
      $('target-tiles').querySelectorAll('.tile').forEach((t, i) => { t.classList.toggle('done', ok && i < v.length); t.classList.toggle('current', ok && i === v.length); });
      const nextCh = ok ? q.text[v.length] : null;
      G.nextCode = nextCh ? 'Key' + nextCh.toUpperCase() : 'Backspace';
      setNextKey(kb, G.nextCode);
      if (!ok) setHint(G.composing ? '現在要打英文！按 Backspace 刪掉，再按一下 Shift 切換成英文' : '打錯了，按 Backspace 刪掉', 'bad');
      return;
    }
    if (q.kind === 'symbol') {
      G.nextCode = q.passed ? 'Backspace' : q.code;
      setNextKey(kb, G.nextCode);
      return;
    }
    const r = analyze(q);
    dbg('  analyze', r.status + ' idx=' + r.idx + ' committed=' + JSON.stringify(G.committed) + ' comp=' + JSON.stringify(G.composing));
    G.nextCode = r.next; setNextKey(kb, r.next);
    // 字磚
    const tiles = $('target-tiles');
    if (tiles.children.length !== q.text.length) {
      tiles.innerHTML = q.text.split('').map((c, i) => `<div class="tile"><div class="ch">${c}</div><div class="zy">${q.zhuyin[i]}</div></div>`).join('');
    }
    tiles.querySelectorAll('.tile').forEach((t, i) => { t.classList.toggle('done', i < r.idx); t.classList.toggle('current', i === r.idx); });
    // 按鍵順序指引
    const guide = $('key-guide');
    if (r.idx < q.text.length) {
      const seq = keySeq(q.zhuyin[r.idx]);
      guide.innerHTML = seq.map((k, i) => `<div class="kg ${i < r.symDone ? 'done' : ''} ${i === r.symDone && r.status === 'typing' ? 'next' : ''}"><div class="z">${k.label}</div><div class="e">${k.code === 'Space' ? '空白鍵' : CODE_INFO[k.code].en + ' 鍵'}</div></div>`).join('<span class="arrow">→</span>');
      if (r.idx === q.text.length - 1) guide.innerHTML += '<span class="arrow">→</span><div class="kg"><div class="z">⏎</div><div class="e">Enter</div></div>';
    } else {
      guide.innerHTML = '<div class="kg next"><div class="z">⏎</div><div class="e">Enter 送出</div></div>';
    }
    // 提示與錯誤計數（同一種錯只算一次）
    const bad = ['valueWrong', 'extra', 'symWrong', 'wrongChar'].includes(r.status);
    // 組字進行中時，「已送出的文字」本來就不該改變；
    // 這時候算出來的 valueWrong 一定是輸入法狀態還沒同步，不能算學生打錯。
    const countable = bad && !(r.status === 'valueWrong' && G.composing);
    if (countable && !G.lastBad) addWrong();
    G.lastBad = countable;
    if (r.msg) setHint(r.msg, bad ? 'bad' : 'good');
    else if (G.wrongOnQ >= 3 && r.idx < q.text.length) setHint('按鍵順序：' + keySeq(q.zhuyin[r.idx]).map(k => codeLabel(k.code)).join(' → ') + ' → Enter');
    else setHint('');
  }

  // 每一題最多只記 MAX_WRONG_PER_Q 次錯：就算未來遇到新的輸入法怪例，
  // 成績也不會出現「正確 8 錯誤 44」這種不合理的數字。
  function addWrong() {
    if (G.wrongOnQ >= MAX_WRONG_PER_Q) return;
    G.wrong++; G.wrongOnQ++; playBad();
  }
  function wrongHit(msg, highlightCode) {
    addWrong();
    setHint(msg, 'bad');
    if (highlightCode) tempHighlight(kb, highlightCode, 1500);
  }

  function succeed() {
    G.correct++; playGood();
    setHint('答對了！', 'good');
    const f = $('flash'); f.textContent = ['⭐', '🎉', '👍', '💯', '🌟'][G.correct % 5];
    f.classList.remove('hidden'); f.style.animation = 'none'; void f.offsetWidth; f.style.animation = '';
    setTimeout(() => f.classList.add('hidden'), 700);
    G.busy = true;
    setTimeout(() => {
      G.busy = false; box.value = ''; G.composing = ''; G.committed = ''; G.lastBad = false; G.wrongOnQ = 0;
      G.i++;
      if (G.i >= G.qs.length) finishLevel(); else renderQuestion();
    }, 650);
  }

  function checkValue() {
    if (G.busy || G.composing) return;
    const q = cur();
    if (q.kind === 'symbol') {
      // 學生可能按 Enter 把注音符號送進輸入框，一律清掉
      if (box.value) box.value = '';
      if (q.passed) succeed();
      return;
    }
    if (q.kind === 'en') {
      if (box.value.toLowerCase() === q.text) succeed(); else renderState();
      return;
    }
    if (box.value === q.text) succeed(); else renderState();
  }

  // ---------- 輸入事件 ----------
  box.addEventListener('keydown', e => {
    if (G.busy) { e.preventDefault(); return; }
    flashKey(kb, e.code, 'pressed');
    $('capslock-warn').classList.toggle('hidden', !(e.getModifierState && e.getModifierState('CapsLock')));
    const isProcess = e.key === 'Process' || e.isComposing || e.keyCode === 229;
    dbg('keydown', e.code + ' key=' + JSON.stringify(e.key) + ' isProcess=' + isProcess);
    // 只用英文字母／數字判斷「英文模式」：中文模式下空白鍵、標點在沒組字時會直接送出，不能當依據
    const printable = /^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey;
    if (isProcess) setMode('zh'); else if (printable) setMode('en');
    const q = cur();
    if (MODIFIERS.has(e.code)) return;

    if (q.kind === 'symbol') {
      if (!isProcess && printable) { e.preventDefault(); wrongHit('還在英文模式！按一下 Shift 切換成中文', 'ShiftLeft'); return; }
      if (e.key === 'Enter' && !isProcess) { e.preventDefault(); checkValue(); return; }
      if (q.passed || isProcess === false) return;
      if (e.code !== q.code && e.code !== 'Backspace' && e.code !== 'Escape') { flashKey(kb, e.code, 'wrong'); wrongHit('不是這個鍵喔，找找看黃色的鍵', q.code); }
      return;
    }
    if (q.kind === 'en') {
      if (isProcess) { if (!G.composing) wrongHit('現在要打英文！按 Backspace 刪掉，再按一下 Shift 切換成英文', 'ShiftLeft'); return; }
      if (e.key === 'Enter') { e.preventDefault(); checkValue(); return; }
      if (printable) {
        const expected = q.text[box.value.length];
        if (!q.text.startsWith(box.value.toLowerCase()) || e.key.toLowerCase() !== expected) { flashKey(kb, e.code, 'wrong'); }
      }
      return;
    }
    // text 題
    if (e.key === 'Enter' && !isProcess) { e.preventDefault(); checkValue(); return; }
    if (!isProcess && printable) { e.preventDefault(); wrongHit('還在英文模式！按一下 Shift 切換成中文', 'ShiftLeft'); }
  });
  box.addEventListener('compositionstart', () => { syncCommitted(); G.composing = ''; setMode('zh'); dbg('comp-start', ''); });
  box.addEventListener('compositionupdate', e => {
    G.composing = e.data || '';
    const q = cur();
    if (q.kind === 'symbol') {
      if (!q.passed && G.composing.includes(q.text)) { q.passed = true; playGood(); setHint('答對了！按 Backspace 刪掉，換下一題', 'good'); }
      else if (!q.passed && G.composing.length) { setHint('不是這個，按 Backspace 刪掉再找找', 'bad'); }
      if (q.passed && !G.composing) { setTimeout(checkValue, 0); }
    }
    dbg('comp-update', JSON.stringify(G.composing));
    renderState();
  });
  box.addEventListener('compositionend', () => {
    G.composing = '';
    setTimeout(() => { syncCommitted(); dbg('comp-end', JSON.stringify(G.committed)); renderState(); checkValue(); }, 0);
  });
  box.addEventListener('input', e => {
    if (e.isComposing || G.composing) { renderState(); return; }
    // 微軟注音在組字結束後會再送一次 input；非組字中的變動一律重新檢查
    syncCommitted();
    dbg('input', JSON.stringify(G.committed));
    checkValue();
  });
  box.addEventListener('blur', () => $('focus-cover').classList.remove('hidden'));
  box.addEventListener('focus', () => $('focus-cover').classList.add('hidden'));
  $('focus-cover').addEventListener('click', () => box.focus());

  // ---------- 結算 ----------
  function starsFor(correct, wrong) {
    const acc = correct + wrong === 0 ? 1 : correct / (correct + wrong);
    return acc >= 0.85 ? 3 : acc >= 0.6 ? 2 : 1;
  }
  function finishLevel() {
    clearInterval(G.timerId);
    const secs = Math.round((Date.now() - G.start) / 1000);
    const stars = starsFor(G.correct, G.wrong);
    const acc = Math.round(100 * G.correct / Math.max(1, G.correct + G.wrong));
    G.result = { level: G.level.id, correct: G.correct, wrong: G.wrong, seconds: secs, stars, acc };
    const best = loadJSON(LS_BEST, {}); if (!best[G.level.id] || best[G.level.id] < stars) { best[G.level.id] = stars; saveJSON(LS_BEST, best); }
    $('result-level').textContent = `第 ${G.level.id} 關 ${G.level.icon} ${G.level.name}`;
    $('result-stars').textContent = '⭐'.repeat(stars) + '☆'.repeat(3 - stars);
    $('r-correct').textContent = G.correct; $('r-wrong').textContent = G.wrong; $('r-acc').textContent = acc + '%'; $('r-time').textContent = secs + ' 秒';
    $('record-box').classList.toggle('hidden', !settings.askName);
    $('record-name').value = ''; $('record-msg').textContent = ''; $('btn-save-record').disabled = false;
    $('btn-next-level').classList.toggle('hidden', !LEVELS[G.level.id + 1] || !settings.enabled[G.level.id + 1]);
    playWin();
    showScreen('result');
  }
  $('btn-save-record').addEventListener('click', () => {
    const name = $('record-name').value.trim();
    if (!name) { $('record-msg').textContent = '請先輸入座號或姓名'; return; }
    const recs = loadJSON(LS_RECORDS, []);
    recs.push(Object.assign({ name, date: new Date().toLocaleString('zh-TW', { hour12: false }) }, G.result));
    saveJSON(LS_RECORDS, recs);
    $('record-msg').textContent = '✅ 已記錄！'; $('btn-save-record').disabled = true;
  });
  $('btn-skip-record').addEventListener('click', () => $('record-box').classList.add('hidden'));
  $('btn-retry').addEventListener('click', () => startLevel(G.level));
  $('btn-next-level').addEventListener('click', () => startLevel(LEVELS[G.level.id + 1]));
  $('btn-result-home').addEventListener('click', () => { renderHome(); showScreen('home'); });
  $('btn-quit').addEventListener('click', () => { clearInterval(G.timerId); renderHome(); showScreen('home'); });

  // ---------- 首頁 ----------
  function renderHome() {
    const best = loadJSON(LS_BEST, {});
    const list = $('level-list'); list.innerHTML = '';
    LEVELS.filter(l => settings.enabled[l.id]).forEach(l => {
      const card = document.createElement('div'); card.className = 'level-card';
      card.innerHTML = `<div class="num">第 ${l.id} 關</div><div class="name">${l.icon} ${l.name}</div><div class="desc">${l.desc}</div><div class="best">${best[l.id] ? '⭐'.repeat(best[l.id]) : '　'}</div>`;
      card.addEventListener('click', () => { beep(1, .01); startLevel(l); });
      list.appendChild(card);
    });
    // 挑戰模式：注音塔防（td.js 載入後才會有 ZY.startTD）
    if (settings.tdEnabled && typeof ZY.startTD === 'function') {
      const tdBest = loadJSON(ZY.LS_TD_BEST, 0);
      const card = document.createElement('div'); card.className = 'level-card td-card';
      card.innerHTML = `<div class="num">挑戰模式</div><div class="name">🏰 注音塔防</div><div class="desc">打出注音消滅怪獸，最後打倒大魔王！</div><div class="best">${tdBest ? '最高 ' + tdBest + ' 分' : '　'}</div>`;
      card.addEventListener('click', () => { beep(1, .01); ZY.startTD(); });
      list.appendChild(card);
    }
  }
  // 給 td.js 回首頁用
  ZY.goHome = () => { renderHome(); showScreen('home'); };
  // td.js 比 app.js 晚載入，載完會呼叫這個把「注音塔防」卡片補上去
  ZY.renderHome = renderHome;

  // ---------- 示範鍵盤（老師投影） ----------
  const dbox = $('demo-box'), dkb = $('demo-keyboard');
  let demoComposing = '';
  function setDemoMode(m) { const b = $('demo-mode-badge'); b.className = 'mode-badge ' + m; b.textContent = m === 'zh' ? '輸入法：中文 ㄅ' : m === 'en' ? '輸入法：英文 A' : '輸入法：？'; }
  function renderDemo() {
    const committed = demoComposing ? dbox.value.slice(0, dbox.value.length - demoComposing.length) : dbox.value;
    $('demo-committed').textContent = committed;
    $('demo-composing').textContent = demoComposing ? `正在打：${demoComposing}` : '';
  }
  dbox.addEventListener('keydown', e => {
    flashKey(dkb, e.code, 'pressed');
    const isProcess = e.key === 'Process' || e.isComposing || e.keyCode === 229;
    if (isProcess) setDemoMode('zh'); else if (e.key.length === 1) setDemoMode('en');
    const info = CODE_INFO[e.code];
    $('demo-lastkey').textContent = info ? `按了：${info.en || ''} ${info.label || ''}`.trim() : `按了：${e.key}`;
    setNextKey(dkb, null); keyEls(dkb, e.code).forEach(k => k.classList.add('next'));
  });
  dbox.addEventListener('compositionstart', () => { demoComposing = ''; setDemoMode('zh'); });
  dbox.addEventListener('compositionupdate', e => { demoComposing = e.data || ''; renderDemo(); });
  dbox.addEventListener('compositionend', () => { demoComposing = ''; setTimeout(renderDemo, 0); });
  dbox.addEventListener('input', renderDemo);
  dbox.addEventListener('blur', () => $('demo-cover').classList.remove('hidden'));
  dbox.addEventListener('focus', () => $('demo-cover').classList.add('hidden'));
  $('demo-cover').addEventListener('click', () => dbox.focus());
  $('btn-demo-clear').addEventListener('click', () => { dbox.value = ''; demoComposing = ''; renderDemo(); dbox.focus(); });
  $('btn-demo').addEventListener('click', () => { dbox.value = ''; renderDemo(); setDemoMode('unknown'); showScreen('demo'); });
  $('btn-demo-quit').addEventListener('click', () => { renderHome(); showScreen('home'); });

  // ---------- 老師模式 ----------
  function renderSettingsForm() {
    const f = $('settings-form');
    f.innerHTML = LEVELS.map(l => `
      <label>第 ${l.id} 關 ${l.name}：開放 <input type="checkbox" data-en="${l.id}" ${settings.enabled[l.id] ? 'checked' : ''}></label>
      <label>第 ${l.id} 關 題數 <input type="number" min="1" max="50" data-n="${l.id}" value="${settings.n[l.id]}"></label>`).join('') + `
      <label>每一關都顯示計時 <input type="checkbox" id="s-timer" ${settings.timerAll ? 'checked' : ''}></label>
      <label>結算時顯示「輸入姓名記錄」 <input type="checkbox" id="s-askname" ${settings.askName ? 'checked' : ''}></label>
      <label>音效 <input type="checkbox" id="s-sound" ${settings.sound ? 'checked' : ''}></label>
      <label class="sep">【挑戰模式：注音塔防】</label>
      <label>開放塔防 <input type="checkbox" id="s-td-en" ${settings.tdEnabled ? 'checked' : ''}></label>
      <label>起始速度
        <select id="s-td-speed">
          <option value="slow" ${settings.tdSpeed === 'slow' ? 'selected' : ''}>慢（三年級初學）</option>
          <option value="normal" ${settings.tdSpeed === 'normal' ? 'selected' : ''}>中</option>
          <option value="fast" ${settings.tdSpeed === 'fast' ? 'selected' : ''}>快（挑戰）</option>
        </select></label>
      <label>城牆心數 <input type="number" min="1" max="5" id="s-td-hearts" value="${settings.tdHearts}"></label>
      <label>出現大魔王 <input type="checkbox" id="s-td-boss" ${settings.tdBoss ? 'checked' : ''}></label>
      <label>螢幕鍵盤提示下一個鍵 <input type="checkbox" id="s-td-keyhint" ${settings.tdKeyHint ? 'checked' : ''}></label>`;
  }
  function renderRecords() {
    const recs = loadJSON(LS_RECORDS, []);
    const tb = $('records-table').querySelector('tbody');
    tb.innerHTML = recs.length ? recs.slice().reverse().map(r => {
      const isTd = r.mode === 'td';
      const what = isTd ? `🏰 塔防（撐到第 ${r.wave} 波）` : `第 ${r.level} 關 ${LEVELS[r.level] ? LEVELS[r.level].name : ''}`;
      const last = isTd ? `${r.score} 分` : '⭐'.repeat(r.stars);
      return `<tr><td>${r.date}</td><td>${escapeHtml(r.name)}</td><td>${what}</td><td>${r.correct}</td><td>${r.wrong}</td><td>${r.acc}%</td><td>${r.seconds} 秒</td><td>${last}</td></tr>`;
    }).join('')
      : '<tr><td colspan="8">還沒有任何記錄</td></tr>';
  }
  $('btn-teacher').addEventListener('click', () => { renderSettingsForm(); renderRecords(); showScreen('teacher'); });
  $('btn-teacher-quit').addEventListener('click', () => { renderHome(); showScreen('home'); });
  $('btn-save-settings').addEventListener('click', () => {
    const f = $('settings-form');
    f.querySelectorAll('[data-en]').forEach(el => settings.enabled[el.dataset.en] = el.checked);
    f.querySelectorAll('[data-n]').forEach(el => settings.n[el.dataset.n] = Math.max(1, parseInt(el.value, 10) || 1));
    settings.timerAll = $('s-timer').checked; settings.askName = $('s-askname').checked; settings.sound = $('s-sound').checked;
    settings.tdEnabled = $('s-td-en').checked;
    settings.tdSpeed = $('s-td-speed').value;
    settings.tdHearts = Math.min(5, Math.max(1, parseInt($('s-td-hearts').value, 10) || 3));
    settings.tdBoss = $('s-td-boss').checked;
    settings.tdKeyHint = $('s-td-keyhint').checked;
    ZY.setSound(settings.sound);
    saveJSON(LS_SETTINGS, settings);
    $('settings-msg').textContent = '✅ 已儲存';
  });
  $('btn-reset-settings').addEventListener('click', () => {
    settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)); saveJSON(LS_SETTINGS, settings); ZY.setSound(settings.sound); renderSettingsForm(); $('settings-msg').textContent = '已恢復預設';
  });
  $('btn-export-csv').addEventListener('click', () => {
    const recs = loadJSON(LS_RECORDS, []);
    const rows = [['日期', '座號／姓名', '模式', '關卡／波次', '答對／消滅', '錯誤', '正確率', '秒數', '星星', '分數', '最高連擊']]
      .concat(recs.map(r => r.mode === 'td'
        ? [r.date, r.name, '塔防', `第${r.wave}波`, r.correct, r.wrong, r.acc + '%', r.seconds, '—', r.score, r.combo]
        : [r.date, r.name, '闖關', `第${r.level}關 ${LEVELS[r.level] ? LEVELS[r.level].name : ''}`, r.correct, r.wrong, r.acc + '%', r.seconds, r.stars, '—', '—']));
    const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = `注音打字成績_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('btn-clear-records').addEventListener('click', () => {
    if (confirm('確定要清空這台電腦上的所有成績記錄嗎？（無法復原）')) { saveJSON(LS_RECORDS, []); renderRecords(); }
  });

  // ---------- 啟動 ----------
  renderKeyboard(kb);
  renderKeyboard(dkb);
  renderHome();
  showScreen('home');
})();
