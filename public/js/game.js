// ═══════════════════════════════════════════════════════════
//  THE BOARD ROOM — game.js v5  (Three.js r128 + GLTF + Socket.IO)
// ═══════════════════════════════════════════════════════════
console.log('game.js v6');
let moveHistory = [];
const sqName = (r, c) => String.fromCharCode(97 + c) + (8 - r);
const LSK = 'br_games';
function saveGameRecord(rec) { try { const a = JSON.parse(localStorage.getItem(LSK) || '[]'); a.unshift(rec); localStorage.setItem(LSK, JSON.stringify(a.slice(0, 40))); } catch (e) { } }
function persistGame(result, winner) { if (!moveHistory.length || !boardData) return; saveGameRecord({ id: Date.now() + '-' + Math.random().toString(36).slice(2, 7), date: new Date().toISOString(), source: 'site', myColor, result, winner: winner === undefined ? null : winner, white: myColor === 'w' ? 'You' : 'Opponent', black: myColor === 'b' ? 'You' : 'Opponent', moves: moveHistory.slice(), finalBoard: boardData }); }
const socket = io();

let myColor = null, currentTurn = 'w', boardData = null;
let legalMap = {}, selected = null, lastMove = null;
let gameActive = false, sceneReady = false, slamActive = false, gameOver = false;
let slamsLeft = { w: 5, b: 5 }, checkSquare = null, chosenSide = 'white';

const $ = (id) => document.getElementById(id);
const turnIndicator = $('turn-indicator'), statusMsg = $('status-msg');
const btnReset = $('btn-reset'), waitBanner = $('wait-banner'), displayCode = $('display-code');
const gameoverOverlay = $('gameover-overlay'), goTitle = $('go-title'), goSub = $('go-sub'), btnRematch = $('btn-rematch');
const confirmOverlay = $('confirm-overlay'), cfTitle = $('cf-title'), cfSub = $('cf-sub'), cfYes = $('cf-yes'), cfNo = $('cf-no');
const toastEl = $('toast'), checkFlash = $('check-flash');
const btnSlam = $('btn-slam'), slamCountEl = $('slam-count'), gameControls = $('game-controls');
const trayTop = $('tray-top'), trayBottom = $('tray-bottom');

const TITLE = 'The Board Room';
function setTitle(t) { document.title = t ? (t + ' · ' + TITLE) : TITLE; }
function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active')); const el = $(id); if (el) el.classList.add('active'); if (id === 'screen-lobby') setTitle(''); }
function toast(m, ms = 1900) { toastEl.textContent = m; toastEl.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => toastEl.classList.add('hidden'), ms); }

// confirm modal with yes/no handlers
let cfYesH = null, cfNoH = null;
function askConfirm(title, sub, onYes, yes = 'Yes', no = 'No', onNo = null) {
  cfTitle.textContent = title; cfSub.textContent = sub; cfYes.textContent = yes; cfNo.textContent = no;
  cfYesH = onYes; cfNoH = onNo; confirmOverlay.classList.remove('hidden');
}
cfYes.onclick = () => { confirmOverlay.classList.add('hidden'); const h = cfYesH; cfYesH = cfNoH = null; if (h) h(); };
cfNo.onclick = () => { confirmOverlay.classList.add('hidden'); const h = cfNoH; cfYesH = cfNoH = null; if (h) h(); };

// ── Lobby ──
document.querySelectorAll('.side-btn').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.side-btn').forEach(x => x.classList.remove('active')); b.classList.add('active'); chosenSide = b.dataset.side;
}));
$('btn-create').addEventListener('click', () => socket.emit('create_room', { side: chosenSide }));
$('btn-join').addEventListener('click', () => { const code = $('input-code').value.trim().toUpperCase(); if (code.length < 4) { $('lobby-msg').textContent = 'Enter a valid room code.'; return; } socket.emit('join_room', { code }); });
$('btn-copy').addEventListener('click', () => { const url = `${location.origin}?join=${displayCode.textContent}`; navigator.clipboard.writeText(url).then(() => { $('btn-copy').textContent = 'Copied!'; setTimeout(() => $('btn-copy').textContent = 'Copy invite link', 1500); }); });
const urlJoin = new URLSearchParams(location.search).get('join'); if (urlJoin) $('input-code').value = urlJoin;

