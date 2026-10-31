(() => {
  const STORAGE_KEY = 'ielts-vocab-mvp-v5';
  const VOCABULARY_VERSION = 5;
  const words = window.WORDS;
  const app = document.getElementById('app');
  const overall = document.getElementById('overallProgress');
  let state;
  let activeContinueHandler = null;

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  function freshState() { return { version: 5, vocabularyVersion: VOCABULARY_VERSION, completed: {}, day: null, todayCompleted: 0, session: null }; }
  const record = value => value && typeof value === 'object' && !Array.isArray(value);
  const unique = list => Array.isArray(list) && list.every(x => typeof x === 'string') && new Set(list).size === list.length;
  const wordById = id => words.find(w => w.word === id);
  const meaningById = id => { for (const w of words) { const m = w.meanings.find(x => x.id === id); if (m) return { ...m, word: w.word }; } return null; };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const shuffle = list => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const completedCount = () => words.filter(w => state.completed[w.word]).length;
  const remainingWords = () => words.filter(w => !state.completed[w.word]);
  function save() {
    const snapshot = JSON.stringify(state);
    try {
      localStorage.setItem(STORAGE_KEY, snapshot);
      localStorage.setItem(`${STORAGE_KEY}-snapshot`, snapshot);
    } catch (error) {
      console.warn('进度保存失败：', error);
    }
  }
  const progressFor = id => state.session.checked[id] || { enZhCorrect: 0, zhEnCorrect: 0, passed: false };
  const totalCorrect = p => p.enZhCorrect + p.zhEnCorrect;
  const statsText = p => `英译中：${p.enZhCorrect} / 2 · 中译英：${p.zhEnCorrect} / 2 · 总检查：${totalCorrect(p)} / 4`;
  const displayMeaning = m => `${m.pos} ${m.text}`;
  // 所有校验和恢复辅助函数已初始化后，再读取 localStorage。
  state = loadState();

  function validateState(data) {
    if (!record(data) || data.version !== 5 || !record(data.completed) || !Object.values(data.completed).every(v => typeof v === 'boolean')) throw new Error('进度文件格式不正确');
    if (data.day !== null && (typeof data.day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.day))) throw new Error('进度文件日期不正确');
    if (!Number.isInteger(data.todayCompleted) || data.todayCompleted < 0) throw new Error('进度文件格式不正确');
    const next = JSON.parse(JSON.stringify(data));
    next.vocabularyVersion = VOCABULARY_VERSION;
    next.completed = Object.fromEntries(Object.entries(next.completed).filter(([id, done]) => wordById(id) && done));
    if (next.session === null) return next;
    const s = next.session;
    if (!record(s) || s.date !== next.day || !Number.isInteger(s.batchNo) || s.batchNo < 1 || !unique(s.ids) || !s.ids.length || !s.ids.every(id => wordById(id))) throw new Error('进度文件任务不正确');
    if (!['learn','learn-confirm','check','done'].includes(s.phase) || !Number.isInteger(s.learnIndex) || s.learnIndex < 0 || s.learnIndex >= s.ids.length || !record(s.checked)) throw new Error('进度文件阶段不正确');
    for (const [id,p] of Object.entries(s.checked)) {
      if (!s.ids.includes(id) || !record(p) || !Number.isInteger(p.enZhCorrect) || !Number.isInteger(p.zhEnCorrect) || p.enZhCorrect < 0 || p.enZhCorrect > 2 || p.zhEnCorrect < 0 || p.zhEnCorrect > 2 || typeof p.passed !== 'boolean' || p.passed !== (p.enZhCorrect === 2 && p.zhEnCorrect === 2)) throw new Error('进度文件检查记录不正确');
    }
    if (s.ids.some(id => Boolean(next.completed[id]) !== Boolean(s.checked[id]?.passed))) throw new Error('进度文件累计记录不一致');
    const selected = s.ids.map(wordById);
    s.optionBank = [...new Set(selected.flatMap(w => w.meanings.map(m => m.id)))];
    s.maxMeaningCount = Math.max(...selected.map(w => w.meanings.length));
    s.doneToday = s.ids.filter(id => s.checked[id]?.passed).length;
    if (s.lastWord !== null && !s.ids.includes(s.lastWord)) throw new Error('进度文件题目不正确');
    if (s.current !== null) {
      const q = s.current;
      if (s.phase !== 'check' || !record(q) || !s.ids.includes(q.id) || !['en-zh','zh-en'].includes(q.direction)) throw new Error('进度文件题目不正确');
      if (q.direction === 'en-zh') {
        const expected = wordById(q.id).meanings.map(m => m.id);
        if (!unique(q.options) || !q.options.every(id => s.optionBank.includes(id)) || !expected.every(id => q.options.includes(id))) throw new Error('进度文件选项不正确');
        q.selected ??= [];
        if (!unique(q.selected) || q.selected.length > 3 || !q.selected.every(id => q.options.includes(id))) throw new Error('进度文件答案不正确');
      } else { q.answer ??= ''; if (typeof q.answer !== 'string') throw new Error('进度文件答案不正确'); }
      if (s.result && (!record(s.result) || typeof s.result.correct !== 'boolean' || s.result.direction !== q.direction)) throw new Error('进度文件结果不正确');
    } else if (s.result !== null) throw new Error('进度文件结果不正确');
    if (s.phase === 'done' && s.doneToday !== s.ids.length) throw new Error('进度文件完成状态不正确');
    return next;
  }
  function loadState() {
    let fallback = null;
    let lastError = null;
    try {
      const rawValues = [localStorage.getItem(STORAGE_KEY), localStorage.getItem(`${STORAGE_KEY}-snapshot`)].filter(Boolean);
      for (const raw of rawValues) {
        let data;
        try { data = JSON.parse(raw); } catch (error) { lastError = error; continue; }
        if (!data || data.version !== 5) continue;
        fallback ||= data;
        try { return validateState(data); } catch (error) { lastError = error; }
      }
    } catch (error) { lastError = error; }
    if (fallback) {
      // 临时批次损坏时保留已经过关的单词，避免关闭重开后累计进度清零。
      const recovered = freshState();
      recovered.day = typeof fallback.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fallback.day) ? fallback.day : null;
      recovered.todayCompleted = Number.isInteger(fallback.todayCompleted) && fallback.todayCompleted >= 0 ? fallback.todayCompleted : 0;
      recovered.completed = record(fallback.completed)
        ? Object.fromEntries(Object.entries(fallback.completed).filter(([id, done]) => wordById(id) && done === true))
        : {};
      console.warn('临时学习记录无法恢复，已保留累计过关记录：', lastError);
      return recovered;
    }
    return freshState();
  }
  function ensureToday() {
    const today = todayKey();
    if (state.day !== today) { state.day = today; state.todayCompleted = 0; state.session = null; save(); }
  }
  function setHeader() { overall.textContent = `${completedCount()} / ${words.length} 已过关`; }

  function render() {
    ensureToday(); setHeader();
    if (!state.session) return renderSetup(false);
    if (state.session.phase === 'learn') return renderLearn();
    if (state.session.phase === 'learn-confirm') return renderLearnConfirm();
    if (state.session.phase === 'check') return renderCheck();
    if (state.session.phase === 'done') return completedCount() === words.length ? renderAllDone() : renderDayDone();
    state.session = null; save(); renderSetup(false);
  }

  function renderSetup(additional) {
    const left = remainingWords().length;
    if (!left) return renderAllDone();
    const title = additional ? '今天再设一个任务' : '今天想记多少个词？';
    const intro = additional ? `本批完成后还剩 <strong>${left}</strong> 个未过关词。继续按 PDF 顺序选择下一批。` : `按 PDF 顺序从尚未过关的词中选取。当前剩余 <strong>${left}</strong> 个。`;
    app.innerHTML = `<section class="card narrow"><p class="eyebrow">${esc(todayKey())} · ${additional ? '追加任务' : '今日任务'}</p><h2>${title}</h2><p class="subtle">${intro} ${additional ? '今天可以重复追加任务。' : '任务设定后今天再次打开会自动接着上次进度。'}</p><form id="setupForm" class="setup-form"><div class="field"><label for="count">本批单词数</label><input id="count" type="number" min="1" max="${left}" value="${Math.min(20,left)}" required></div><button class="primary" type="submit">开始学习</button></form></section>`;
    document.getElementById('setupForm').addEventListener('submit', e => {
      e.preventDefault(); const count = Number(document.getElementById('count').value); const rem = remainingWords();
      if (!Number.isInteger(count) || count < 1 || count > rem.length) return;
      const selected = rem.slice(0,count); const ids = selected.map(w => w.word);
      state.session = { date: todayKey(), batchNo: additional && state.session ? state.session.batchNo + 1 : 1, ids, phase:'learn', learnIndex:0, checked:{}, current:null, result:null, doneToday:0, lastWord:null, optionBank:[...new Set(selected.flatMap(w => w.meanings.map(m => m.id)))], maxMeaningCount:Math.max(...selected.map(w => w.meanings.length)) };
      save(); render();
    });
  }

  function renderLearn() {
    const s = state.session, w = wordById(s.ids[s.learnIndex]), idx = s.learnIndex + 1, pct = Math.round((idx - 1) / s.ids.length * 100);
    const meanings = w.meanings.map(m => `<div class="meaning"><div class="meaning-title"><span class="pos">${esc(m.pos)}</span> ${esc(m.text)}</div><p class="example example-en">${esc(m.exampleEn)}</p><p class="example-cn">${esc(m.exampleZh)}</p></div>`).join('');
    app.innerHTML = `<section class="card"><div class="progress-row"><span>记忆环节 · 第 ${idx} / ${s.ids.length} 个</span><span>${pct}%</span></div><div class="bar"><span style="width:${pct}%"></span></div><div class="word-head"><div class="word">${esc(w.word)}</div><div class="phonetic">${esc(w.phonetic)}</div></div><div class="meaning-block">${meanings}</div><div class="actions"><button id="prev" class="secondary" ${idx===1?'disabled':''}>上一个</button><button id="next" class="primary">${idx===s.ids.length?'完成记忆':'下一个'}</button></div></section>`;
    document.getElementById('prev').addEventListener('click', () => { if (s.learnIndex > 0) { s.learnIndex--; save(); render(); } });
    document.getElementById('next').addEventListener('click', () => { if (idx === s.ids.length) s.phase='learn-confirm'; else s.learnIndex++; save(); render(); });
  }
  function renderLearnConfirm() {
    app.innerHTML = `<section class="card narrow confirmation"><p class="eyebrow">记忆环节完成</p><h2>今天的单词已经看完了</h2><p class="subtle">如果还不熟悉，可以返回记忆页继续翻看；如果已经准备好，就进入抽查。</p><div class="actions"><button id="backToLearn" class="secondary">返回记忆</button><button id="startCheck" class="primary">进入检查</button></div></section>`;
    document.getElementById('backToLearn').addEventListener('click', () => { state.session.phase='learn'; state.session.learnIndex=state.session.ids.length-1; save(); render(); });
    document.getElementById('startCheck').addEventListener('click', () => { state.session.phase='check'; state.session.current=null; state.session.result=null; save(); render(); });
  }
  function pendingIds() { return state.session.ids.filter(id => !progressFor(id).passed); }
  function makeOptions(word) {
    const correct = word.meanings.map(m => m.id), target = state.session.maxMeaningCount * 3;
    const distractors = shuffle(state.session.optionBank.filter(id => !correct.includes(id)));
    return shuffle([...correct, ...distractors.slice(0, Math.max(0,target-correct.length))]);
  }
  function newQuestion() {
    const pending = pendingIds();
    if (!pending.length) { state.session.phase='done'; state.session.doneToday=state.session.ids.length; save(); return null; }
    let candidates = pending; if (candidates.length > 1 && state.session.lastWord) { const filtered = candidates.filter(id => id !== state.session.lastWord); if (filtered.length) candidates=filtered; }
    const id = candidates[Math.floor(Math.random()*candidates.length)], p=progressFor(id), directions=[];
    if (p.enZhCorrect < 2) directions.push('en-zh'); if (p.zhEnCorrect < 2) directions.push('zh-en');
    const direction = directions[Math.floor(Math.random()*directions.length)];
    state.session.current={id,direction,options:direction==='en-zh'?makeOptions(wordById(id)):null,selected:[],answer:''}; state.session.lastWord=id; state.session.result=null; save(); return wordById(id);
  }
  function renderCheck() {
    const s=state.session; if (!s.current) { const w=newQuestion(); if (!w) return render(); }
    const q=s.current, w=wordById(q.id), p=progressFor(w.word), passed=s.ids.filter(id=>progressFor(id).passed).length;
    const selected = s.result ? (Array.isArray(s.result.answer) ? s.result.answer : []) : (q.selected || []);
    const content = q.direction==='en-zh'
      ? `<div class="question">${esc(w.word)}</div><p class="selection-count" id="selectionCount">已选择 ${selected.length} / 3</p><div class="choice-list">${q.options.map(id=>{const m=meaningById(id);return `<label class="choice"><input type="checkbox" name="meaningChoice" value="${esc(id)}" ${selected.includes(id)?'checked':''} ${s.result?'disabled':''}><span>${esc(displayMeaning(m))}</span></label>`;}).join('')}</div>`
      : `<div class="question-cn">${w.meanings.map(m=>`<span class="prompt-meaning">${esc(displayMeaning(m))}</span>`).join('；')}</div><input class="answer-input" id="answer0" autocomplete="off" placeholder="输入英文拼写" value="${esc(s.result ? q.answer : q.answer || '')}" ${s.result?'disabled':''}>`;
    const standard = q.direction==='en-zh' ? w.meanings.map(m=>displayMeaning(m)).join('；') : `${w.word}（${w.meanings.map(m=>displayMeaning(m)).join('；')}）`;
    const resultHTML=s.result?`<div class="feedback ${s.result.correct?'ok':'bad'}"><strong>${s.result.correct?'回答正确':'回答不正确'}</strong>${s.result.correct?'本方向正确次数已增加。':`本次${q.direction==='en-zh'?'英译中':'中译英'}正确次数已清零。`}<div class="correct-answer">标准答案：${esc(standard)}</div></div>`:'';
    app.innerHTML=`<section class="card check-card"><div class="progress-row"><span>检查环节 · ${passed} / ${s.ids.length} 个已过关</span><span>${statsText(p)}</span></div><div class="bar"><span style="width:${Math.round(passed/s.ids.length*100)}%"></span></div><p class="check-kind">${q.direction==='en-zh'?'英文 → 中文（选择全部正确释义）':'中文 → 英文'}</p>${content}${resultHTML}<div class="actions"><span></span>${s.result?'<button id="continue" class="primary">继续</button>':'<button id="submit" class="primary">提交答案</button>'}</div></section>`;
    if (s.result) {
      const continueButton = document.getElementById('continue');
      if (activeContinueHandler) document.removeEventListener('keydown', activeContinueHandler);
      let continued = false;
      const continueQuestion = () => {
        if (continued) return;
        continued = true;
        if (activeContinueHandler) document.removeEventListener('keydown', activeContinueHandler);
        activeContinueHandler = null;
        s.current=null; s.result=null; save(); render();
      };
      continueButton.addEventListener('click', continueQuestion);
      continueButton.focus();
      activeContinueHandler = function continueOnEnter(e) {
        if (!state.session?.result || e.key !== 'Enter' || e.isComposing) return;
        e.preventDefault();
        continueQuestion();
      };
      document.addEventListener('keydown', activeContinueHandler);
    }
    else if (q.direction==='en-zh') {
      app.querySelectorAll('input[name="meaningChoice"]').forEach(input=>input.addEventListener('change',e=>{const checked=app.querySelectorAll('input[name="meaningChoice"]:checked');if(checked.length>3){e.target.checked=false;return;}q.selected=[...checked].map(el=>el.value);save();document.getElementById('selectionCount').textContent=`已选择 ${checked.length} / 3`;}));
      document.getElementById('submit').addEventListener('click',submitAnswer);
    } else { const first=document.getElementById('answer0'); first.focus(); first.addEventListener('input',()=>{q.answer=first.value;save();}); document.getElementById('submit').addEventListener('click',submitAnswer); first.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing){e.preventDefault();submitAnswer();}}); }
  }
  function submitAnswer() {
    const s=state.session;if(s.result)return;const q=s.current,w=wordById(q.id);let correct,answer;
    if(q.direction==='en-zh'){answer=[...app.querySelectorAll('input[name="meaningChoice"]:checked')].map(el=>el.value);const expected=w.meanings.map(m=>m.id);correct=answer.length===expected.length&&answer.every(id=>expected.includes(id));q.selected=answer;}
    else {answer=document.getElementById('answer0').value;correct=answer.trim().toLowerCase()===w.word.toLowerCase();q.answer=answer;}
    const p=progressFor(w.word);if(q.direction==='en-zh')p.enZhCorrect=correct?Math.min(2,p.enZhCorrect+1):0;else p.zhEnCorrect=correct?Math.min(2,p.zhEnCorrect+1):0;
    if(p.enZhCorrect>=2&&p.zhEnCorrect>=2&&!p.passed){p.passed=true;s.doneToday++;state.todayCompleted++;state.completed[w.word]=true;}
    s.checked[w.word]=p;s.result={correct,direction:q.direction,answer};save();render();
  }
  function renderDayDone() {
    const batch=state.session.doneToday||state.session.ids.length;
    app.innerHTML=`<section class="card narrow completion"><div class="big">✓</div><p class="eyebrow">TODAY COMPLETE</p><h2>这一批单词都过关了</h2><p class="subtle">可以结束今天的学习，也可以继续追加一批。</p><div class="stats"><div class="stat"><strong>${batch}</strong><span>本批完成</span></div><div class="stat"><strong>${state.todayCompleted}</strong><span>今日累计完成</span></div><div class="stat"><strong>${completedCount()} / ${words.length}</strong><span>累计过关</span></div></div>${remainingWords().length?'<button id="addTask" class="primary">今天再设一个任务</button>':''}</section>`;
    if(remainingWords().length) document.getElementById('addTask').addEventListener('click',()=>renderSetup(true));
  }
  function renderAllDone(){app.innerHTML=`<section class="card narrow completion"><div class="big">🎉</div><p class="eyebrow">WORD LISTS 01-05</p><h2>当前词库已学完</h2><p class="subtle">这份词库中的 ${words.length} 个单词都已过关。</p></section>`;}
  function normalizeImported(data){if(!data||data.version!==5)throw new Error('旧版进度不兼容，请重新开始');return validateState(data);}
  document.getElementById('exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify({...state, vocabularyVersion:VOCABULARY_VERSION},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`ielts-vocab-progress-${todayKey()}.json`;a.click();URL.revokeObjectURL(url);});
  document.getElementById('importInput').addEventListener('change',async e=>{const file=e.target.files[0];if(!file)return;try{const data=normalizeImported(JSON.parse(await file.text()));if(!confirm('导入会覆盖当前浏览器中的全部进度，确定继续吗？'))return;state=data;ensureToday();save();render();}catch(error){alert(`无法导入：${error.message}`);}finally{e.target.value='';}});
  document.getElementById('clearBtn').addEventListener('click',()=>{
    if(!confirm('确定清除所有学习进度吗？已过关单词、当天任务和检查记录都会被删除。')) return;
    if(activeContinueHandler) document.removeEventListener('keydown', activeContinueHandler);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(`${STORAGE_KEY}-snapshot`);
    state=freshState();
    state.day=todayKey();
    save();
    render();
  });
  function checkDateBeforeAction(e){if(state.day!==todayKey()&&e.target.closest('#app')){e.preventDefault();e.stopImmediatePropagation();render();}}
  document.addEventListener('click',checkDateBeforeAction,true);document.addEventListener('keydown',checkDateBeforeAction,true);document.addEventListener('submit',checkDateBeforeAction,true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden) save(); else if(state.day!==todayKey()) render();});
  window.addEventListener('focus',()=>{if(state.day!==todayKey())render();});
  window.addEventListener('pagehide', save);
  window.addEventListener('beforeunload', save);
  render();
})();
