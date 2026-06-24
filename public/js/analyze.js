import { Chess } from '/js/lib/chess.min.js?v=1';

const $ = (id)=>document.getElementById(id);
const LSK='br_games';
const loadGames=()=>{ try{return JSON.parse(localStorage.getItem(LSK)||'[]');}catch{return[];} };

const PCIMG=code=>`<img class="pc" src="/assets/pieces2d/${code}.svg" alt="">`;
const VAL={p:1,n:3,b:3,r:5,q:9,k:0};

// Tracks current board view orientation. false = White on bottom, true = Black on bottom
let flipBoardOrientation = false;

// FEN -> 8x8 codes ('wP'), row0 = rank8 (top)
function fenToBoard(fen){
  const rows=fen.split(' ')[0].split('/'); const b=[];
  for(const row of rows){ const r=[]; for(const ch of row){ if(/\d/.test(ch)){ for(let i=0;i<+ch;i++) r.push(null); } else { const color=ch===ch.toUpperCase()?'w':'b'; r.push(color+ch.toUpperCase()); } } b.push(r); }
  return b;
}
function miniHTML(board){
  let h='';
  for(let r=0;r<8;r++)for(let c=0;c<8;c++){ const p=board[r][c]; const cell=(r+c)%2===0?'ml':'md'; const g=p?PCIMG(p):''; h+=`<i class="${cell}">${g}</i>`; }
  return h;
}

// Robust encoding/decoding helper that safely preserves UTF-8 characters across string compilation
function uint8ToBase64(uint8Arr) {
  let binString = '';
  for (let i = 0; i < uint8Arr.length; i++) { binString += String.fromCharCode(uint8Arr[i]); }
  return btoa(binString);
}
function base64ToUint8(base64Str) {
  const binString = atob(base64Str);
  const uint8Arr = new Uint8Array(binString.length);
  for (let i = 0; i < binString.length; i++) { uint8Arr[i] = binString.charCodeAt(i); }
  return uint8Arr;
}

// ── NEW HELPER FOR ENCODING/DECODING SHAREABLE LINKS ──
function getShareableUrl(gameData, analysisData) {
  const payload = {
    m: gameData.moves,
    meta: { w: gameData.white, b: gameData.black, r: gameData.result }
  };
  if (analysisData) {
    payload.a = {
      ev: analysisData.evals,
      bt: analysisData.bests,
      e2: analysisData.eval2s,
      cl: analysisData.classes
    };
  }
  const encoder = new TextEncoder();
  const encodedData = encoder.encode(JSON.stringify(payload));
  const base64Str = uint8ToBase64(encodedData);
  return `${window.location.origin}${window.location.pathname}?share=${encodeURIComponent(base64Str)}`;
}

// ── source picking ──
document.querySelectorAll('.az-tab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.az-tab').forEach(x=>x.classList.remove('active')); t.classList.add('active');
  $('tab-mine').style.display = t.dataset.tab==='mine'?'':'none';
  $('tab-chesscom').style.display = t.dataset.tab==='chesscom'?'':'none';
}));