btnReset.addEventListener('click', () => socket.emit('reset_board'));
btnRematch.addEventListener('click', () => { socket.emit('request_rematch'); btnRematch.disabled = true; btnRematch.textContent = 'Waiting…'; toast('Rematch requested'); });
$('btn-back').addEventListener('click', () => { socket.emit('leave_room'); gameoverOverlay.classList.add('hidden'); gameActive = false; sceneReady = false; showScreen('screen-lobby'); });
$('btn-analyze').addEventListener('click', () => { location.href = '/analyze.html?source=last'; });
$('btn-surrender').addEventListener('click', () => { if (!gameActive) return; askConfirm('Resign?', 'You will lose this game.', () => socket.emit('surrender'), 'Resign', 'Cancel'); });
$('btn-draw').addEventListener('click', () => { if (!gameActive) return; socket.emit('offer_draw'); toast('Draw offered to opponent'); });
$('btn-takeback').addEventListener('click', () => { if (!gameActive || !moveHistory.length) return; socket.emit('request_takeback'); toast('Takeback requested'); });

// ── Socket ──
socket.on('room_created', ({ code, color }) => { myColor = color; displayCode.textContent = code; showScreen('screen-game'); setTitle('Waiting…'); buildScene(); waitBanner.classList.remove('hidden'); setOpponentVisible(false); });
socket.on('join_error', ({ msg }) => { $('lobby-msg').textContent = msg; });
socket.on('join_success', ({ color }) => { myColor = color; showScreen('screen-game'); setTitle('Waiting…'); buildScene(); setOpponentVisible(true); waitBanner.classList.add('hidden'); });
socket.on('opponent_entered', () => { waitBanner.classList.add('hidden'); animateOpponentSit(); });

socket.on('game_start', ({ color, board, turn, legalMoves, slams }) => {
  myColor = color; boardData = board; currentTurn = turn; legalMap = legalMoves || {};
  slamsLeft = slams || { w: 5, b: 5 }; gameActive = true; gameOver = false; slamActive = false; checkSquare = null; selected = null; lastMove = null; moveHistory = [];
  gameoverOverlay.classList.add('hidden'); confirmOverlay.classList.add('hidden'); waitBanner.classList.add('hidden');
  btnReset.classList.add('hidden'); statusMsg.textContent = ''; gameControls.classList.remove('hidden');
  btnRematch.disabled = false; btnRematch.textContent = 'Rematch'; btnRematch.style.display = '';
  trayTop.classList.remove('hidden'); trayBottom.classList.remove('hidden');
  if (!sceneReady) buildScene();
  positionCamera(true); setOpponentVisible(true); rebuildPieces(); refreshTiles(); showHints(); renderTrays(); updateHUD();
});

socket.on('board_update', ({ board, turn, legalMoves, check, from, to }) => {
  if (from && to && boardData) { const moved = boardData[from.r][from.c]; let uci = sqName(from.r, from.c) + sqName(to.r, to.c); if (moved && moved[1] === 'P' && (to.r === 0 || to.r === 7)) uci += 'q'; moveHistory.push(uci); }
  boardData = board; currentTurn = turn; legalMap = legalMoves || {}; selected = null;
  if (from && to) lastMove = { from, to };
  checkSquare = check ? findKingSquare(currentTurn) : null;
  rebuildPieces(); refreshTiles(); showHints(); renderTrays(); updateHUD();
  statusMsg.textContent = check ? 'Check!' : '';
  if (check && currentTurn === myColor) flashCheck();
});

socket.on('game_over', ({ result, winner }) => {
  gameActive = false; gameOver = true; gameControls.classList.add('hidden'); btnSlam.disabled = true; checkSquare = null; refreshTiles();
  persistGame(result, winner);
  btnRematch.style.display = '';
  let title, sub, tab;
  if (result === 'stalemate') { title = 'Stalemate'; sub = 'A draw.'; tab = 'Stalemate'; }
  else if (result === 'draw') { title = 'Draw'; sub = 'Agreed.'; tab = 'Draw'; }
  else if (result === 'surrender') { const w = winner === myColor; title = w ? 'You win' : 'You resigned'; sub = w ? 'Opponent resigned.' : 'Better luck next time.'; tab = w ? 'You win' : 'Resigned'; }
  else { const w = winner === myColor; title = 'Checkmate'; sub = w ? 'You win.' : 'You lost.'; tab = w ? 'Checkmate — you win' : 'Checkmate — you lost'; }
  turnIndicator.textContent = (winner == null) ? 'Draw' : (winner === myColor ? 'Victory' : 'Defeat');
  setTitle(tab);
  const show = () => { goTitle.textContent = title; goSub.textContent = sub; gameoverOverlay.classList.remove('hidden'); };
  if (result === 'checkmate' && winner) { topple(winner === 'w' ? 'b' : 'w', show); } else setTimeout(show, 500);
});

