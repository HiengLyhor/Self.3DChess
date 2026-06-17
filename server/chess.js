// ═══════════════════════════════════════════════════════════
//  chess.js — server-authoritative chess rules engine
//  Board orientation:
//    row 0 = black back rank, row 1 = black pawns
//    row 6 = white pawns,     row 7 = white back rank
//    white moves toward row 0 (dir = -1)
// ═══════════════════════════════════════════════════════════

const KNIGHT = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
const DIRS = {
  R: [[-1,0],[1,0],[0,-1],[0,1]],
  B: [[-1,-1],[-1,1],[1,-1],[1,1]],
  Q: [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]],
  K: [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]],
};

const inB = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
const colorOf = (p) => (p ? p[0] : null);
const typeOf = (p) => (p ? p[1] : null);
const cloneBoard = (b) => b.map((row) => row.slice());

function initialBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(null));
  const order = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let i = 0; i < 8; i++) {
    b[0][i] = 'b' + order[i];
    b[1][i] = 'bP';
    b[6][i] = 'wP';
    b[7][i] = 'w' + order[i];
  }
  return b;
}

function initialState() {
  return {
    board: initialBoard(),
    turn: 'w',
    castling: { wK: true, wQ: true, bK: true, bQ: true },
    enPassant: null, // {r, c} square that can be captured into
  };
}

// Pseudo-legal moves (no self-check filtering, no castling)
function pseudoMoves(state, r, c) {
  const b = state.board;
  const p = b[r][c];
  if (!p) return [];
  const col = colorOf(p), type = typeOf(p);
  const enemy = col === 'w' ? 'b' : 'w';
  const moves = [];

  if (type === 'P') {
    const dir = col === 'w' ? -1 : 1;
    const startRow = col === 'w' ? 6 : 1;
    if (inB(r + dir, c) && !b[r + dir][c]) {
      moves.push({ r: r + dir, c });
      if (r === startRow && !b[r + 2 * dir][c]) {
        moves.push({ r: r + 2 * dir, c, double: true });
      }
    }
    for (const dc of [-1, 1]) {
      const nr = r + dir, nc = c + dc;
      if (!inB(nr, nc)) continue;
      if (b[nr][nc] && colorOf(b[nr][nc]) === enemy) moves.push({ r: nr, c: nc });
      if (state.enPassant && state.enPassant.r === nr && state.enPassant.c === nc) {
        moves.push({ r: nr, c: nc, enPassant: true });
      }
    }
  } else if (type === 'N') {
    for (const [dr, dc] of KNIGHT) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && colorOf(b[nr][nc]) !== col) moves.push({ r: nr, c: nc });
    }
  } else if (type === 'K') {
    for (const [dr, dc] of DIRS.K) {
      const nr = r + dr, nc = c + dc;
      if (inB(nr, nc) && colorOf(b[nr][nc]) !== col) moves.push({ r: nr, c: nc });
    }
  } else {
    for (const [dr, dc] of DIRS[type]) {
      let nr = r + dr, nc = c + dc;
      while (inB(nr, nc)) {
        if (!b[nr][nc]) moves.push({ r: nr, c: nc });
        else {
          if (colorOf(b[nr][nc]) === enemy) moves.push({ r: nr, c: nc });
          break;
        }
        nr += dr; nc += dc;
      }
    }
  }
  return moves;
}

function findKing(board, col) {
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (board[r][c] === col + 'K') return { r, c };
  return null;
}