function renderMine(){
  const games=loadGames(); const list=$('mine-list'); list.innerHTML='';
  $('mine-empty').style.display = games.length?'none':'';
  games.forEach((g, idx)=>{
    const board=g.finalBoard || fenToBoard(g.finalFen||'8/8/8/8/8/8/8/8 w - - 0 1');
    const d=new Date(g.date); const card=document.createElement('div'); card.className='game-card';
    
    const whiteName = g.white || 'White';
    const blackName = g.black || 'Black';
    
    // Stack structure: Mini board on top, descriptive details neatly mapped below
    card.innerHTML = `
      <div class="mini clickable-area">${miniHTML(board)}</div>
      <div class="gc-meta clickable-area">
        <div class="player-row">⚪ ${whiteName}</div>
        <div class="player-row">⚫ ${blackName}</div>
        <div class="game-date">${d.toLocaleDateString()}</div>
      </div>
      <div class="gc-actions">
        <button class="btn-action-del" title="Delete Game" data-idx="${idx}">🗑</button>
      </div>
    `;
    
    const clickHandler = () => {
      // Auto-orient layout to make sure your pieces are always on the bottom
      flipBoardOrientation = (g.myColor === 'b' || g.black === 'You');
      loadFromUci(g.moves, {white:g.white, black:g.black, result:g.result});
      window.history.replaceState(null, '', `?gid=${g.id}`);
    };
    
    card.querySelector('.mini').onclick = clickHandler;
    card.querySelector('.gc-meta').onclick = clickHandler;

    card.querySelector('.btn-action-del').onclick = (e) => {
      e.stopPropagation();
      if(confirm("Are you sure you want to remove this game from history?")) {
        const currentGames = loadGames();
        currentGames.splice(idx, 1);
        localStorage.setItem(LSK, JSON.stringify(currentGames));
        renderMine();
      }
    };
    list.appendChild(card);
  });
}