socket.on('board_slammed', ({ slams }) => { if (slams) slamsLeft = slams; doSlam(); btnReset.classList.remove('hidden'); updateHUD(); });
socket.on('board_reset', ({ board, turn, legalMoves, slams }) => { slamActive = false; boardData = board; currentTurn = turn; legalMap = legalMoves || {}; if (slams) slamsLeft = slams; btnReset.classList.add('hidden'); rebuildPieces(); refreshTiles(); showHints(); renderTrays(); updateHUD(); });

socket.on('draw_offered', () => askConfirm('Draw offer', 'Your opponent offers a draw.', () => socket.emit('accept_draw'), 'Accept', 'Decline', () => socket.emit('decline_draw')));
socket.on('draw_declined', () => toast('Draw declined'));
socket.on('takeback_offered', () => askConfirm('Takeback?', 'Your opponent wants to take back a move.', () => socket.emit('accept_takeback'), 'Accept', 'Decline', () => socket.emit('decline_takeback')));
socket.on('takeback_declined', () => toast('Takeback declined'));
socket.on('takeback_done', ({ board, turn, legalMoves, lastMove: lm, undone }) => {
  if (undone > 0) moveHistory.splice(Math.max(0, moveHistory.length - undone), undone);
  boardData = board; currentTurn = turn; legalMap = legalMoves || {}; selected = null; checkSquare = null; lastMove = lm || null;
  rebuildPieces(); refreshTiles(); showHints(); renderTrays(); updateHUD(); toast('Takeback applied');
});
socket.on('rematch_offered', () => askConfirm('Rematch?', 'Your opponent wants a rematch.', () => socket.emit('accept_rematch'), 'Accept', 'Decline', () => socket.emit('decline_rematch')));
socket.on('rematch_declined', () => { toast('Rematch declined'); btnRematch.disabled = false; btnRematch.textContent = 'Rematch'; btnRematch.style.display = ''; });
socket.on('opponent_left', () => { statusMsg.textContent = 'Opponent left.'; gameActive = false; gameOver = true; gameControls.classList.add('hidden'); btnSlam.disabled = true; setTitle('Opponent left'); persistGame('abandoned', null); goTitle.textContent = 'Opponent left'; goSub.textContent = 'They disconnected from the game.'; btnRematch.style.display = 'none'; gameoverOverlay.classList.remove('hidden'); });

// ── Slam ──
function trySlam() { if (gameActive && !slamActive && currentTurn === myColor && slamsLeft[myColor] > 0) socket.emit('slam_board'); }
window.addEventListener('keydown', e => { if (e.key === 'f' || e.key === 'F') trySlam(); });
btnSlam.addEventListener('click', trySlam);

function updateHUD() {
  const myTurn = currentTurn === myColor;
  turnIndicator.textContent = !gameActive ? 'Waiting…' : (myTurn ? 'Your turn' : 'Opponent thinking…');
  turnIndicator.style.borderColor = myTurn ? '#c9a84c' : '#5a5040';
  turnIndicator.style.color = myTurn ? '#c9a84c' : '#5a5040';
  const left = (slamsLeft[myColor] != null) ? slamsLeft[myColor] : 5;
  slamCountEl.textContent = left;
  btnSlam.disabled = !(gameActive && myTurn && left > 0 && !slamActive);
  // tab title
  if (gameActive) {
    if (checkSquare && myTurn) setTitle('⚠ Check! Your move');
    else setTitle(myTurn ? '● Your move' : "Opponent's move");
  }
}
function flashCheck() { checkFlash.classList.remove('hidden'); checkFlash.style.animation = 'none'; void checkFlash.offsetWidth; checkFlash.style.animation = ''; setTimeout(() => checkFlash.classList.add('hidden'), 900); }