// Is square (r,c) attacked by pieces of color byColor?
function isAttacked(board, r, c, byColor) {
  // pawns
  const dir = byColor === 'w' ? -1 : 1;
  for (const dc of [-1, 1]) {
    const pr = r - dir, pc = c + dc;
    if (inB(pr, pc) && board[pr][pc] === byColor + 'P') return true;
  }
  // knights
  for (const [dr, dc] of KNIGHT) {
    const nr = r + dr, nc = c + dc;
    if (inB(nr, nc) && board[nr][nc] === byColor + 'N') return true;
  }
  // king
  for (const [dr, dc] of DIRS.K) {
    const nr = r + dr, nc = c + dc;
    if (inB(nr, nc) && board[nr][nc] === byColor + 'K') return true;
  }
  // rook / queen (orthogonal)
  for (const [dr, dc] of DIRS.R) {
    let nr = r + dr, nc = c + dc;
    while (inB(nr, nc)) {
      const pp = board[nr][nc];
      if (pp) {
        if (colorOf(pp) === byColor && (typeOf(pp) === 'R' || typeOf(pp) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  // bishop / queen (diagonal)
  for (const [dr, dc] of DIRS.B) {
    let nr = r + dr, nc = c + dc;
    while (inB(nr, nc)) {
      const pp = board[nr][nc];
      if (pp) {
        if (colorOf(pp) === byColor && (typeOf(pp) === 'B' || typeOf(pp) === 'Q')) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

function inCheck(board, col) {
  const k = findKing(board, col);
  if (!k) return false;
  return isAttacked(board, k.r, k.c, col === 'w' ? 'b' : 'w');
}

// Apply a (validated) move, returns new state. Handles ep, castle, promotion (auto-queen).
function applyMove(state, from, to) {
  const b = cloneBoard(state.board);
  const p = b[from.r][from.c];
  const col = colorOf(p), type = typeOf(p);
  const ns = {
    board: b,
    turn: col === 'w' ? 'b' : 'w',
    castling: { ...state.castling },
    enPassant: null,
  };

  const meta = pseudoMoves(state, from.r, from.c).find((m) => m.r === to.r && m.c === to.c) || {};

  // en passant capture
  if (type === 'P' && meta.enPassant) {
    b[from.r][to.c] = null;
  }

  // move the piece
  b[to.r][to.c] = p;
  b[from.r][from.c] = null;

  // double pawn push sets en-passant target
  if (type === 'P' && meta.double) {
    ns.enPassant = { r: (from.r + to.r) / 2, c: from.c };
  }

  // promotion (auto-queen)
  if (type === 'P' && (to.r === 0 || to.r === 7)) {
    b[to.r][to.c] = col + 'Q';
  }

  // castling — move the rook too
  if (type === 'K' && Math.abs(to.c - from.c) === 2) {
    const row = from.r;
    if (to.c === 6) { b[row][5] = b[row][7]; b[row][7] = null; }
    else if (to.c === 2) { b[row][3] = b[row][0]; b[row][0] = null; }
  }

  // update castling rights
  if (type === 'K') {
    if (col === 'w') { ns.castling.wK = false; ns.castling.wQ = false; }
    else { ns.castling.bK = false; ns.castling.bQ = false; }
  }
  if (type === 'R') {
    if (from.r === 7 && from.c === 0) ns.castling.wQ = false;
    if (from.r === 7 && from.c === 7) ns.castling.wK = false;
    if (from.r === 0 && from.c === 0) ns.castling.bQ = false;
    if (from.r === 0 && from.c === 7) ns.castling.bK = false;
  }
  // a rook captured on its home square loses rights
  if (to.r === 7 && to.c === 0) ns.castling.wQ = false;
  if (to.r === 7 && to.c === 7) ns.castling.wK = false;
  if (to.r === 0 && to.c === 0) ns.castling.bQ = false;
  if (to.r === 0 && to.c === 7) ns.castling.bK = false;

  return ns;
}

// Legal moves for the piece at (r,c) — filters self-check, adds castling
function legalMovesFrom(state, r, c) {
  const p = state.board[r][c];
  if (!p) return [];
  const col = colorOf(p);
  const legal = [];

  for (const m of pseudoMoves(state, r, c)) {
    const ns = applyMove(state, { r, c }, { r: m.r, c: m.c });
    if (!inCheck(ns.board, col)) legal.push({ r: m.r, c: m.c });
  }

  // castling
  if (typeOf(p) === 'K') {
    const row = col === 'w' ? 7 : 0;
    const opp = col === 'w' ? 'b' : 'w';
    const rights = state.castling;
    if (r === row && c === 4 && !inCheck(state.board, col)) {
      // kingside
      if ((col === 'w' ? rights.wK : rights.bK) &&
          !state.board[row][5] && !state.board[row][6] &&
          state.board[row][7] === col + 'R' &&
          !isAttacked(state.board, row, 5, opp) &&
          !isAttacked(state.board, row, 6, opp)) {
        legal.push({ r: row, c: 6 });
      }
      // queenside
      if ((col === 'w' ? rights.wQ : rights.bQ) &&
          !state.board[row][1] && !state.board[row][2] && !state.board[row][3] &&
          state.board[row][0] === col + 'R' &&
          !isAttacked(state.board, row, 3, opp) &&
          !isAttacked(state.board, row, 2, opp)) {
        legal.push({ r: row, c: 2 });
      }
    }
  }
  return legal;
}

// All legal moves for a color → { map: { "r,c": [targets] }, any: bool }
function allLegalMoves(state, col) {
  const map = {};
  let any = false;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      const p = state.board[r][c];
      if (p && colorOf(p) === col) {
        const lm = legalMovesFrom(state, r, c);
        if (lm.length) { map[r + ',' + c] = lm; any = true; }
      }
    }
  return { map, any };
}

// Validate + apply a move from the side to move. Returns new state or null.
function makeMove(state, from, to) {
  const p = state.board[from.r][from.c];
  if (!p || colorOf(p) !== state.turn) return null;
  const legal = legalMovesFrom(state, from.r, from.c);
  if (!legal.some((m) => m.r === to.r && m.c === to.c)) return null;
  return applyMove(state, from, to);
}

// Status for the side to move
function status(state) {
  const col = state.turn;
  const { any } = allLegalMoves(state, col);
  const check = inCheck(state.board, col);
  if (!any) {
    return check
      ? { over: true, result: 'checkmate', winner: col === 'w' ? 'b' : 'w' }
      : { over: true, result: 'stalemate', winner: null };
  }
  return { over: false, check };
}

module.exports = { initialState, makeMove, allLegalMoves, status };