// ── chess.com import ──
(function fillMonths(){
  const sel=$('cc-month'); const now=new Date(); const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  for(let i=0;i<24;i++){ const d=new Date(now.getFullYear(), now.getMonth()-i, 1); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'); const o=document.createElement('option'); o.value=y+'/'+m; o.textContent=months[d.getMonth()]+' '+y; sel.appendChild(o); }
})();
$('cc-load').addEventListener('click', async ()=>{
  const user=$('cc-user').value.trim(); if(!user){ $('cc-msg').textContent='Enter a username.'; return; }
  const userLc=user.toLowerCase();
  const [y,m]=$('cc-month').value.split('/');
  $('cc-msg').textContent='Loading…'; $('cc-list').innerHTML='';
  try{
    const res=await fetch(`/api/chesscom/${encodeURIComponent(user)}/${y}/${m}`);
    if(!res.ok){ $('cc-msg').textContent = res.status===404?'No games found for that month (or unknown user).':'Could not load (error '+res.status+').'; return; }
    const data=await res.json(); const games=(data.games||[]).slice().reverse();
    if(!games.length){ $('cc-msg').textContent='No games that month.'; return; }
    $('cc-msg').textContent=games.length+' games — click one to analyze.';
    const DRAWN=['agreed','stalemate','repetition','insufficient','50move','timevsinsufficient'];
    games.forEach(g=>{
      const board=fenToBoard(g.fen||'8/8/8/8/8/8/8/8 w - - 0 1');
      const card=document.createElement('div'); card.className='game-card';
      const w=g.white||{}, b=g.black||{};
      const mine = (w.username||'').toLowerCase()===userLc ? w
                 : (b.username||'').toLowerCase()===userLc ? b : null;
      let outcome=null, res;
      if(mine){
        outcome = mine.result==='win' ? 'win' : DRAWN.includes(mine.result) ? 'draw' : 'loss';
        res = outcome==='win'?'Won':outcome==='loss'?'Lost':'Draw';
      } else {
        res = w.result==='win'?'1–0': b.result==='win'?'0–1':'½–½';
      }
      const cls = outcome==='win'?'r-win':outcome==='loss'?'r-loss':'r-draw';
      if(outcome) card.classList.add(outcome);
      card.innerHTML=`<div class="mini">${miniHTML(board)}</div>
        <div class="gc-meta"><span class="gc-res ${cls}">${res}</span> · ${g.time_class||''}<br>${(w.username||'?')} (${w.rating||'?'})<br>${(b.username||'?')} (${b.rating||'?'})</div>`;
      
      card.onclick=()=>{
        // Auto flip if player was handling the black pieces
        flipBoardOrientation = ((b.username||'').toLowerCase() === userLc);
        loadFromPgn(g.pgn, {white:w.username, black:b.username, result:res});
      };
      $('cc-list').appendChild(card);
    });
  }catch(e){ $('cc-msg').textContent='Network error.'; }
});

// ── build CURRENT game ──
let CURRENT=null; // {fens, ucis, sans, meta}
function loadFromUci(ucis, meta){
  const c=new Chess(); const fens=[c.fen()], sans=[], clean=[];
  for(const u of (ucis||[])){
    const from=u.slice(0,2), to=u.slice(2,4); let promo=u[4];
    const pc=c.get(from); if(pc&&pc.type==='p'&&(to[1]==='8'||to[1]==='1')) promo=promo||'q';
    const mv=c.move({from,to,promotion:promo}); if(!mv) break;
    clean.push(from+to+(mv.promotion||'')); sans.push(mv.san); fens.push(c.fen());
  }
  CURRENT={fens, ucis:clean, sans, meta:meta||{}}; enterAnalyzer();
}
function loadFromPgn(pgn, meta){
  const c=new Chess(); let ok=false;
  try{ ok=c.load_pgn(pgn,{sloppy:true}); }catch(e){ ok=false; }
  if(!ok){ alert('Could not parse this game.'); return; }
  const verbose=c.history({verbose:true});
  const fens=[c.fen()], sans=[], ucis=[];
  // Use a second fresh chess instance to re-verify game step records cleanly
  const c2=new Chess();
  for(const m of verbose){ const mv=c2.move({from:m.from,to:m.to,promotion:m.promotion}); ucis.push(m.from+m.to+(mv.promotion||'')); sans.push(mv.san); fens.push(c2.fen()); }
  CURRENT={fens, ucis, sans, meta:meta||{}}; enterAnalyzer();
}

// ── analyzer view ──
let ply=0, analysis=null;
function enterAnalyzer(){
  $('picker').style.display='none'; $('analyzer').style.display='';
  analysis=null; ply=0;
  
  // Attach Player Badges (⚪ / ⚫) right next to profile tags
  $('pl-white').innerHTML = `⚪ ${CURRENT.meta.white||'White'}`;
  $('pl-black').innerHTML = `⚫ ${CURRENT.meta.black||'Black'}`;
  
  $('acc-white').textContent='—'; $('acc-black').textContent='—';
  $('summary').classList.add('hidden'); $('graph').innerHTML=''; $('moveinfo').textContent='';
  renderMoveList(); renderBoard(); drawEvalBar(null);
  updateShareButtonVisibility();
}
$('az-toGames').addEventListener('click',()=>{ if(engine) engine.stop(); $('analyzer').style.display='none'; $('picker').style.display=''; renderMine(); });

function lastMoveOf(p){ if(p<=0) return null; const u=CURRENT.ucis[p-1]; return u?{from:u.slice(0,2),to:u.slice(2,4)}:null; }

// ── FIXED PERSPECTIVE-AWARE BOARD RENDERING ──
function renderBoard(){
  const board=fenToBoard(CURRENT.fens[ply]); const lm=lastMoveOf(ply); const el=$('board'); el.innerHTML='';
  
  for(let r=0; r<8; r++){
    for(let c=0; c<8; c++){
      // Map view grid indices symmetrically depending on board rotation state
      const actualRow = flipBoardOrientation ? 7 - r : r;
      const actualCol = flipBoardOrientation ? 7 - c : c;

      const fileChar = String.fromCharCode(97 + actualCol);
      const rankNum = 8 - actualRow;
      const sqName = fileChar + rankNum;
      const p = board[actualRow][actualCol];

      const d = document.createElement('div');
      d.className = 'sq ' + ((actualRow + actualCol) % 2 === 0 ? 'l' : 'd');
      
      if(lm && (sqName === lm.from || sqName === lm.to)) d.className += ' hl';
      if(p) d.innerHTML = PCIMG(p);
      
      // Pin rank numbers (1-8) along the far left vertical border column
      if(c === 0){
        const lbl = document.createElement('span'); lbl.className = 'coord-rank';
        lbl.textContent = rankNum; d.appendChild(lbl);
      }
      // Pin file letters (a-h) along the bottom horizontal border row
      if(r === 7){
        const lbl = document.createElement('span'); lbl.className = 'coord-file';
        lbl.textContent = fileChar; d.appendChild(lbl);
      }

      if(lm && sqName === lm.to && analysis && analysis.classes[ply-1]){ 
        const cl = analysis.classes[ply-1]; 
        d.innerHTML += `<i class="badge b-${cl}">${ICON[cl]||''}</i>`; 
      }
      el.appendChild(d);
    }
  }
}

// ── ROTATE BOARD BUTTON ACTION INTERACTION SETUP ──
// (function setupFlipControl() {
//   let flipBtn = $('btn-flip-board');
//   if(!flipBtn) {
//     flipBtn = document.createElement('button');
//     flipBtn.id = 'btn-flip-board';
//     flipBtn.className = 'btn-secondary';
//     flipBtn.innerHTML = '🔄 Flip Board';
//     flipBtn.style.marginBottom = '12px';
//     flipBtn.style.width = '100%';
//     // Insert directly above structural navigation layout templates
//     const boardArea = document.querySelector('.board-wrap');
//     if(boardArea) boardArea.parentNode.insertBefore(flipBtn, boardArea.nextSibling);
//   }
//   flipBtn.onclick = () => { flipBoardOrientation = !flipBoardOrientation; renderBoard(); };
// })();

const ICON={brilliant:'!!',great:'!',best:'★',excellent:'',good:'',book:'B',inaccuracy:'?!',mistake:'?',blunder:'??'};
function renderMoveList(){
  const ml=$('movelist'); ml.innerHTML='';
  for(let i=0;i<CURRENT.sans.length;i++){
    const num=(i%2===0)?(`${i/2+1}. `):''; const span=document.createElement('span');
    span.className='mv'+(i+1===ply?' cur':''); span.dataset.ply=i+1;
    const cl=analysis?analysis.classes[i]:null;
    span.innerHTML=`${num}${CURRENT.sans[i]}${cl&&ICON[cl]?`<b class="ico c-${cl}">${ICON[cl]}</b>`:''}`;
    span.onclick=()=>{ ply=i+1; refresh(); };
    ml.appendChild(span);
  }
}
function drawEvalBar(cpWhite){
  const fill=$('evalfill'), num=$('evalnum');
  if(cpWhite==null){ fill.style.height='50%'; num.textContent=''; return; }
  const clamped=Math.max(-1000,Math.min(1000,cpWhite));
  const pct=100/(1+Math.exp(-0.004*clamped)); fill.style.height=pct+'%';
  num.textContent=(cpWhite/100).toFixed(1);
}
function refresh(){
  renderBoard();
  document.querySelectorAll('.mv').forEach(m=>m.classList.toggle('cur', +m.dataset.ply===ply));
  const cur=document.querySelector('.mv.cur'); if(cur) cur.scrollIntoView({block:'nearest'});
  if(analysis){ drawEvalBar(analysis.whiteCp[ply]); showMoveInfo(); } else drawEvalBar(null);
}
function showMoveInfo(){
  if(ply<=0){ $('moveinfo').textContent='Starting position.'; return; }
  const cl = analysis.classes[ply-1];
  const names = { brilliant:'Brilliant!!', great:'Great move!', best:'Best move',
    excellent:'Excellent', good:'Good', book:'Book move',
    inaccuracy:'Inaccuracy', mistake:'Mistake', blunder:'Blunder' };
  const movedSan = CURRENT.sans[ply-1];
  const bestSan  = analysis.bestSans[ply-1];
  const isBest   = !bestSan || bestSan === movedSan;

  let suggestion = '';
  if (!isBest && (cl === 'inaccuracy' || cl === 'mistake' || cl === 'blunder')) {
    suggestion = ` · <span style="color:var(--muted)">Best was <b style="color:var(--ivory)">${bestSan}</b></span>`;
  } else if (cl === 'brilliant' || cl === 'great') {
    suggestion = ` · <span style="color:var(--muted)">Engine's top choice too</span>`;
  }

  // centipawn loss
  const mover = (ply-1)%2===0 ? 'w' : 'b';
  const winBefore = winPct(analysis.evals[ply-1].cp);
  const winAfter  = winPct(-analysis.evals[ply].cp);
  const loss = Math.max(0, winBefore - winAfter);
  const lossNote = loss >= 1 ? ` <span style="color:var(--muted);font-size:.7rem">(−${loss.toFixed(1)}% win chance)</span>` : '';

  $('moveinfo').innerHTML =
    `<span class="c-${cl}">${movedSan} — ${names[cl]||cl}</span>${lossNote}${suggestion}`;
}
// On mobile, clicking nav buttons shifts browser focus and triggers an unwanted
// scroll-to-element. Blur the button immediately and pin the board in view instead.
function navAction(btn, fn) {
  btn.addEventListener('click', e => {
    fn();
    // Blur so mobile Safari doesn't scroll to the focused button
    e.currentTarget.blur();
    // On narrow screens keep the board visible, not the button bar
    if (window.innerWidth <= 760) {
      const boardEl = $('board');
      if (boardEl) boardEl.scrollIntoView({ block: 'nearest', behavior: 'instant' });
    }
  });
}
navAction($('nFirst'), () => { ply = 0; refresh(); });
navAction($('nPrev'),  () => { if (ply > 0) { ply--; refresh(); } });
navAction($('nNext'),  () => { if (ply < CURRENT.sans.length) { ply++; refresh(); } });
navAction($('nLast'),  () => { ply = CURRENT.sans.length; refresh(); });
document.addEventListener('keydown',e=>{ if($('analyzer').style.display==='none')return; if(e.key==='ArrowLeft')$('nPrev').click(); if(e.key==='ArrowRight')$('nNext').click(); });

// ── engine ──
let engine=null;
class Engine{
  constructor(){ this.w=new Worker('/engine/stockfish16.js'); this.cur=null; this.q=[]; this.info=[]; this._readyRes=null;
    this.readyP=new Promise(r=>this._readyRes=r);
    this.w.onmessage=e=>this._msg(typeof e.data==='string'?e.data:(e.data&&e.data.data)||'');
    this.send('uci'); this.send('setoption name MultiPV value 2'); this.send('isready');
  }
  send(c){ this.w.postMessage(c); }
  _msg(line){
    if(line==='readyok'||line==='uciok'){ if(this._readyRes){this._readyRes();this._readyRes=null;} return; }
    if(!this.cur) return;
    if(line.indexOf('info')===0 && line.indexOf(' score ')>-1 && line.indexOf(' pv ')>-1) this.info.push(line);
    else if(line.indexOf('bestmove')===0){ const bm=line.split(' ')[1]; const r=parseInfo(this.info,bm); const d=this.cur; this.cur=null; this.info=[]; d.resolve(r); this._next(); }
  }
  evaluate(fen, depth) {
    return new Promise(res => {
      const job = { fen, depth, resolve: res, done: false };
      job.timer = setTimeout(() => {
        if (!job.done) {
          job.done = true;
          res({ bestmove: null, best: null, eval: { cp: 0, mate: null }, eval2: null });
          this.cur = null;
          this._next();
        }
      }, 8000);
      job.resolve = (r) => {
        if (job.done) return;
        job.done = true;
        clearTimeout(job.timer);
        res(r);
      };
      this.q.push(job); this._next();
    });
  }
  _next(){ if(this.cur||!this.q.length)return; this.cur=this.q.shift(); this.info=[]; this.send('position fen '+this.cur.fen); this.send('go depth '+this.cur.depth); }
  stop(){ try{this.send('stop'); this.w.terminate();}catch(e){} engine=null; }
}
function uciToSan(fen, uci) {
  if (!uci || uci === '(none)') return null;
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: uci.slice(0,2), to: uci.slice(2,4), promotion: uci[4] || 'q' });
    return mv ? mv.san : null;
  } catch { return null; }
}
function parseInfo(infos,bestmove){
  const byPv={}; for(const l of infos){ const m=/ multipv (\d+)/.exec(l); byPv[m?+m[1]:1]=l; }
  const ev=l=>{ if(!l)return null; const mt=/ score mate (-?\d+)/.exec(l); if(mt){const m=+mt[1]; return {mate:m, cp:m>0?100000-m*100:-100000-m*100};} const cp=/ score cp (-?\d+)/.exec(l); return {cp:cp?+cp[1]:0,mate:null}; };
  const mv=l=>{ const m=/ pv (\S+)/.exec(l); return m?m[1]:null; };
  return { bestmove, best:mv(byPv[1])||bestmove, eval:ev(byPv[1])||{cp:0,mate:null}, eval2:byPv[2]?ev(byPv[2]):null };
}