// ── Capture trays + material ──
const START = { P: 8, N: 2, B: 2, R: 2, Q: 1 };
const VAL = { P: 1, N: 3, B: 3, R: 5, Q: 9 };
const GLYPH = { w: { P: '♙', N: '♘', B: '♗', R: '♖', Q: '♕' }, b: { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛' } };
function onBoardCounts(color) { const c = { P: 0, N: 0, B: 0, R: 0, Q: 0 }; for (let r = 0; r < 8; r++)for (let cc = 0; cc < 8; cc++) { const p = boardData[r][cc]; if (p && p[0] === color && c[p[1]] != null) c[p[1]]++; } return c; }
function capturedOf(color) { const on = onBoardCounts(color); const out = {}; let val = 0; for (const t of ['P', 'N', 'B', 'R', 'Q']) { const n = START[t] - on[t]; if (n > 0) { out[t] = n; val += n * VAL[t]; } } return { out, val }; }
function trayHTML(capColor, cap) { // capColor = colour of the captured pieces
  let html = ''; const cls = capColor === 'w' ? 'pw' : 'pb';
  for (const t of ['P', 'N', 'B', 'R', 'Q']) { const n = cap.out[t] || 0; for (let i = 0; i < n; i++) html += `<span class="${cls}">${GLYPH[capColor][t]}</span>`; }
  return html;
}
function renderTrays() {
  if (!boardData || !myColor) return;
  const opp = myColor === 'w' ? 'b' : 'w';
  const capByMe = capturedOf(opp);   // opp-coloured pieces I took
  const capByOpp = capturedOf(myColor);
  const net = capByMe.val - capByOpp.val;
  trayBottom.querySelector('.tray-pieces').innerHTML = trayHTML(opp, capByMe);
  trayTop.querySelector('.tray-pieces').innerHTML = trayHTML(myColor, capByOpp);
  trayBottom.querySelector('.tray-adv').textContent = net > 0 ? ('+' + net) : '';
  trayTop.querySelector('.tray-adv').textContent = net < 0 ? ('+' + (-net)) : '';
}

// ═══════════════════════════════════════════════════════════
//  THREE.JS
// ═══════════════════════════════════════════════════════════
let renderer, scene, camera, raycaster, mouse;
let boardGroup, pieceGroup, hintGroup, opponentAvatar, handGroup;
let tiles = [], pieceMeshes = [];
let camAnim = null, avatarAnim = null, dyingAnim = null, slamVel = [];
const _look = new THREE.Vector3();

// ── Clean board palette (soft sage + cream) ──
const TILE_LIGHT = 0xede6d2, TILE_DARK = 0x6b8f6e;
const LM_LIGHT = 0xf2ec9a, LM_DARK = 0xbac872;   // last move (yellow wash)
const SEL_LIGHT = 0xf3e07a, SEL_DARK = 0xd6bb55;  // selected
const CHK_LIGHT = 0xe5705c, CHK_DARK = 0xd8543f;  // in check (red)
function shade(r, c, light, dark) { return (r + c) % 2 === 0 ? light : dark; }

const MAT = {
  w: () => new THREE.MeshStandardMaterial({ color: 0xefe6cd, roughness: 0.42, metalness: 0.05 }),
  b: () => new THREE.MeshStandardMaterial({ color: 0x20242a, roughness: 0.36, metalness: 0.2 }),
};
const HINT_MAT = new THREE.MeshBasicMaterial({ color: 0x33402f, transparent: true, opacity: 0.32 });
const HINT_MAT_CAP = new THREE.MeshBasicMaterial({ color: 0x244a2c, transparent: true, opacity: 0.5 });

function buildScene() {
  const canvas = $('canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x10110f);

  scene = new THREE.Scene(); scene.fog = new THREE.Fog(0x10110f, 16, 42);
  camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 80); scene.add(camera);
  raycaster = new THREE.Raycaster(); mouse = new THREE.Vector2();

  scene.add(new THREE.HemisphereLight(0x9aa6b0, 0x141612, 0.35));
  const lamp = new THREE.SpotLight(0xfff1d6, 1.6, 42, Math.PI / 4, 0.55, 1.2);
  lamp.position.set(0, 14, 2); lamp.target.position.set(0, 0, 0); lamp.castShadow = true; lamp.shadow.mapSize.set(1024, 1024);
  scene.add(lamp); scene.add(lamp.target);
  const fill = new THREE.PointLight(0xcfe0ff, 0.45, 30); fill.position.set(-5, 7, 6); scene.add(fill);

  const table = new THREE.Mesh(new THREE.CylinderGeometry(13, 13.5, 0.6, 48), new THREE.MeshStandardMaterial({ color: 0x2c2620, roughness: 0.9 }));
  table.position.y = -0.36; table.receiveShadow = true; scene.add(table);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9, 0.22, 9), new THREE.MeshStandardMaterial({ color: 0x3b332a, roughness: 0.55, metalness: 0.1 }));
  frame.position.y = -0.03; frame.receiveShadow = true; scene.add(frame);

  boardGroup = new THREE.Group(); tiles = [];

  // 1. Render the 64 playable squares
  for (let r = 0; r < 8; r++) {
    tiles[r] = []; for (let c = 0; c < 8; c++) {
      const t = new THREE.Mesh(new THREE.BoxGeometry(1, 0.12, 1), new THREE.MeshStandardMaterial({ color: shade(r, c, TILE_LIGHT, TILE_DARK), roughness: 0.6 }));
      t.position.set(c - 3.5, 0.04, r - 3.5); t.receiveShadow = true; t.userData = { r, c }; boardGroup.add(t); tiles[r][c] = t;
    }
  }

  // 2. Add Border Coordinates outside the playing area
  for (let i = 0; i < 8; i++) {
    const fileChar = String.fromCharCode(97 + i); // a-h
    const rankNum = 8 - i;                        // 8-1

    // ── RANKS (1-8) ── Placed symmetrically along left and right outside borders
    const rankYOffset = i - 3.5; // Centers along rows

    // Left Border Rank
    const leftRank = createCoordTexture(rankNum.toString());
    leftRank.position.set(-4.2, 0.11, rankYOffset); // -4.2 pushes it left past the 'a' file
    if (myColor === 'b') leftRank.rotation.z = Math.PI;
    boardGroup.add(leftRank);

    // Right Border Rank
    const rightRank = createCoordTexture(rankNum.toString());
    rightRank.position.set(4.2, 0.11, rankYOffset);  // 4.2 pushes it right past the 'h' file
    if (myColor === 'b') rightRank.rotation.z = Math.PI;
    boardGroup.add(rightRank);


    // ── FILES (a-h) ── Placed symmetrically along bottom and top outside borders
    const fileXOffset = i - 3.5; // Centers along columns

    // Bottom Border File (Near White Player side)
    const bottomFile = createCoordTexture(fileChar);
    bottomFile.position.set(fileXOffset, 0.11, 4.2); // 4.2 pushes it down past row 1
    if (myColor === 'b') bottomFile.rotation.z = Math.PI;
    boardGroup.add(bottomFile);

    // Top Border File (Near Black Player side)
    const topFile = createCoordTexture(fileChar);
    topFile.position.set(fileXOffset, 0.11, -4.2); // -4.2 pushes it up past row 8
    if (myColor === 'b') topFile.rotation.z = Math.PI;
    boardGroup.add(topFile);
  }

  scene.add(boardGroup);

  handGroup = buildHands(); camera.add(handGroup);
  opponentAvatar = buildAvatar(); scene.add(opponentAvatar);
  pieceGroup = new THREE.Group(); scene.add(pieceGroup);
  hintGroup = new THREE.Group(); scene.add(hintGroup);

  canvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('resize', onResize);
  loadModels(() => { if (boardData) rebuildPieces(); });
  positionCamera(false); sceneReady = true; updateHUD(); animate();
}

