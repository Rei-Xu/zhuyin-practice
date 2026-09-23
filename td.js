/* 注音塔防（挑戰模式）
 *
 * 判定方式跟闖關模式「刻意不同」，原因寫在這裡，改的人請先看完：
 *   闖關模式是看「輸入法組出來的字」對不對（要選字、要按 Enter）。
 *   塔防節奏快，微軟注音的選字視窗會擋住怪獸，對三年級太挫折，
 *   所以塔防改成看「有沒有照順序按對那一串實體按鍵」——
 *   ㄌㄠˇㄏㄨˇ 就是 x → l → 3 → c → j → 3 這六個鍵。
 *   好處是完全不受輸入法版本、選字結果、組字串格式影響，不會再有正確率爆掉的問題。
 *   但仍然要求「現在是中文模式」（keydown 帶 Process／keyCode 229），
 *   所以學生不能用英文模式亂按矇混過關。
 */
(function () {
  'use strict';

  const ZY = window.ZY;
  const $ = id => document.getElementById(id);
  const bank = () => window.WORD_BANK || {};

  // ---------- 設定 ----------
  const TD_DEFAULTS = { tdSpeed: 'normal', tdHearts: 3, tdBoss: true, tdKeyHint: true, sound: true };
  function settings() {
    return Object.assign({}, TD_DEFAULTS, ZY.loadJSON(ZY.LS_SETTINGS, {}));
  }
  const SPEED_MUL = { slow: 1.45, normal: 1, fast: 0.75 };   // 乘在「走完全程要幾秒」上，數字越大越慢

  // 每一波的設定：詞從哪裡來、幾隻、走完全程幾毫秒
  function waveConf(wave) {
    if (wave <= 3) return { src: 'chars', count: 3 + wave, travel: 19000 - (wave - 1) * 1000, gap: 3200 };
    if (wave <= 6) return { src: 'words', count: 4 + (wave - 4), travel: 15000 - (wave - 4) * 1000, gap: 3600 };
    // 7~9 波改用三字詞：要按的鍵變多，難度才真的往上走
    return { src: 'words3', count: 6, travel: 12000 - (wave - 7) * 800, gap: 3200 };
  }
  const BOSS_WAVE = 10;
  const BOSS_HP = 5;
  const BOSS_SECONDS = 90;

  // ---------- 遊戲狀態 ----------
  const T = {
    on: false, paused: false, over: false,
    hearts: 3, maxHearts: 3, score: 0, combo: 0, bestCombo: 0,
    wave: 1, tier: 0, killed: 0, wrong: 0,
    monsters: [], spawned: 0, spawnAt: 0, waveConf: null,
    boss: null, bossEndAt: 0,
    target: null, seq: [], progress: 0, needBackspace: false,
    startAt: 0, lastFrame: 0, raf: 0, uid: 1, set: TD_DEFAULTS, lastEnHint: 0,
  };

  const box = $('td-box'), lane = $('td-lane'), kb = $('td-keyboard');
  let suppressCover = false;

  // ---------- 小工具 ----------
  function setHint(msg, cls) { const h = $('td-hint'); h.textContent = msg || ''; h.className = 'hint ' + (cls || ''); }
  function setMode(m) {
    const b = $('td-mode-badge');
    b.className = 'mode-badge ' + m;
    b.textContent = m === 'zh' ? '輸入法：中文 ㄅ' : m === 'en' ? '輸入法：英文 A' : '輸入法：？';
  }
  function banner(text, ms) {
    const el = $('td-banner');
    el.textContent = text;
    el.classList.remove('hidden');
    clearTimeout(banner._t);
    banner._t = setTimeout(() => el.classList.add('hidden'), ms || 1400);
  }
  function shake() {
    const f = $('td-field');
    f.classList.remove('shake'); void f.offsetWidth; f.classList.add('shake');
  }

  // 把輸入法的組字狀態清乾淨：blur 會讓 Windows 中止目前組字，再 focus 回來重新開始。
  // 每消滅一隻怪獸就做一次，避免組字串越積越長、選字視窗一直彈出來。
  function resetIME() {
    suppressCover = true;
    try { box.blur(); } catch (e) { /* 忽略 */ }
    box.value = '';
    setTimeout(() => {
      box.value = '';
      if (T.on && !T.paused) { try { box.focus(); } catch (e) { /* 忽略 */ } }
      suppressCover = false;
    }, 0);
  }

  // ---------- 題庫 ----------
  // 用發牌器而不是每次隨機抽，否則同一波怪獸很容易出現一樣的語詞。
  const PICKERS = {};
  function pickWord(src) {
    if (!PICKERS[src]) {
      const list = (bank()[src] || []).filter(w => w && w.text && w.zhuyin && w.zhuyin.length === w.text.length);
      PICKERS[src] = ZY.makePicker(list);
    }
    return PICKERS[src].next() || { text: '注音', zhuyin: ['ㄓㄨˋ', 'ㄧㄣ'] };
  }

  // ---------- 怪獸 ----------
  const FACES = ['👾', '👹', '👻', '🐉', '🦑', '🦂', '🕷', '🐲'];
  function spawnMonster() {
    const w = pickWord(T.waveConf.src);
    const m = {
      id: T.uid++, text: w.text, zhuyin: w.zhuyin,
      seq: ZY.wordKeySeq(w.zhuyin),
      x: 1.02, row: T.spawned % 3, boss: false,
      travel: T.waveConf.travel * (SPEED_MUL[T.set.tdSpeed] || 1) * Math.pow(0.85, T.tier),
    };
    m.el = document.createElement('div');
    m.el.className = 'td-monster';
    m.el.style.top = (6 + m.row * 30) + '%';
    m.el.innerHTML =
      '<div class="td-mon-face">' + FACES[m.id % FACES.length] + '</div>' +
      '<div class="td-mon-word">' + ZY.escapeHtml(m.text) + '</div>' +
      '<div class="td-mon-zy"></div>';
    lane.appendChild(m.el);
    T.monsters.push(m);
    T.spawned++;
  }

  function spawnBoss() {
    const w = pickWord('bossWords');
    const m = {
      id: T.uid++, text: w.text, zhuyin: w.zhuyin, seq: ZY.wordKeySeq(w.zhuyin),
      x: 0.62, row: 1, boss: true, hp: BOSS_HP, travel: Infinity,
    };
    m.el = document.createElement('div');
    m.el.className = 'td-monster boss';
    m.el.style.top = '12%';
    m.el.innerHTML =
      '<div class="td-mon-face">👹</div>' +
      '<div class="td-mon-word">' + ZY.escapeHtml(m.text) + '</div>' +
      '<div class="td-mon-zy"></div>';
    lane.appendChild(m.el);
    T.monsters.push(m);
    T.boss = m;
    T.bossEndAt = performance.now() + BOSS_SECONDS * 1000 * (SPEED_MUL[T.set.tdSpeed] || 1);
    $('td-bossbar').classList.remove('hidden');
    banner('👹 大魔王出現了！連續打對 ' + BOSS_HP + ' 個語詞才能打倒它', 2200);
  }

  function bossNextWord() {
    const w = pickWord('bossWords');
    T.boss.text = w.text; T.boss.zhuyin = w.zhuyin; T.boss.seq = ZY.wordKeySeq(w.zhuyin);
    T.boss.el.querySelector('.td-mon-word').textContent = w.text;
  }

  function removeMonster(m, exploded) {
    if (exploded) {
      m.el.classList.add('boom');
      setTimeout(() => m.el.remove(), 380);
    } else {
      m.el.remove();
    }
    const i = T.monsters.indexOf(m);
    if (i >= 0) T.monsters.splice(i, 1);
    if (m === T.boss) { T.boss = null; $('td-bossbar').classList.add('hidden'); }
  }

  // ---------- 鎖定目標（永遠是最靠近城牆的那一隻） ----------
  function pickTarget() {
    let best = null;
    T.monsters.forEach(m => { if (!best || m.x < best.x) best = m; });
    if (best !== T.target) {
      T.target = best;
      T.seq = best ? best.seq : [];
      T.progress = 0;
      T.needBackspace = false;
      resetIME();
    }
    renderTarget();
  }

  function renderTarget() {
    T.monsters.forEach(m => {
      m.el.classList.toggle('target', m === T.target);
      // 不是目標的怪獸不顯示注音，避免畫面太亂，也避免留著上一輪打到一半的顏色
      if (m !== T.target) m.el.querySelector('.td-mon-zy').textContent = '';
    });
    const wordEl = $('td-target-word'), keysEl = $('td-target-keys');
    if (!T.target) {
      wordEl.textContent = '　';
      keysEl.innerHTML = '';
      ZY.setNextKey(kb, null);
      return;
    }
    wordEl.textContent = T.target.text;
    keysEl.innerHTML = T.seq.map((k, i) =>
      '<div class="kg ' + (i < T.progress ? 'done' : '') + ' ' + (i === T.progress ? 'next' : '') + '">' +
      '<div class="z">' + k.label + '</div>' +
      '<div class="e">' + (k.code === 'Space' ? '空白鍵' : ZY.CODE_INFO[k.code].en + ' 鍵') + '</div></div>'
    ).join('<span class="arrow">→</span>');
    // 怪獸身上的注音：已打中的變色
    T.target.el.querySelector('.td-mon-zy').innerHTML =
      T.seq.map((k, i) => '<span class="' + (i < T.progress ? 'hit' : '') + '">' + k.label + '</span>').join('');
    ZY.setNextKey(kb, T.set.tdKeyHint && T.seq[T.progress] ? T.seq[T.progress].code : null);
  }

  // ---------- 打中 / 消滅 ----------
  function comboMul() { return T.combo >= 10 ? 2 : T.combo >= 5 ? 1.5 : 1; }

  function hitKey() {
    T.progress++;
    ZY.playTick();
    if (T.target) {
      T.target.el.classList.remove('hit'); void T.target.el.offsetWidth; T.target.el.classList.add('hit');
    }
    if (T.progress >= T.seq.length) killTarget(); else renderTarget();
  }

  function killTarget() {
    const m = T.target;
    if (!m) return;
    T.killed++;
    T.combo++;
    if (T.combo > T.bestCombo) T.bestCombo = T.combo;
    T.score += Math.round(100 * m.text.length * comboMul());
    ZY.playBoom();
    if (m.boss) {
      m.hp--;
      renderBossHp();
      T.progress = 0; T.needBackspace = false;
      if (m.hp <= 0) { bossDown(); return; }
      bossNextWord();
      T.seq = m.seq;
      banner('打中了！魔王還剩 ' + m.hp + ' 格血', 900);
      resetIME();
      renderHud(); renderTarget();
      return;
    }
    removeMonster(m, true);
    T.target = null;
    renderHud();
    pickTarget();
  }

  function bossDown() {
    T.score += 2000;
    ZY.playWin();
    banner('🏆 打倒大魔王了！', 2400);
    removeMonster(T.boss, true);
    T.target = null;
    T.tier++;
    T.wave = 1;
    if (T.hearts < T.maxHearts) T.hearts++;
    startWave();
    renderHud();
  }

  function wrongKey(code) {
    T.wrong++;
    T.combo = 0;
    T.needBackspace = true;
    ZY.playBad();
    if (code) ZY.flashKey(kb, code, 'wrong');
    setHint('按錯了！按一下 Backspace 刪掉，再繼續打', 'bad');
    if (T.boss) { T.boss.hp = Math.min(BOSS_HP, T.boss.hp + 1); renderBossHp(); banner('👹 魔王回了一格血！', 900); }
    renderHud();
  }

  // ---------- 城牆 ----------
  function castleHit(m) {
    T.hearts--;
    T.combo = 0;
    ZY.playHurt();
    shake();
    const wasTarget = (m === T.target);
    removeMonster(m, false);
    if (wasTarget) T.target = null;
    renderHud();
    if (T.hearts <= 0) { gameOver(); return; }
    pickTarget();
  }

  // ---------- HUD ----------
  function renderHud() {
    $('td-wave').textContent = T.boss ? '👹 魔王關' : '第 ' + T.wave + ' 波' + (T.tier ? '（第 ' + (T.tier + 1) + ' 輪）' : '');
    $('td-hearts').textContent = '❤️'.repeat(Math.max(0, T.hearts)) + '🖤'.repeat(Math.max(0, T.maxHearts - T.hearts));
    $('td-score').textContent = T.score + ' 分';
    const c = $('td-combo');
    c.textContent = T.combo >= 2 ? '🔥 連擊 ' + T.combo : '';
    c.className = 'td-combo' + (T.combo >= 5 ? ' hot' : '');
  }
  function renderBossHp() {
    if (!T.boss) return;
    $('td-boss-hp').textContent = '❤️'.repeat(Math.max(0, T.boss.hp)) + '🖤'.repeat(Math.max(0, BOSS_HP - T.boss.hp));
  }

  // ---------- 波次 ----------
  function startWave() {
    if (T.set.tdBoss && T.wave === BOSS_WAVE) { spawnBoss(); renderBossHp(); renderHud(); pickTarget(); return; }
    if (!T.set.tdBoss && T.wave === BOSS_WAVE) { T.wave = 1; T.tier++; }
    T.waveConf = waveConf(T.wave);
    T.spawned = 0;
    T.spawnAt = performance.now() + 600;
    banner('第 ' + T.wave + ' 波來了！', 1100);
    renderHud();
  }

  // ---------- 主迴圈 ----------
  function frame(now) {
    if (!T.on) return;
    T.raf = requestAnimationFrame(frame);
    if (T.paused) { T.lastFrame = now; return; }
    const dt = Math.min(100, now - (T.lastFrame || now));
    T.lastFrame = now;

    const elapsed = now - T.startAt;
    const speedMul = Math.min(2, 1 + 0.1 * Math.floor(elapsed / 30000));

    // 生怪
    if (!T.boss && T.waveConf && T.spawned < T.waveConf.count && now >= T.spawnAt) {
      spawnMonster();
      T.spawnAt = now + T.waveConf.gap / speedMul;
      if (!T.target) pickTarget();
    }

    // 移動
    let reordered = false;
    for (let i = T.monsters.length - 1; i >= 0; i--) {
      const m = T.monsters[i];
      if (m.boss) continue;
      m.x -= (dt / m.travel) * speedMul;
      m.el.style.left = (m.x * 100) + '%';
      if (m.x <= 0) { castleHit(m); reordered = true; if (T.over) return; }
    }
    if (!reordered && T.monsters.length) {
      // 最靠近城牆的怪獸可能換人了
      let front = null;
      T.monsters.forEach(m => { if (!front || m.x < front.x) front = m; });
      if (front !== T.target) pickTarget();
    }

    // 魔王倒數
    if (T.boss) {
      const left = Math.max(0, Math.ceil((T.bossEndAt - now) / 1000));
      $('td-boss-time').textContent = '⏱ ' + left;
      if (left <= 0) {
        banner('👹 魔王攻破城牆了！', 1800);
        T.hearts -= 2; shake(); ZY.playHurt();
        removeMonster(T.boss, false);
        T.target = null;
        renderHud();
        if (T.hearts <= 0) { gameOver(); return; }
        T.wave = 1; T.tier++; startWave(); pickTarget();
      }
    }

    // 這一波打完了
    if (!T.boss && T.waveConf && T.spawned >= T.waveConf.count && T.monsters.length === 0) {
      T.wave++;
      T.score += 200;
      startWave();
    }
  }

  // ---------- 鍵盤輸入 ----------
  box.addEventListener('keydown', e => {
    if (!T.on) return;
    ZY.flashKey(kb, e.code, 'pressed');
    if (ZY.MODIFIERS.has(e.code)) return;

    const ime = ZY.isIMEKey(e);
    if (ime) setMode('zh');

    if (T.paused) { e.preventDefault(); return; }

    // Esc：這個詞整個重來（輸入法也一起清乾淨），不扣分
    if (e.code === 'Escape') {
      e.preventDefault();
      T.progress = 0; T.needBackspace = false;
      resetIME(); setHint('已重來，從第一個注音開始', ''); renderTarget();
      return;
    }
    // Enter：輸入法會把組字送出去，所以當成「整個詞重來」，不扣分
    if (e.code === 'Enter') {
      e.preventDefault();
      T.progress = 0; T.needBackspace = false;
      resetIME(); renderTarget();
      return;
    }
    if (e.code === 'Backspace') {
      if (T.needBackspace) { T.needBackspace = false; setHint('好，繼續打', ''); }
      else if (T.progress > 0) T.progress--;
      renderTarget();
      return;
    }

    // 還在英文模式：提醒但不扣分（三年級很常忘記切）
    if (!ime) {
      const printable = /^[a-zA-Z0-9]$/.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey;
      if (printable) {
        e.preventDefault();
        setMode('en');
        const now = Date.now();
        if (now - T.lastEnHint > 1200) {
          T.lastEnHint = now;
          setHint('還在英文模式！按一下 Shift 切換成中文', 'bad');
          ZY.keyEls(kb, 'ShiftLeft').forEach(k => { k.classList.add('next'); setTimeout(() => k.classList.remove('next'), 1200); });
        }
      }
      return;
    }

    if (!T.target) return;
    if (T.needBackspace) return;          // 先按 Backspace 把打錯的注音刪掉，才繼續判定

    const want = T.seq[T.progress];
    if (!want) return;
    if (e.code === want.code) { setHint('', ''); hitKey(); }
    else wrongKey(e.code);
  });

  box.addEventListener('compositionstart', () => setMode('zh'));
  box.addEventListener('blur', () => {
    if (suppressCover || !T.on) return;
    $('td-cover').classList.remove('hidden');
    pause(true);
  });
  box.addEventListener('focus', () => $('td-cover').classList.add('hidden'));
  $('td-cover').addEventListener('click', () => { box.focus(); pause(false); });

  // ---------- 暫停 ----------
  function pause(on) {
    if (!T.on || T.over) return;
    T.paused = on;
    $('btn-td-pause').textContent = on ? '▶ 繼續' : '⏸ 暫停';
    if (on) banner('⏸ 暫停中', 100000);
    else { $('td-banner').classList.add('hidden'); setTimeout(() => box.focus(), 0); }
  }
  $('btn-td-pause').addEventListener('click', () => pause(!T.paused));
  document.addEventListener('visibilitychange', () => { if (document.hidden && T.on) pause(true); });

  // ---------- 開始 / 結束 ----------
  function start() {
    const st = settings();
    T.set = st;
    ZY.setSound(st.sound);
    T.on = true; T.paused = false; T.over = false;
    T.maxHearts = st.tdHearts; T.hearts = st.tdHearts;
    T.score = 0; T.combo = 0; T.bestCombo = 0;
    T.wave = 1; T.tier = 0; T.killed = 0; T.wrong = 0;
    T.monsters.forEach(m => m.el.remove());
    T.monsters = []; T.target = null; T.seq = []; T.progress = 0; T.needBackspace = false;
    T.boss = null; T.uid = 1;
    lane.innerHTML = '';
    $('td-bossbar').classList.add('hidden');
    $('td-cover').classList.add('hidden');
    box.value = '';
    setMode('unknown');
    setHint('照著下面的順序按鍵，就能消滅最前面那隻怪獸！', '');
    ZY.renderKeyboard(kb);
    renderHud(); renderTarget();
    ZY.showScreen('td');
    setTimeout(() => box.focus(), 60);
    T.startAt = performance.now();
    T.lastFrame = 0;
    startWave();
    cancelAnimationFrame(T.raf);
    T.raf = requestAnimationFrame(frame);
  }

  function stop() {
    T.on = false; T.paused = false;
    cancelAnimationFrame(T.raf);
    $('td-banner').classList.add('hidden');
  }

  function gameOver() {
    T.over = true;
    stop();
    const secs = Math.round((performance.now() - T.startAt) / 1000);
    const total = T.killed + T.wrong;
    const acc = total === 0 ? 100 : Math.round(100 * T.killed / total);
    const best = ZY.loadJSON(ZY.LS_TD_BEST, 0);
    if (T.score > best) ZY.saveJSON(ZY.LS_TD_BEST, T.score);
    T.result = {
      mode: 'td', wave: T.wave, tier: T.tier, score: T.score, combo: T.bestCombo,
      correct: T.killed, wrong: T.wrong, acc, seconds: secs,
    };
    $('td-result-title').textContent = '🏰 城牆倒了！';
    $('td-result-sub').textContent = '下次再試試看，你已經消滅了 ' + T.killed + ' 隻怪獸';
    $('td-r-score').textContent = T.score;
    $('td-r-killed').textContent = T.killed;
    $('td-r-wave').textContent = '第 ' + T.wave + ' 波' + (T.tier ? '（第 ' + (T.tier + 1) + ' 輪）' : '');
    $('td-r-combo').textContent = T.bestCombo;
    $('td-r-wrong').textContent = T.wrong;
    $('td-r-best').textContent = Math.max(best, T.score);
    const st = settings();
    $('td-record-box').classList.toggle('hidden', st.askName === false);
    $('td-record-name').value = '';
    $('td-record-msg').textContent = '';
    $('btn-td-save-record').disabled = false;
    ZY.showScreen('td-result');
  }

  // ---------- 按鈕 ----------
  $('btn-td-quit').addEventListener('click', () => { stop(); ZY.goHome(); });
  $('btn-td-again').addEventListener('click', () => start());
  $('btn-td-result-home').addEventListener('click', () => ZY.goHome());
  $('btn-td-skip-record').addEventListener('click', () => $('td-record-box').classList.add('hidden'));
  $('btn-td-save-record').addEventListener('click', () => {
    const name = $('td-record-name').value.trim();
    if (!name) { $('td-record-msg').textContent = '請先輸入座號或姓名'; return; }
    const recs = ZY.loadJSON(ZY.LS_RECORDS, []);
    recs.push(Object.assign({ name, date: new Date().toLocaleString('zh-TW', { hour12: false }) }, T.result));
    ZY.saveJSON(ZY.LS_RECORDS, recs);
    $('td-record-msg').textContent = '✅ 已記錄！';
    $('btn-td-save-record').disabled = true;
  });

  // 給 app.js 的首頁卡片用
  ZY.startTD = start;
  ZY.tdState = T;          // 自動測試與現場除錯用，游戲本身不讀它
  ZY.tdPause = pause;
  ZY.renderKeyboard(kb);
  if (typeof ZY.renderHome === 'function') ZY.renderHome();   // 把首頁的塔防卡片補上去
})();
