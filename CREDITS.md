# Credits

## 3D chess piece models
Located in `public/assets/pieces/` (pawn, rook, knight, bishop, queen, king `.glb`).

- Author: **Ernest Rudnicki**
- Source: https://github.com/ernest-rudnicki/chess-3d
- License: **MIT** (see `public/assets/pieces/LICENSE.md`)

Models are loaded at runtime via three.js GLTFLoader, scaled/centered automatically,
and re-coloured (ivory / obsidian) per side. If the models fail to load for any reason,
the game falls back to built-in procedurally generated pieces.

## Libraries (loaded via CDN)
- three.js r128
- three.js GLTFLoader (examples/js global build, r128)
- Socket.IO client

## Analysis engine & libraries
- Stockfish 10 (`public/engine/stockfish.js`, asm.js single-file build) — GPLv3, see `public/engine/LICENSE-stockfish.txt`. Runs entirely in the visitor's browser.
- chess.js (`public/js/lib/chess.min.js`) — BSD-2-Clause, by Jeff Hlywa. Used for move/FEN tracking and PGN parsing.
- Chess.com games are fetched per-user, on demand, via the official public read API (https://api.chess.com/pub) through a thin server proxy. No bulk harvesting or public rehosting.

## 2D piece graphics (analysis board & previews)
- "cburnett" SVG chess set by Colin M.L. Burnett — GPLv2+ / CC-BY-SA 3.0.
  Source: lichess-org/lila. See public/assets/pieces2d/LICENSE.txt.
  (Chess.com's own piece sprites are proprietary and are NOT used.)