function buildHands() {
  const g = new THREE.Group(); const skin = new THREE.MeshStandardMaterial({ color: 0xc99a6a, roughness: 0.7 });
  for (const sx of [-1.05, 1.05]) {
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.13, 0.7), skin); palm.position.set(sx, 0, 0); palm.castShadow = true; g.add(palm);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.36), skin); f.position.set(sx + (i - 1.5) * 0.12, 0.01, -0.5); g.add(f); }
    const th = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.28), skin); th.position.set(sx + (sx < 0 ? 0.3 : -0.3), 0.01, -0.2); g.add(th);
  }
  g.position.set(0, -1.55, -2.9); g.rotation.x = 0.5; g.scale.setScalar(0.95); return g;
}
function buildAvatar() {
  const g = new THREE.Group(); const mat = new THREE.MeshStandardMaterial({ color: 0x171a1e, roughness: 0.9, transparent: true, opacity: 1 });
  const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.95, 1.7, 16), mat); torso.position.y = 0.9; g.add(torso);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.95, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat); sh.position.y = 1.65; g.add(sh);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.3, 12), mat); neck.position.y = 1.95; g.add(neck);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 20, 16), mat); head.position.y = 2.45; g.add(head);
  g.position.set(0, 0, myColor === 'w' ? -7.0 : 7.0); g.userData.mat = mat; return g;
}
function setOpponentVisible(v) { if (!opponentAvatar) return; opponentAvatar.visible = v; opponentAvatar.userData.mat.opacity = v ? 1 : 0; opponentAvatar.position.y = 0; }
function animateOpponentSit() { if (!opponentAvatar) return; opponentAvatar.visible = true; opponentAvatar.userData.mat.opacity = 0; opponentAvatar.position.y = 1.6; avatarAnim = { t: 0 }; }