const winPct=cp=>100/(1+Math.exp(-0.00368208*Math.max(-1500,Math.min(1500,cp))));
const accFromLoss=loss=>Math.max(0,Math.min(100,103.1668*Math.exp(-0.04354*loss)-3.1669));
function hangsSacrifice(fenAfter){
  try{
    const c=new Chess(fenAfter); const caps=c.moves({verbose:true}).filter(m=>m.captured);
    for(const m of caps){ if(VAL[m.captured]>=3){ const c2=new Chess(fenAfter); c2.move({from:m.from,to:m.to,promotion:'q'}); const re=c2.moves({verbose:true}).filter(x=>x.to===m.to&&x.captured); const minRe=re.length?Math.min(...re.map(x=>VAL[x.captured])):Infinity; if(!re.length||minRe<VAL[m.captured]) return true; } }
  }catch(e){}
  return false;
}
const sameMove=(a,b)=> a&&b&&a.slice(0,4)===b.slice(0,4);

$('run').addEventListener('click', runAnalysis);
async function runAnalysis(){
  if(engine) engine.stop();
  const depth=+$('depth').value||13; const fens=CURRENT.fens, ucis=CURRENT.ucis;
  engine=new Engine(); await engine.readyP;
  $('progress').classList.remove('hidden'); $('run').disabled=true;
  const evals=[], bests=[], eval2s=[], bestSans=[];
  for(let i=0;i<fens.length;i++){
    const probe = new Chess(fens[i]);
    if (probe.game_over()) {
      evals.push({ cp: probe.in_checkmate() ? (probe.turn()==='w' ? -100000 : 100000) : 0, mate:null });
      bests.push(null); eval2s.push(null);
      const pc=Math.round((i+1)/fens.length*100); $('progbar').style.width=pc+'%'; $('progtxt').textContent=`Analyzing ${i+1}/${fens.length}`;
      continue;
    }
    const r=await engine.evaluate(fens[i],depth);
    evals.push(r.eval); bests.push(r.best); eval2s.push(r.eval2);
    bestSans.push(uciToSan(fens[i], r.best));
    const pc=Math.round((i+1)/fens.length*100); $('progbar').style.width=pc+'%'; $('progtxt').textContent=`Analyzing ${i+1}/${fens.length}`;
  }
  engine.stop();
  
  const sideAt=f=>f.split(' ')[1];
  const classes=[], whiteCp=[], lossW=[], lossB=[];
  for(let i=0;i<fens.length;i++){ const cp=evals[i].cp; whiteCp.push(sideAt(fens[i])==='w'?cp:-cp); }
  const bookPlies=Math.min(6, ucis.length);
  for(let i=0;i<ucis.length;i++){
    const mover=sideAt(fens[i]);
    const winBefore=winPct(evals[i].cp);
    const winAfterMover=winPct(-evals[i+1].cp);
    const loss=Math.max(0,winBefore-winAfterMover);
    (mover==='w'?lossW:lossB).push(loss);
    const isBest=sameMove(ucis[i],bests[i]);
    const gap = eval2s[i] ? (winPct(evals[i].cp)-winPct(eval2s[i].cp)) : 99;
    let cl;
    if(i<bookPlies && loss<3) cl='book';
    else if(isBest && winBefore<97 && winAfterMover>=45 && hangsSacrifice(fens[i+1])) cl='brilliant';
    else if(isBest && gap>=12 && loss<3) cl='great';
    else if(loss>=20) cl='blunder';
    else if(loss>=10) cl='mistake';
    else if(loss>=5) cl='inaccuracy';
    else if(loss>=2) cl='good';
    else cl=isBest?'best':'excellent';
    classes.push(cl);
  }
  const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
  const accW=Math.round(accFromLoss(avg(lossW))*10)/10;
  const accB=Math.round(accFromLoss(avg(lossB))*10)/10;
  analysis = { evals, bests, bestSans, eval2s, classes, whiteCp, accW, accB };
  $('acc-white').textContent=accW+'%'; $('acc-black').textContent=accB+'%';
  $('progress').classList.add('hidden'); $('run').disabled=false;
  renderSummary(classes); drawGraph(whiteCp); renderMoveList(); refresh();
  updateShareButtonVisibility();
}

