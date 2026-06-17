const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { nanoid } = require('nanoid');
const chess = require('./chess');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Don't let Cloudflare/browsers cache HTML; allow hashed assets to cache.
app.use(express.static(path.join(__dirname, '../public'), {
  setHeaders: (res, fp) => {
    if (fp.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

// ── chess.com proxy (avoids browser CORS + User-Agent blocking) ──
const https = require('https');
function fetchChessCom(pathname) {
  return new Promise((resolve, reject) => {
    const req = https.get('https://api.chess.com' + pathname, {
      headers: { 'User-Agent': 'TheBoardRoom/1.0 (chess.lyhor.space; personal game analysis)', 'Accept': 'application/json' },
    }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve({ status: r.statusCode, body: d }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('timeout')); });
  });
}
const SAFE = (s) => String(s || '').replace(/[^a-zA-Z0-9_\-]/g, '').slice(0, 40);
app.get('/api/chesscom/:user/archives', async (req, res) => {
  try {
    const r = await fetchChessCom(`/pub/player/${SAFE(req.params.user).toLowerCase()}/games/archives`);
    res.status(r.status).type('application/json').send(r.body);
  } catch (e) { res.status(502).json({ error: 'fetch failed' }); }
});
app.get('/api/chesscom/:user/:year/:month', async (req, res) => {
  const y = SAFE(req.params.year), m = SAFE(req.params.month);
  try {
    const r = await fetchChessCom(`/pub/player/${SAFE(req.params.user).toLowerCase()}/games/${y}/${m}`);
    res.status(r.status).type('application/json').send(r.body);
  } catch (e) { res.status(502).json({ error: 'fetch failed' }); }
});

// rooms: { code, host, guest, locked, state, hostColor, guestColor, slams, over }
const rooms = {};
const SLAMS_PER_SIDE = 5;

function pickColors(side) {
  if (side === 'random') side = Math.random() < 0.5 ? 'white' : 'black';
  const host = side === 'black' ? 'b' : 'w';
  return { host, guest: host === 'w' ? 'b' : 'w' };
}
function colorOfSocket(socket, room) {
  return socket.role === 'host' ? room.hostColor : room.guestColor;
}
function newGame(room) {
  room.state = chess.initialState();
  room.slams = { w: SLAMS_PER_SIDE, b: SLAMS_PER_SIDE };
  room.over = false;
  room.history = [];
}
function rebuildState(history) {
  let st = chess.initialState();
  for (const mv of history) { const ns = chess.makeMove(st, mv.from, mv.to); if (ns) st = ns; }
  return st;
}
function emitGameStart(code) {
  const room = rooms[code];
  if (!room) return;
  const { map } = chess.allLegalMoves(room.state, room.state.turn);
  const common = { board: room.state.board, turn: room.state.turn, legalMoves: map, slams: room.slams };
  io.to(room.host).emit('game_start', { color: room.hostColor, ...common });
  if (room.guest) io.to(room.guest).emit('game_start', { color: room.guestColor, ...common });
}

io.on('connection', (socket) => {
  socket.on('create_room', ({ side } = {}) => {
    const code = nanoid(6).toUpperCase();
    const colors = pickColors(side || 'white');
    const room = { code, host: socket.id, guest: null, locked: false, hostColor: colors.host, guestColor: colors.guest };
    newGame(room);
    rooms[code] = room;
    socket.join(code); socket.roomCode = code; socket.role = 'host';
    socket.emit('room_created', { code, color: colors.host });
  });

  socket.on('join_room', ({ code }) => {
    code = (code || '').toUpperCase();
    const room = rooms[code];
    if (!room) return socket.emit('join_error', { msg: 'Room not found.' });
    if (room.locked) return socket.emit('join_error', { msg: 'Room is full.' });
    room.guest = socket.id; room.locked = true;
    socket.join(code); socket.roomCode = code; socket.role = 'guest';
    socket.emit('join_success', { code, color: room.guestColor });
    io.to(room.host).emit('opponent_entered');
    setTimeout(() => emitGameStart(code), 2200);
  });

  socket.on('move', ({ from, to }) => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over) return;
    const myColor = colorOfSocket(socket, room);
    if (room.state.turn !== myColor) return;
    const ns = chess.makeMove(room.state, from, to);
    if (!ns) return;
    room.state = ns;
    room.history.push({ from, to });
    const st = chess.status(room.state);
    const { map } = chess.allLegalMoves(room.state, room.state.turn);
    io.to(socket.roomCode).emit('board_update', {
      board: room.state.board, turn: room.state.turn, legalMoves: map, from, to, check: st.check || false,
    });
    if (st.over) {
      room.over = true;
      io.to(socket.roomCode).emit('game_over', { result: st.result, winner: st.winner });
    }
  });

  socket.on('slam_board', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over) return;
    const myColor = colorOfSocket(socket, room);
    if (room.state.turn !== myColor) return;          // only on your turn
    if (room.slams[myColor] <= 0) return;             // out of slams
    room.slams[myColor]--;
    io.to(socket.roomCode).emit('board_slammed', { by: myColor, slams: room.slams });
  });

  socket.on('reset_board', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const { map } = chess.allLegalMoves(room.state, room.state.turn);
    io.to(socket.roomCode).emit('board_reset', {
      board: room.state.board, turn: room.state.turn, legalMoves: map, slams: room.slams,
    });
  });

  socket.on('surrender', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over) return;
    room.over = true;
    const myColor = colorOfSocket(socket, room);
    io.to(socket.roomCode).emit('game_over', { result: 'surrender', winner: myColor === 'w' ? 'b' : 'w' });
  });

  socket.on('offer_draw', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over) return;
    const opp = socket.role === 'host' ? room.guest : room.host;
    if (opp) io.to(opp).emit('draw_offered');
  });
  socket.on('accept_draw', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over) return;
    room.over = true;
    io.to(socket.roomCode).emit('game_over', { result: 'draw', winner: null });
  });
  socket.on('decline_draw', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const opp = socket.role === 'host' ? room.guest : room.host;
    if (opp) io.to(opp).emit('draw_declined');
  });

  socket.on('request_takeback', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over || !room.history.length) return;
    room.takebackBy = colorOfSocket(socket, room);
    const opp = socket.role === 'host' ? room.guest : room.host;
    if (opp) io.to(opp).emit('takeback_offered');
  });
  socket.on('accept_takeback', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked || room.over || !room.history.length) return;
    const requester = room.takebackBy || (room.state.turn === 'w' ? 'b' : 'w');
    let undone = 0, st = room.state;
    do {
      room.history.pop(); undone++;
      st = rebuildState(room.history);
    } while (st.turn !== requester && room.history.length > 0 && undone < 2);
    room.state = st;
    const { map } = chess.allLegalMoves(st, st.turn);
    const last = room.history[room.history.length - 1] || null;
    io.to(socket.roomCode).emit('takeback_done', { board: st.board, turn: st.turn, legalMoves: map, lastMove: last, undone });
  });
  socket.on('decline_takeback', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const opp = socket.role === 'host' ? room.guest : room.host;
    if (opp) io.to(opp).emit('takeback_declined');
  });

  socket.on('request_rematch', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked) return;
    const opp = socket.role === 'host' ? room.guest : room.host;
    if (opp) io.to(opp).emit('rematch_offered');
  });
  socket.on('accept_rematch', () => {
    const room = rooms[socket.roomCode];
    if (!room || !room.locked) return;
    const h = room.hostColor; room.hostColor = room.guestColor; room.guestColor = h; // swap sides
    newGame(room);
    emitGameStart(socket.roomCode);
  });
  socket.on('decline_rematch', () => {
    const room = rooms[socket.roomCode];
    if (!room) return;
    const opp = socket.role === 'host' ? room.guest : room.host;
    if (opp) io.to(opp).emit('rematch_declined');
  });

  socket.on('leave_room', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) { io.to(code).emit('opponent_left'); delete rooms[code]; }
    socket.roomCode = null;
  });
  socket.on('disconnect', () => {
    const code = socket.roomCode;
    if (code && rooms[code]) { io.to(code).emit('opponent_left'); delete rooms[code]; }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Chess3D running on :${PORT}`));