function computeSeat(color) {
  const canvas = $('canvas'); const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
  const fov = camera.fov * Math.PI / 180; const R = 6.4;
  const distV = R / Math.tan(fov / 2); const distH = R / (Math.tan(fov / 2) * aspect);
  const dist = Math.max(distV, distH) * 1.02; const ang = THREE.MathUtils.degToRad(53); const zS = color === 'w' ? 1 : -1;
  return { pos: new THREE.Vector3(0, dist * Math.sin(ang), zS * dist * Math.cos(ang)), look: new THREE.Vector3(0, 0.2, 0) };
}
function positionCamera(withIntro) {
  const seat = computeSeat(myColor); _look.copy(seat.look);
  if (withIntro) { const from = seat.pos.clone(); from.y += 2.4; from.multiplyScalar(1.12); camAnim = { from, to: seat.pos.clone(), t: 0 }; camera.position.copy(from); camera.lookAt(_look); }
  else { camera.position.copy(seat.pos); camera.lookAt(_look); }
}

// ── GLTF models ──
const PIECE_FILE = { P: 'pawn', R: 'rook', N: 'knight', B: 'bishop', Q: 'queen', K: 'king' };
const TARGET_H = { P: 0.62, R: 0.66, N: 0.74, B: 0.82, Q: 0.95, K: 1.05 };
const templates = {}; let modelsReady = false;
function loadModels(cb) {
  if (!THREE.GLTFLoader) { cb(); return; }
  const loader = new THREE.GLTFLoader(); const types = Object.keys(PIECE_FILE); let done = 0, failed = false;
  types.forEach(t => {
    loader.load('/assets/pieces/' + PIECE_FILE[t] + '.glb?v=5',
      g => { try { templates[t] = normalizeModel(g.scene, t); } catch (e) { failed = true; } if (++done === types.length) { modelsReady = !failed && Object.keys(templates).length === 6; cb(); } },
      undefined,
      () => { failed = true; if (++done === types.length) { modelsReady = false; cb(); } });
  });
}
function normalizeModel(obj, type) {
  const g = new THREE.Group(); g.add(obj); obj.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(obj); let size = box.getSize(new THREE.Vector3());
  if (size.z > size.y * 1.3) { obj.rotation.x = -Math.PI / 2; obj.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(obj); size = box.getSize(new THREE.Vector3()); }
  const s = (TARGET_H[type] || 0.7) / (size.y || 1); obj.scale.setScalar(s); obj.updateMatrixWorld(true);
  box = new THREE.Box3().setFromObject(obj); const c = box.getCenter(new THREE.Vector3());
  obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= box.min.y; return g;
}