function renderSummary(classes){
  const order=['brilliant','great','best','excellent','good','book','inaccuracy','mistake','blunder'];
  const names={brilliant:'!! ',great:'! ',best:'Best',excellent:'Good',good:'Good',book:'Book',inaccuracy:'Inacc',mistake:'Mistake',blunder:'Blunder'};
  const cnt={}; classes.forEach((c,i)=>{ const side=i%2===0?'w':'b'; cnt[c]=cnt[c]||{w:0,b:0}; cnt[c][side]++; });
  const s=$('summary'); s.classList.remove('hidden'); s.innerHTML='';
  for(const k of order){ if(!cnt[k])continue; const chip=document.createElement('span'); chip.className='chip'; chip.innerHTML=`<b class="c-${k}">${ICON[k]||names[k]}</b> W:${cnt[k].w} B:${cnt[k].b}`; s.appendChild(chip); }
}

function drawGraph(whiteCp){
  const svg=$('graph'); const W=300,H=90,mid=H/2; svg.innerHTML='';
  const x=i=>whiteCp.length>1? i/(whiteCp.length-1)*W : 0;
  const y=cp=>{ const v=Math.max(-800,Math.min(800,cp)); return mid - (v/800)*(mid-4); };
  svg.innerHTML+=`<rect x="0" y="0" width="${W}" height="${mid}" fill="rgba(255,255,255,0.05)"/><line x1="0" y1="${mid}" x2="${W}" y2="${mid}" stroke="rgba(201,168,76,.4)" stroke-width="0.5"/>`;
  let pts=whiteCp.map((cp,i)=>`${x(i).toFixed(1)},${y(cp).toFixed(1)}`).join(' ');
  let area=`0,${mid} `+pts+` ${W},${mid}`;
  svg.innerHTML+=`<polygon points="${area}" fill="rgba(201,168,76,0.22)"/><polyline points="${pts}" fill="none" stroke="#c9a84c" stroke-width="1.2"/>`;
}

function updateShareButtonVisibility() {
  const container = document.querySelector('.az-controls');
  if (!container) return;

  // 1. Create Row 2 button group layout if it doesn't exist yet
  let row2 = $('btn-row-2');
  if (!row2) {
    row2 = document.createElement('div');
    row2 = document.createElement('div');
    row2.id = 'btn-row-2';
    row2.className = 'az-control-row-group';
    container.appendChild(row2);
  }

  // 2. Render or update the Share Button
  let shareBtn = $('btn-share-link');
  if(!shareBtn) {
    shareBtn = document.createElement('button');
    shareBtn.id = 'btn-share-link';
    shareBtn.className = 'btn-secondary flex-btn';
    row2.appendChild(shareBtn);
  }
  shareBtn.textContent = analysis ? '🔗 Copy Link' : '🔗 Copy Link';
  shareBtn.onclick = () => {
    const gameRecord = { moves: CURRENT.ucis, white: CURRENT.meta.white, black: CURRENT.meta.black, result: CURRENT.meta.result };
    const url = getShareableUrl(gameRecord, analysis);
    navigator.clipboard.writeText(url).then(() => {
      const oldText = shareBtn.textContent; shareBtn.textContent = '✅ Copied!';
      setTimeout(() => shareBtn.textContent = oldText, 2000);
    });
  };

  // 3. Move or render the Flip Board Button right beside it
  let flipBtn = $('btn-flip-board');
  if(!flipBtn) {
    flipBtn = document.createElement('button');
    flipBtn.id = 'btn-flip-board';
    flipBtn.className = 'btn-secondary flex-btn';
    flipBtn.innerHTML = '🔄 Flip Board';
    row2.appendChild(flipBtn);
  }
  flipBtn.onclick = () => { 
    flipBoardOrientation = !flipBoardOrientation; 
    renderBoard(); 
  };
}