// ── Procedural fallback ──
const PROFILES = {
  P: [[0, 0], [0.24, 0], [0.24, 0.04], [0.17, 0.06], [0.19, 0.08], [0.10, 0.12], [0.085, 0.26], [0.15, 0.30], [0.10, 0.33], [0.085, 0.36]],
  R: [[0, 0], [0.27, 0], [0.27, 0.05], [0.19, 0.07], [0.21, 0.09], [0.15, 0.13], [0.15, 0.42], [0.20, 0.45], [0.23, 0.48], [0.23, 0.55], [0.18, 0.55]],
  N: [[0, 0], [0.27, 0], [0.27, 0.05], [0.19, 0.07], [0.21, 0.09], [0.15, 0.13], [0.14, 0.22]],
  B: [[0, 0], [0.26, 0], [0.26, 0.05], [0.18, 0.07], [0.20, 0.09], [0.12, 0.13], [0.10, 0.36], [0.15, 0.40], [0.10, 0.43], [0.13, 0.47], [0.115, 0.58], [0.06, 0.70], [0, 0.75]],
  Q: [[0, 0], [0.28, 0], [0.28, 0.05], [0.20, 0.07], [0.22, 0.09], [0.14, 0.13], [0.10, 0.44], [0.14, 0.48], [0.10, 0.51], [0.17, 0.60], [0.19, 0.68], [0.10, 0.72]],
  K: [[0, 0], [0.28, 0], [0.28, 0.05], [0.20, 0.07], [0.22, 0.09], [0.14, 0.13], [0.10, 0.48], [0.14, 0.52], [0.10, 0.55], [0.17, 0.64], [0.19, 0.72], [0.13, 0.76], [0.13, 0.80]],
};
function latheMesh(pts, mat) { const v = pts.map(p => new THREE.Vector2(p[0], p[1])); const m = new THREE.Mesh(new THREE.LatheGeometry(v, 28), mat); m.castShadow = true; return m; }
function makeProcedural(code) {
  const color = code[0], type = code[1], mat = MAT[color](); const g = new THREE.Group(); g.add(latheMesh(PROFILES[type], mat));
  if (type === 'P') { const h = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), mat); h.position.y = 0.45; g.add(h); }
  else if (type === 'R') { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const m = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.09), mat); m.position.set(Math.cos(a) * 0.17, 0.6, Math.sin(a) * 0.17); g.add(m); } }
  else if (type === 'Q') { for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat); p.position.set(Math.cos(a) * 0.17, 0.76, Math.sin(a) * 0.17); g.add(p); } const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), mat); top.position.y = 0.78; g.add(top); }
  else if (type === 'K') { const v = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08), mat); v.position.y = 0.96; g.add(v); const hh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 0.08), mat); hh.position.y = 0.97; g.add(hh); }
  else if (type === 'B') { const f = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), mat); f.position.y = 0.78; g.add(f); }
  return g;
}
function makePiece(code) {
  const color = code[0], type = code[1]; let mesh;
  if (modelsReady && templates[type]) { mesh = templates[type].clone(true); mesh.traverse(o => { if (o.isMesh) { o.material = MAT[color](); o.castShadow = true; } }); mesh.rotation.y = color === 'w' ? Math.PI : 0; }
  else mesh = makeProcedural(code);
  return mesh;
}
function rebuildPieces() {
  while (pieceGroup.children.length) pieceGroup.remove(pieceGroup.children[0]); pieceMeshes = [];
  if (!boardData) return;
  for (let r = 0; r < 8; r++)for (let c = 0; c < 8; c++) { const code = boardData[r][c]; if (!code) continue; const m = makePiece(code); m.position.set(c - 3.5, 0.1, r - 3.5); m.userData = { r, c, code }; pieceGroup.add(m); pieceMeshes.push(m); }
  if (slamActive) seedSlam();
}

// ── Tiles / selection / hints ──
function key(r, c) { return r + ',' + c; }
function findKingSquare(color) { for (let r = 0; r < 8; r++)for (let c = 0; c < 8; c++)if (boardData[r][c] === color + 'K') return { r, c }; return null; }
function refreshTiles() {
  for (let r = 0; r < 8; r++)for (let c = 0; c < 8; c++) tiles[r][c].material.color.setHex(shade(r, c, TILE_LIGHT, TILE_DARK));
  if (lastMove) { const f = lastMove.from, t = lastMove.to; tiles[f.r][f.c].material.color.setHex(shade(f.r, f.c, LM_LIGHT, LM_DARK)); tiles[t.r][t.c].material.color.setHex(shade(t.r, t.c, LM_LIGHT, LM_DARK)); }
  if (checkSquare) tiles[checkSquare.r][checkSquare.c].material.color.setHex(shade(checkSquare.r, checkSquare.c, CHK_LIGHT, CHK_DARK));
  if (selected) tiles[selected.r][selected.c].material.color.setHex(shade(selected.r, selected.c, SEL_LIGHT, SEL_DARK));
}
function clearHints() { while (hintGroup.children.length) hintGroup.remove(hintGroup.children[0]); }
function showHints() {
  clearHints(); if (!selected) return;
  const moves = legalMap[key(selected.r, selected.c)] || [];
  for (const m of moves) {
    let mesh;
    if (boardData[m.r][m.c]) { mesh = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.06, 10, 24), HINT_MAT_CAP); mesh.rotation.x = Math.PI / 2; }
    else mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.05, 20), HINT_MAT);
    mesh.position.set(m.c - 3.5, 0.12, m.r - 3.5); hintGroup.add(mesh);
  }
}
function onPointerDown(e) {
  if (!gameActive || currentTurn !== myColor || slamActive || gameOver) return;
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1; mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(mouse, camera);
  let r = null, cc = null;
  const ph = raycaster.intersectObjects(pieceMeshes, true);
  if (ph.length) { let g = ph[0].object; while (g && !(g.userData && g.userData.code)) g = g.parent; if (g) { r = g.userData.r; cc = g.userData.c; } }
  if (r === null) { const flat = []; for (let i = 0; i < 8; i++)for (let j = 0; j < 8; j++)flat.push(tiles[i][j]); const th = raycaster.intersectObjects(flat); if (th.length) { r = th[0].object.userData.r; cc = th[0].object.userData.c; } }
  if (r === null) return;
  if (!selected) { if (legalMap[key(r, cc)]) { selected = { r, c: cc }; refreshTiles(); showHints(); } return; }
  if (selected.r === r && selected.c === cc) { selected = null; refreshTiles(); showHints(); return; }
  const moves = legalMap[key(selected.r, selected.c)] || [];
  if (moves.some(m => m.r === r && m.c === cc)) { socket.emit('move', { from: { r: selected.r, c: selected.c }, to: { r, c: cc } }); selected = null; clearHints(); }
  else if (legalMap[key(r, cc)]) { selected = { r, c: cc }; refreshTiles(); showHints(); }
  else { selected = null; refreshTiles(); showHints(); }
}

// ── Slam ──
function doSlam() {
  slamActive = true; selected = null; clearHints();
  const flash = document.createElement('div'); flash.className = 'slam-flash'; document.body.appendChild(flash); setTimeout(() => flash.remove(), 800);
  const base = computeSeat(myColor).pos.clone(); let n = 0;
  const sh = setInterval(() => { camera.position.set(base.x + (Math.random() - 0.5) * 0.5, base.y + (Math.random() - 0.5) * 0.4, base.z + (Math.random() - 0.5) * 0.5); camera.lookAt(_look); if (++n > 14) { clearInterval(sh); camera.position.copy(base); camera.lookAt(_look); } }, 35);
  seedSlam();
}
function seedSlam() { slamVel = pieceMeshes.map(() => ({ vx: (Math.random() - 0.5) * 0.3, vy: Math.random() * 0.34 + 0.12, vz: (Math.random() - 0.5) * 0.3, rx: (Math.random() - 0.5) * 0.25, ry: (Math.random() - 0.5) * 0.25, rz: (Math.random() - 0.5) * 0.25 })); }
function stepSlam() { if (!slamActive) return; const G = -0.009; pieceMeshes.forEach((m, i) => { const v = slamVel[i]; if (!v) return; v.vy += G; m.position.x += v.vx; m.position.y += v.vy; m.position.z += v.vz; m.rotation.x += v.rx; m.rotation.y += v.ry; m.rotation.z += v.rz; if (m.position.y < -0.5) { m.position.y = -0.5; v.vy = Math.abs(v.vy) * 0.35; v.vx *= 0.8; v.vz *= 0.8; } }); }

// ── Checkmate topple ──
function topple(losingColor, after) { const km = pieceMeshes.find(m => m.userData.code === losingColor + 'K'); if (!km) { setTimeout(after, 400); return; } dyingAnim = { mesh: km, t: 0, after }; }

// ── Loop ──
function animate() {
  requestAnimationFrame(animate);
  if (camAnim) { camAnim.t = Math.min(1, camAnim.t + 0.018); const e = 1 - Math.pow(1 - camAnim.t, 3); camera.position.lerpVectors(camAnim.from, camAnim.to, e); camera.lookAt(_look); if (camAnim.t >= 1) camAnim = null; }
  if (avatarAnim) { avatarAnim.t = Math.min(1, avatarAnim.t + 0.022); const e = 1 - Math.pow(1 - avatarAnim.t, 3); opponentAvatar.position.y = 1.6 * (1 - e); opponentAvatar.userData.mat.opacity = e; if (avatarAnim.t >= 1) { avatarAnim = null; opponentAvatar.position.y = 0; } }
  if (dyingAnim) { dyingAnim.t = Math.min(1, dyingAnim.t + 0.02); const e = 1 - Math.pow(1 - dyingAnim.t, 3); dyingAnim.mesh.rotation.z = -Math.PI / 2 * 0.92 * e; dyingAnim.mesh.position.y = 0.1 - 0.06 * e; if (dyingAnim.t >= 1) { const a = dyingAnim.after; dyingAnim = null; if (a) setTimeout(a, 250); } }
  stepSlam();
  if (renderer) renderer.render(scene, camera);
}
function onResize() { if (!renderer) return; const canvas = $('canvas'); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); renderer.setSize(canvas.clientWidth, canvas.clientHeight); positionCamera(false); }

// Creates a sharp 3D text plane for the border coordinates
function createCoordTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');

  // Clean off-white coordinate text color for the outer dark wood frame
  ctx.fillStyle = '#f0d9b5';
  ctx.font = 'bold 40px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 32, 32);

  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mat);

  // Placed slightly above the frame surface to prevent rendering glitches
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.11;
  return mesh;
}