// ── ENTRY INITIALIZATION ENGINE BOOTSTRAP ──
(function init(){
  renderMine();
  const q=new URLSearchParams(location.search);
  const shareData = q.get('share');

  if(shareData) {
    try {
      const uint8Bytes = base64ToUint8(decodeURIComponent(shareData));
      const decoder = new TextDecoder();
      const decoded = JSON.parse(decoder.decode(uint8Bytes));
      
      loadFromUci(decoded.m, { white: decoded.meta.w, black: decoded.meta.b, result: decoded.meta.r });
      
      if(decoded.a) {
        const evals = decoded.a.ev, bests = decoded.a.bt, eval2s = decoded.a.e2, classes = decoded.a.cl;
        const sideAt=f=>f.split(' ')[1];
        const whiteCp = [];
        for(let i=0; i<CURRENT.fens.length; i++) { 
          const cp = evals[i].cp; 
          whiteCp.push(sideAt(CURRENT.fens[i])==='w' ? cp : -cp); 
        }
        
        const lossW=[], lossB=[];
        for(let i=0; i<CURRENT.ucis.length; i++) {
          const mover = sideAt(CURRENT.fens[i]);
          const loss = Math.max(0, (100/(1+Math.exp(-0.00368208*Math.max(-1500,Math.min(1500,evals[i].cp))))) - (100/(1+Math.exp(-0.00368208*Math.max(-1500,Math.min(1500,-evals[i+1].cp))))));
          (mover==='w'?lossW:lossB).push(loss);
        }
        const avg=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:0;
        const accW=Math.round(accFromLoss(avg(lossW))*10)/10;
        const accB=Math.round(accFromLoss(avg(lossB))*10)/10;

        analysis = { evals, bests, eval2s, classes, whiteCp, accW, accB };
        $('acc-white').textContent=accW+'%'; $('acc-black').textContent=accB+'%';
        renderSummary(classes); drawGraph(whiteCp); renderMoveList(); refresh();
        updateShareButtonVisibility();
      }
    } catch(e) {
      console.error("Failed to parse shared analytical context:", e);
    }
  }
  else if(q.get('source')==='last'){ const g=loadGames()[0]; if(g) { flipBoardOrientation=(g.myColor==='b'); loadFromUci(g.moves,{white:g.white,black:g.black,result:g.result}); } }
  else if(q.get('gid')){ const g=loadGames().find(x=>x.id===q.get('gid')); if(g) { flipBoardOrientation=(g.myColor==='b'); loadFromUci(g.moves,{white:g.white,black:g.black,result:g.result}); } }
})();
