// ==UserScript==
// @name         Chess.com Hint Arrow VIP PRO MAX — XAIZ (Mũi tên hướng dẫn, bạn tự đi)
// @namespace    xaiz-chess-hint
// @version      5.0.0
// @description  Menu VIP PRO MAX: mũi tên nước tốt nhất (engine Lichess Book + Stockfish) vẽ ngay trên bàn Chess.com, đổi màu mũi tên, lịch sử gợi ý, bạn tự đi theo. KHÔNG tự bấm quân.
// @author       XAIZ
// @match        https://www.chess.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      lichess.org
// @connect      stockfish.online
// ==/UserScript==


/*
  CHESS.COM BOT AI v3.2.0 VIP — XAIZ TOOL
  ------------------------------------
  NÓI THẬT VỀ 2 CON SỐ BẠN HỎI:
  - "Thắng 999%": KHÔNG CÓ. Thắng tối đa là 100%, và không ai thắng 100% mọi
    ván được — Stockfish gặp Stockfish thì hòa, đối thủ chơi chuẩn thì không có
    đường ép thắng. Tool chỉ giúp bạn luôn đi nước mạnh nhất.
  - "7749 thế cờ": không nhét 7749 thế cờ cứng vào 1 file được (file sẽ nặng
    hàng MB, điện thoại tải không nổi). Thay vào đó v2 dùng 2 nguồn thật:
      (1) Lichess Cloud Eval — CSDL nước đã phân tích sẵn, phủ hàng triệu thế
          cờ mở đầu và trung cuộc, trả Top 3 nước ngay lập tức, depth tới 75.
      (2) Sách mở cờ tích hợp sẵn trong tool: 24 khai cuộc nổi tiếng kèm tên
          và mã ECO, hiện tên khai cuộc ngay trong tab MỞ CỜ.
    Hết sách + hết CSDL thì Stockfish tính tiếp, nên mọi thế cờ đều có nước đi.

  SỬA LỖI v1: mode RAGE depth 18 làm API Stockfish.online báo lỗi
  "Depth must be less than 16" nên không tính được nước nào. v2 giới hạn
  depth tối đa 15: LEGIT 10 / VIP 13 / RAGE 15.
*/
(function () {
  'use strict';

  // ================= CẤU HÌNH =================
  const CFG = {
    modes: {
      LEGIT: { depth: 10, delayMin: 1800, delayMax: 3200, label: 'LEGIT' },
      VIP:   { depth: 13, delayMin: 800,  delayMax: 1500, label: 'VIP' },
      RAGE:  { depth: 15, delayMin: 300,  delayMax: 600,  label: 'RAGE' },
    },
    modeOrder: ['LEGIT', 'VIP', 'RAGE'],
    scanMs: 800,
    apiTimeoutMs: 12000,
  };
  let mode = GM_getValue('xaiz_mode', 'VIP');
  let arrowVisible = GM_getValue('xaiz_arrow', true);
  let arrowColor = GM_getValue('xaiz_arrowcolor', '#22c55e');
  let showTop3Arrows = GM_getValue('xaiz_top3arrows', true);
  let hintHistory = [];
  let flipped = false;
  let myColor = 'w';
  // SỬA LỖI v2: nút ĐỔI CHIỀU BÀN ở v2 bị lần quét sau ghi đè (readPieces tự
  // nhận lại chiều bàn nên nút bấm không có tác dụng). v2.1 thêm colorOverride:
  // khi bạn chọn tay màu cờ thì lần quét sau KHÔNG tự nhận lại nữa.
  let colorOverride = GM_getValue('xaiz_color', null); // 'w' | 'b' | null = tự nhận theo chiều bàn, đã lưu nên tải lại trang vẫn nhớ
  let turnFlip = GM_getValue('xaiz_turnflip', false); // true = đảo lượt đi tự nhận (khi nó cứ hiện sai lượt)
  let lastFen = '';
  let lastBest = '';
  let lastTop3 = [];       // [{move, cp, mate}]
  let lastEvalCp = null;   // điểm theo trắng, đơn vị centipawn
  let lastMate = null;
  let lastOpening = null;
  let engineBusy = false;
  let plyCount = 0;
  let halfmove = 0, fullmove = 1;
  let hintMoves = 0;        // số nước bot đã đi trong phiên này

  const FILES = 'abcdefgh';
  const PIECE_LETTER = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

  // ================= SÁCH MỞ CỜ (24 khai cuộc, mã ECO) =================
  // Mỗi khai cuộc: tên, mã ECO, chuỗi nước đi SAN mở đầu.
  const OPENINGS = [
    { eco: 'C50', name: 'Italian Game', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bc4'] },
    { eco: 'C42', name: 'Petrov Defense', moves: ['e4', 'e5', 'Nf3', 'Nf6'] },
    { eco: 'B20', name: 'Sicilian Defense', moves: ['e4', 'c5'] },
    { eco: 'B90', name: 'Sicilian Najdorf', moves: ['e4', 'c5', 'Nf3', 'd6', 'd4', 'cxd4', 'Nxd4', 'Nf6', 'Nc3', 'a6'] },
    { eco: 'C00', name: 'French Defense', moves: ['e4', 'e6'] },
    { eco: 'C10', name: 'French Paulsen', moves: ['e4', 'e6', 'd4', 'd5', 'Nc3', 'Nf6', 'e5', 'Nfd7'] },
    { eco: 'B10', name: 'Caro-Kann Defense', moves: ['e4', 'c6'] },
    { eco: 'B12', name: 'Caro-Kann Advance', moves: ['e4', 'c6', 'd4', 'd5', 'e5'] },
    { eco: 'C60', name: 'Ruy Lopez', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5'] },
    { eco: 'C78', name: 'Ruy Lopez Morphy', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O'] },
    { eco: 'A10', name: 'English Opening', moves: ['c4'] },
    { eco: 'A40', name: "Queen's Pawn Game", moves: ['d4'] },
    { eco: 'D06', name: "Queen's Gambit", moves: ['d4', 'd5', 'c4'] },
    { eco: 'D10', name: "Queen's Gambit Slav", moves: ['d4', 'd5', 'c4', 'c6'] },
    { eco: 'A45', name: 'Indian Defense', moves: ['d4', 'Nf6'] },
    { eco: 'E60', name: "King's Indian Defense", moves: ['d4', 'Nf6', 'c4', 'g6'] },
    { eco: 'A07', name: "King's Indian Attack", moves: ['Nf3', 'd5', 'g3'] },
    { eco: 'D02', name: 'London System', moves: ['d4', 'd5', 'Bf4'] },
    { eco: 'A46', name: 'London / Torre', moves: ['d4', 'Nf6', 'Nf3', 'e6', 'Bf4'] },
    { eco: 'B00', name: "King's Pawn Opening", moves: ['e4'] },
    { eco: 'C20', name: "King's Pawn Game", moves: ['e4', 'e5'] },
    { eco: 'B01', name: 'Scandinavian Defense', moves: ['e4', 'd5'] },
    { eco: 'C41', name: 'Philidor Defense', moves: ['e4', 'e5', 'Nf3', 'd6'] },
    { eco: 'C44', name: 'Ponziani Opening', moves: ['e4', 'e5', 'Nf3', 'Nc6', 'c3'] },
  ];

  // ================= TIỆN ÍCH =================
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const log = (...a) => console.log('[XAIZ Chess Bot v3.2 VIP]', ...a);
  function saveColor(c) { colorOverride = c; try { GM_setValue('xaiz_color', c); } catch (e) {} }
  function saveTurnFlip(v) { turnFlip = v; try { GM_setValue('xaiz_turnflip', v); } catch (e) {} }
  // Đổi centipawn -> % thắng của Trắng (công thức chuẩn của Lichess).
  function winPct(cp) {
    if (cp === null || cp === undefined) return null;
    return Math.round(50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1));
  }
  function gmGet(url) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, timeout: CFG.apiTimeoutMs,
        onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); } },
        onerror: (e) => reject(e), ontimeout: () => reject(new Error('timeout')),
      });
    });
  }

  // ================= ĐỌC BÀN CỜ =================
  function getBoardEl() {
    return document.querySelector('wc-chess-board')
      || document.querySelector('.board, [class*="board-"]');
  }
  function detectFlipped(board) {
    if (!board) return false;
    // Chess.com tự thêm class "flipped" vào wc-chess-board khi Đen ở dưới.
    if (board.classList && board.classList.contains('flipped')) return true;
    return false;
  }
  // SỬA LỖI GỐC v3.1: square-XY là X = cột (a=1..h=8), Y = HẠNG (1..8),
  // tính theo khung Trắng, không đổi khi lật bàn. Vd square-52 = e2 (KHÔNG
  // phải e7 như code cũ tưởng). Chỉ tọa độ HIỂN THỊ khi bấm mới phụ thuộc
  // vào bàn có lật hay không, còn tên ô thì không.
  function squareXYtoAlgebraic(x, y) {
    return FILES[x - 1] + String(y);
  }
  function parsePieces(board, flipVal) {
    const save = flipped; flipped = flipVal;
    const pieces = {};
    board.querySelectorAll('.piece').forEach((el) => {
      const cls = el.className || '';
      const mSq = cls.match(/square-(\d)(\d)/);
      const mPc = cls.match(/\b([wb])([pnbrqk])\b/);
      if (!mSq || !mPc) return;
      pieces[squareXYtoAlgebraic(parseInt(mSq[1], 10), parseInt(mSq[2], 10))] =
        { color: mPc[1], type: PIECE_LETTER[mPc[2]] };
    });
    flipped = save;
    return pieces;
  }
  function readPieces() {
    const board = getBoardEl();
    if (!board) return null;
    if (colorOverride) { flipped = (colorOverride === 'b'); myColor = colorOverride; }
    else { flipped = detectFlipped(board); myColor = flipped ? 'b' : 'w'; }
    let pieces = parsePieces(board, flipped);
    // Tự hiệu chỉnh: nếu vua trắng lại ở hạng 8 và vua đen ở hạng 1 thì chiều
    // bàn đang bị đảo -> đọc lại với chiều ngược lại.
    const wk = Object.keys(pieces).find(sq => pieces[sq].type === 'k' && pieces[sq].color === 'w');
    const bk = Object.keys(pieces).find(sq => pieces[sq].type === 'k' && pieces[sq].color === 'b');
    if (wk && bk && parseInt(wk[1], 10) >= 7 && parseInt(bk[1], 10) <= 2 && !colorOverride) {
      flipped = !flipped; myColor = flipped ? 'b' : 'w';
      pieces = parsePieces(board, flipped);
      log('Tự hiệu chỉnh chiều bàn: vua bị đảo nên đã lật lại');
    }
    return { board, pieces };
  }
  // Danh sách nước đi SAN đã đi (để đếm lượt + nhận diện khai cuộc).
  // SỬA LỖI v3.0: đếm node .move làm sai lượt đi, vì 1 node của Chess.com chứa
  // cả 2 nước (vd "e4 e5") nên đếm thiếu 1 nửa, lượt Trắng/Đen bị đảo ngược.
  // v3.1 đọc toàn bộ chữ trong danh sách nước đi rồi tách từng nước SAN ra đếm.
  function readMoveSANs() {
    const list = document.querySelector('[data-test-element="move-list"], .vertical-move-list, .move-list');
    if (!list) return [];
    const text = list.textContent || '';
    const sans = [];
    text.split(/\s+/).forEach((raw) => {
      const t = raw.trim().replace(/[+#?!]+$/, '');
      if (!t || /^\d+\.$/.test(t) || /^(1-0|0-1|1\/2-1\/2|\*)$/.test(t)) return;
      if (/^(O-O-O|O-O|[KQRBN]?[a-h]?x?[a-h][1-8](?:=[QRBN])?)$/.test(t)) sans.push(t);
    });
    return sans;
  }
  function findOpening(sans) {
    let best = null;
    for (const op of OPENINGS) {
      let ok = true;
      for (let i = 0; i < Math.min(op.moves.length, sans.length); i++) {
        if (op.moves[i] !== sans[i]) { ok = false; break; }
      }
      if (ok && sans.length > 0 && (!best || op.moves.length > best.moves.length)) best = op;
    }
    return best;
  }
  function buildFen(pieces) {
    let placement = '';
    for (let rank = 8; rank >= 1; rank--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const pc = pieces[FILES[f] + rank];
        if (!pc) { empty++; continue; }
        if (empty) { placement += empty; empty = 0; }
        placement += pc.color === 'w' ? pc.type.toUpperCase() : pc.type;
      }
      if (empty) placement += empty;
      if (rank > 1) placement += '/';
    }
    let c = '';
    if (pieces.e1 && pieces.e1.type === 'k' && pieces.e1.color === 'w') {
      if (pieces.h1 && pieces.h1.type === 'r' && pieces.h1.color === 'w') c += 'K';
      if (pieces.a1 && pieces.a1.type === 'r' && pieces.a1.color === 'w') c += 'Q';
    }
    if (pieces.e8 && pieces.e8.type === 'k' && pieces.e8.color === 'b') {
      if (pieces.h8 && pieces.h8.type === 'r' && pieces.h8.color === 'b') c += 'k';
      if (pieces.a8 && pieces.a8.type === 'r' && pieces.a8.color === 'b') c += 'q';
    }
    if (!c) c = '-';
    const sans = readMoveSANs();
    if (sans.length) plyCount = sans.length;
    let active = (plyCount % 2 === 0) ? 'w' : 'b';
    if (turnFlip) active = active === 'w' ? 'b' : 'w';
    fullmove = Math.floor(plyCount / 2) + 1;
    return `${placement} ${active} ${c} - ${halfmove} ${fullmove}`;
  }

  // ================= ENGINE =================
  async function askStockfish(fen, depth) {
    const url = 'https://stockfish.online/api/s/v2.php?fen=' + encodeURIComponent(fen) + '&depth=' + depth;
    const data = await gmGet(url);
    if (data && data.success && data.bestmove && data.bestmove !== '(none)') {
      const uci = String(data.bestmove).split(/\s+/).find(t => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t));
      if (!uci) throw new Error('stockfish.online trả bestmove lạ');
      const cp = typeof data.evaluation === 'number' ? Math.round(data.evaluation * 100) : null;
      return { best: uci, top3: [{ move: uci, cp, mate: data.mate || null }], cp, mate: data.mate || null, source: 'Stockfish' };
    }
    throw new Error('stockfish.online không trả nước đi');
  }
  // Lichess Cloud Eval: CSDL nước đã phân tích sẵn (hàng triệu thế cờ), Top 3.
  async function askLichess(fen) {
    const url = 'https://lichess.org/api/cloud-eval?fen=' + encodeURIComponent(fen) + '&multiPv=3';
    const data = await gmGet(url);
    if (data && data.pvs && data.pvs.length) {
      const top3 = data.pvs.map(pv => ({
        move: String(pv.moves || '').split(' ')[0],
        cp: typeof pv.cp === 'number' ? pv.cp : null,
        mate: pv.mate || null,
      })).filter(x => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x.move));
      if (!top3.length) throw new Error('lichess cloud-eval không có nước này');
      return { best: top3[0].move, top3, cp: top3[0].cp, mate: top3[0].mate, source: 'Lichess Book' };
    }
    throw new Error('lichess cloud-eval không có nước này');
  }
  async function analyse(fen) {
    try { return await askLichess(fen); }
    catch (e) { log('Lichess book không có, dùng Stockfish:', e.message); return await askStockfish(fen, CFG.modes[mode].depth); }
  }

  // ================= ĐI QUÂN =================
  // Tọa độ ô trong hệ viewBox 0..8 của lớp SVG phủ trên bàn.
  // Không lật: x = cột (a=0..h=7), y = hàng tính từ trên (hạng 8 ở trên).
  // Lật bàn (cầm Đen): x = 7-cột, y = hạng-1.
  function squareUnit(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10);
    if (!flipped) return { x: file + 0.5, y: 8 - rank + 0.5 };
    return { x: 7 - file + 0.5, y: rank - 1 + 0.5 };
  }
  const PIECE_EMOJI = { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' };
  const PIECE_NAME = { p: 'Tốt', n: 'Mã', b: 'Tượng', r: 'Xe', q: 'Hậu', k: 'Vua' };
  function pieceLabel(uci, pieces) {
    if (!uci || uci.length < 4) return '';
    const pc = pieces ? pieces[uci.slice(0, 2)] : null;
    const em = pc ? (PIECE_EMOJI[pc.type] || '') : '';
    const nm = pc ? (PIECE_NAME[pc.type] || '') : '';
    return em + ' ' + nm + ' ' + uci.slice(0, 2) + ' → ' + uci.slice(2, 4) + (uci.length > 4 ? ' = Hậu' : '');
  }
  // Vẽ mũi tên lên bàn: nước tốt nhất = màu đã chọn, nước 2 = vàng, nước 3 = cam.
  // Không bấm quân, không di chuyển quân — chỉ vẽ để bạn tự đi theo.
  function drawArrows(moves) {
    const board = getBoardEl();
    const old = document.getElementById('xaiz-arrow-svg');
    if (old) old.remove();
    if (!board || !arrowVisible || !moves || !moves.length) return;
    if (getComputedStyle(board).position === 'static') board.style.position = 'relative';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.id = 'xaiz-arrow-svg';
    svg.setAttribute('viewBox', '0 0 8 8');
    svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:60';
    const colors = [arrowColor, '#eab308', '#f97316'];
    const widths = [0.24, 0.17, 0.14];
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    colors.forEach((c, i) => {
      const m = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      m.setAttribute('id', 'xaiz-ah' + i);
      m.setAttribute('markerWidth', '3'); m.setAttribute('markerHeight', '3');
      m.setAttribute('refX', '2'); m.setAttribute('refY', '1.5');
      m.setAttribute('orient', 'auto'); m.setAttribute('markerUnits', 'strokeWidth');
      const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      p.setAttribute('d', 'M0,0 L3,1.5 L0,3 z'); p.setAttribute('fill', c);
      m.appendChild(p); defs.appendChild(m);
    });
    svg.appendChild(defs);
    (showTop3Arrows ? moves.slice(0, 3) : moves.slice(0, 1)).forEach((uci, i) => {
      if (!uci || uci.length < 4) return;
      const a = squareUnit(uci.slice(0, 2)), b = squareUnit(uci.slice(2, 4));
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      if (i === 0) {
        [a, b].forEach((pt) => {
          const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', pt.x - 0.5); r.setAttribute('y', pt.y - 0.5);
          r.setAttribute('width', '1'); r.setAttribute('height', '1');
          r.setAttribute('fill', arrowColor); r.setAttribute('opacity', '0.35');
          svg.appendChild(r);
        });
      }
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', a.x + ux * 0.28); line.setAttribute('y1', a.y + uy * 0.28);
      line.setAttribute('x2', b.x - ux * 0.42); line.setAttribute('y2', b.y - uy * 0.42);
      line.setAttribute('stroke', colors[i]); line.setAttribute('stroke-width', widths[i]);
      line.setAttribute('stroke-linecap', 'round');
      line.setAttribute('opacity', i === 0 ? '0.95' : '0.7');
      line.setAttribute('marker-end', 'url(#xaiz-ah' + i + ')');
      svg.appendChild(line);
    });
    board.appendChild(svg);
  }

  // ================= MENU VIP MOBILE =================
  let panel, els = {};
  let curTab = 'bot';
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'xaiz-chess-bot-panel';
    panel.innerHTML = `
      <div id="xaiz-cb-head">
        <span>♟️ XAIZ VIP <span class="ver">PRO MAX v5.0</span></span>
        <span class="head-btns"><span id="xaiz-cb-min">—</span><span id="xaiz-cb-close">✕</span></span>
      </div>
      <div id="xaiz-cb-evalbar"><div id="xaiz-cb-evalfill"></div><span id="xaiz-cb-evaltxt">50%</span></div>
      <div id="xaiz-cb-tabs">
        <button data-tab="bot" class="on">🤖 BOT</button>
        <button data-tab="top3">🏆 TOP 3</button>
        <button data-tab="open">📖 MỞ CỜ</button>
        <button data-tab="set">⚙️ CÀI ĐẶT</button>
      </div>
      <div id="xaiz-cb-body">
        <div class="tabpage" data-page="bot">
          <div class="row"><span>Bạn cầm:</span><b id="xaiz-cb-mycolor">Trắng ♔</b></div>
          <div class="row"><span>Lượt đi:</span><b id="xaiz-cb-turn">—</b></div>
          <div class="row"><span>Trạng thái:</span><b id="xaiz-cb-status">Đang quét bàn…</b></div>
          <div class="bigmove"><span class="bm-label">✨ NƯỚC TỐT NHẤT</span><b id="xaiz-cb-best">—</b><small id="xaiz-cb-bestlabel">Đi theo mũi tên trên bàn</small></div>
          <div class="row"><span>Đánh giá:</span><b id="xaiz-cb-eval">—</b></div>
          <div class="row"><span>Nguồn:</span><b id="xaiz-cb-src">—</b></div>
          <div class="row small"><span>FEN:</span><code id="xaiz-cb-fen">—</code></div>
          <button id="xaiz-cb-arrow" class="bigbtn">👁 MŨI TÊN: BẬT</button>
          <div class="hist"><div class="hist-title">📜 Gợi ý vừa rồi</div><div id="xaiz-cb-hist">—</div></div>
          <div class="row small"><span>Đã hướng dẫn:</span><b id="xaiz-cb-count">0 nước</b></div>
        </div>
        <div class="tabpage" data-page="top3" style="display:none">
          <div class="note">Bấm 1 nước để chỉ vẽ mũi tên nước đó lên bàn, rồi bạn tự đi theo.</div>
          <div id="xaiz-cb-top3"></div>
        </div>
        <div class="tabpage" data-page="open" style="display:none">
          <div class="row"><span>Khai cuộc:</span><b id="xaiz-cb-opening">—</b></div>
          <div class="row small"><span>Nước mở đầu:</span><b id="xaiz-cb-openmoves">—</b></div>
          <div class="note">Sách mở cờ: 24 khai cuộc nổi tiếng (Italian, Sicilian, Ruy Lopez, London, Queen's Gambit…). Hết sách thì Lichess Book + Stockfish tính tiếp.</div>
        </div>
        <div class="tabpage" data-page="set" style="display:none">
          <button id="xaiz-cb-mode" class="bigbtn">MODE: VIP</button>
          <div class="row small"><span>Màu mũi tên tốt nhất:</span></div>
          <div class="btns colorbtns">
            <button data-color="#22c55e" style="background:#22c55e">🟢 XANH</button>
            <button data-color="#eab308" style="background:#eab308">🟡 VÀNG</button>
            <button data-color="#a855f7" style="background:#a855f7">🟣 TÍM</button>
            <button data-color="#06b6d4" style="background:#06b6d4">🔵 XANH DƯƠNG</button>
          </div>
          <div class="btns">
            <button id="xaiz-cb-top3toggle">🏆 VẼ CẢ TOP 3: BẬT</button>
          </div>
          <div class="row small"><span>Màu cờ của bạn (bấm để chọn, tool sẽ nhớ):</span></div>
          <div class="btns">
            <button id="xaiz-cb-white">♔ TÔI CẦM TRẮNG</button>
            <button id="xaiz-cb-black">♚ TÔI CẦM ĐEN</button>
          </div>
          <div class="btns">
            <button id="xaiz-cb-scan">🔍 QUÉT BÀN</button>
          </div>
          <button id="xaiz-cb-check" class="bigbtn" style="background:linear-gradient(90deg,#7c3aed,#a855f7)">✅ KIỂM TRA TOOL</button>
          <div class="note" id="xaiz-cb-checkres"></div>
          <div class="btns">
            <button id="xaiz-cb-flip">↕ ĐỔI CHIỀU BÀN</button>
            <button id="xaiz-cb-turnflip">🔄 ĐỔI LƯỢT</button>
          </div>
          <div class="btns">
            <button id="xaiz-cb-hide">👁 ẨN MENU</button>
          </div>
          <div class="note">Tool CHỈ VẼ MŨI TÊN hướng dẫn, KHÔNG tự bấm quân — bạn tự đi theo mũi tên. Mũi tên = nước tốt nhất của engine (Lichess Book + Stockfish), không thắng 100% được. Chỉ test với Bot / ván không xếp hạng, đánh rank dùng engine = khóa acc.</div>
        </div>
      </div>`;
    const st = document.createElement('style');
    st.textContent = `
      #xaiz-chess-bot-panel{position:fixed;top:10px;right:10px;z-index:999999;width:min(310px,88vw);
        background:linear-gradient(165deg,#2e1065 0%,#0f172a 45%,#111827 100%);color:#fff;border:2px solid #f59e0b;border-radius:20px;
        font-family:sans-serif;font-size:14px;box-shadow:0 0 0 2px rgba(245,158,11,.25),0 12px 40px rgba(0,0,0,.7);overflow:hidden}
      #xaiz-cb-head{background:linear-gradient(90deg,#f59e0b,#f97316,#eab308);color:#111827;font-weight:900;
        padding:12px 14px;cursor:move;display:flex;justify-content:space-between;align-items:center;font-size:16px;letter-spacing:.5px}
      #xaiz-cb-head .ver{font-size:10px;background:#111827;color:#fbbf24;border-radius:999px;padding:3px 8px;letter-spacing:1px}
      #xaiz-cb-head .head-btns span{padding:2px 8px;cursor:pointer;font-size:16px}
      #xaiz-cb-evalbar{position:relative;height:20px;background:#111827}
      #xaiz-cb-evalfill{height:100%;width:50%;background:linear-gradient(90deg,#fef3c7,#fbbf24,#f59e0b);transition:width .4s}
      #xaiz-cb-evaltxt{position:absolute;inset:0;text-align:center;font-size:11px;font-weight:800;color:#111827;line-height:20px}
      #xaiz-cb-tabs{display:flex;background:rgba(255,255,255,.06);padding:6px;gap:6px}
      #xaiz-cb-tabs button{flex:1;padding:9px 2px;border:0;background:rgba(255,255,255,.07);color:#cbd5e1;font-weight:800;font-size:12px;cursor:pointer;border-radius:999px}
      #xaiz-cb-tabs button.on{color:#111827;background:linear-gradient(90deg,#fbbf24,#f59e0b)}
      #xaiz-cb-body{padding:12px}
      #xaiz-cb-body .row{margin:5px 0;display:flex;gap:6px}
      #xaiz-cb-body .row.small{font-size:11px;word-break:break-all}
      #xaiz-cb-body .bigmove{display:flex;flex-direction:column;align-items:center;gap:2px;background:linear-gradient(160deg,rgba(245,158,11,.25),rgba(168,85,247,.2));
        border:1px solid #f59e0b;border-radius:16px;padding:14px;margin:10px 0;text-align:center}
      #xaiz-cb-body .bigmove .bm-label{font-size:11px;font-weight:900;letter-spacing:2px;color:#fbbf24}
      #xaiz-cb-body .bigmove b{font-size:30px;color:#4ade80}
      #xaiz-cb-body .bigmove small{font-size:12px;color:#e2e8f0}
      #xaiz-cb-body .bigbtn{width:100%;padding:14px;border:0;border-radius:14px;font-weight:900;font-size:15px;
        background:linear-gradient(90deg,#f59e0b,#f97316);color:#111827;cursor:pointer;margin:6px 0}
      #xaiz-cb-body .bigbtn.off{background:#374151;color:#9ca3af}
      #xaiz-cb-body .btns{display:flex;gap:6px;margin:6px 0}
      #xaiz-cb-body .btns button{flex:1;padding:10px 4px;border:0;border-radius:12px;font-weight:800;font-size:12px;background:#334155;color:#fff;cursor:pointer}
      #xaiz-cb-body .colorbtns button{color:#111827}
      #xaiz-cb-body .note{font-size:11px;color:#cbd5e1;background:rgba(255,255,255,.06);border-radius:10px;padding:8px;margin:6px 0}
      #xaiz-cb-body .hist{margin:8px 0;background:rgba(255,255,255,.06);border-radius:12px;padding:8px 10px;font-size:12px}
      #xaiz-cb-body .hist-title{font-weight:900;color:#fbbf24;font-size:11px;letter-spacing:1px;margin-bottom:4px}
      #xaiz-cb-top3 .t3{display:flex;justify-content:space-between;align-items:center;width:100%;min-height:48px;
        padding:8px 12px;border:0;border-radius:12px;background:#1e293b;color:#fff;font-weight:800;font-size:15px;cursor:pointer;margin:6px 0}
      #xaiz-cb-top3 .t3 small{color:#9ca3af;font-size:12px}`;
    document.head.appendChild(st);
    document.body.appendChild(panel);
    const q = (s) => panel.querySelector(s);
    els = {
      status: q('#xaiz-cb-status'), best: q('#xaiz-cb-best'), eval: q('#xaiz-cb-eval'),
      src: q('#xaiz-cb-src'), fen: q('#xaiz-cb-fen'), arrow: q('#xaiz-cb-arrow'),
      mode: q('#xaiz-cb-mode'), top3: q('#xaiz-cb-top3'), opening: q('#xaiz-cb-opening'),
      openmoves: q('#xaiz-cb-openmoves'), count: q('#xaiz-cb-count'),
      evalfill: q('#xaiz-cb-evalfill'), evaltxt: q('#xaiz-cb-evaltxt'),
    };
    // Tab
    panel.querySelectorAll('#xaiz-cb-tabs button').forEach((b) => {
      b.onclick = () => {
        curTab = b.dataset.tab;
        panel.querySelectorAll('#xaiz-cb-tabs button').forEach(x => x.classList.toggle('on', x === b));
        panel.querySelectorAll('.tabpage').forEach(p => { p.style.display = p.dataset.page === curTab ? '' : 'none'; });
      };
    });
    els.arrow.textContent = arrowVisible ? '👁 MŨI TÊN: BẬT' : '👁 MŨI TÊN: TẮT';
    els.arrow.classList.toggle('off', !arrowVisible);
    els.arrow.onclick = () => {
      arrowVisible = !arrowVisible; GM_setValue('xaiz_arrow', arrowVisible);
      els.arrow.textContent = arrowVisible ? '👁 MŨI TÊN: BẬT' : '👁 MŨI TÊN: TẮT';
      els.arrow.classList.toggle('off', !arrowVisible);
      if (arrowVisible) drawArrows(lastTop3.map(t => t.move)); else drawArrows([]);
      setStatus(arrowVisible ? 'Mũi tên đang BẬT — đi theo mũi tên xanh' : 'Mũi tên đã tắt');
    };
    const updTop3Btn = () => { const b = q('#xaiz-cb-top3toggle'); if (b) b.textContent = showTop3Arrows ? '🏆 VẼ CẢ TOP 3: BẬT' : '🏆 CHỈ VẼ 1 MŨI TÊN'; };
    updTop3Btn();
    q('#xaiz-cb-top3toggle').onclick = () => { showTop3Arrows = !showTop3Arrows; GM_setValue('xaiz_top3arrows', showTop3Arrows); updTop3Btn(); drawArrows(lastTop3.map(t => t.move)); };
    panel.querySelectorAll('.colorbtns button').forEach((b) => {
      b.onclick = () => { arrowColor = b.dataset.color; GM_setValue('xaiz_arrowcolor', arrowColor); drawArrows(lastTop3.map(t => t.move)); setStatus('Đã đổi màu mũi tên — đi theo mũi tên mới'); };
    });
    els.mode.textContent = 'MODE: ' + mode;
    els.mode.onclick = () => {
      const i = CFG.modeOrder.indexOf(mode);
      mode = CFG.modeOrder[(i + 1) % CFG.modeOrder.length];
      GM_setValue('xaiz_mode', mode);
      els.mode.textContent = 'MODE: ' + mode;
      lastFen = '';
    };
    q('#xaiz-cb-scan').onclick = () => { lastFen = ''; scan(true); };
    q('#xaiz-cb-check').onclick = async () => {
      const res = q('#xaiz-cb-checkres');
      const out = [];
      const read = readPieces();
      out.push(read ? ('✅ Thấy bàn cờ, ' + Object.keys(read.pieces).length + ' quân') : '❌ Chưa thấy bàn cờ — vào ván đã rồi bấm lại');
      if (read) {
        const fen = buildFen(read.pieces);
        const kings = Object.values(read.pieces).filter(pc => pc.type === 'k').length;
        out.push(kings === 2 ? ('✅ Đủ 2 vua, FEN: ' + fen) : '❌ Bàn đọc sai — thiếu vua, bấm ĐỔI CHIỀU BÀN');
        out.push('✅ Bạn cầm: ' + (myColor === 'w' ? 'Trắng' : 'Đen'));
        try { const r = await analyse(fen); out.push('✅ Engine OK (' + r.source + '): ' + r.best); }
        catch (e) { out.push('❌ Engine lỗi: ' + e.message); }
      }
      res.innerHTML = out.join('<br>');
    };
    q('#xaiz-cb-white').onclick = () => { saveColor('w'); lastFen = ''; setStatus('Đã chọn: bạn cầm Trắng, đang quét lại…'); scan(true); };
    q('#xaiz-cb-black').onclick = () => { saveColor('b'); lastFen = ''; setStatus('Đã chọn: bạn cầm Đen, đang quét lại…'); scan(true); };
    q('#xaiz-cb-flip').onclick = () => { saveColor(myColor === 'w' ? 'b' : 'w'); lastFen = ''; setStatus('Đã đổi chiều bàn, đang quét lại…'); scan(true); };
    q('#xaiz-cb-turnflip').onclick = () => { saveTurnFlip(!turnFlip); lastFen = ''; setStatus('Đã đổi lượt đi, đang quét lại…'); scan(true); };
    q('#xaiz-cb-hide').onclick = () => { panel.style.display = 'none'; showFab(); };
    q('#xaiz-cb-close').onclick = () => { panel.style.display = 'none'; showFab(); };
    q('#xaiz-cb-min').onclick = () => {
      const b = q('#xaiz-cb-body');
      b.style.display = b.style.display === 'none' ? '' : 'none';
      q('#xaiz-cb-tabs').style.display = b.style.display;
      q('#xaiz-cb-evalbar').style.display = b.style.display;
    };
    // Kéo menu bằng đầu menu (cảm ứng mobile).
    const head = q('#xaiz-cb-head');
    head.addEventListener('pointerdown', (e) => {
      const r = panel.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const mv = (ev) => { panel.style.left = (ev.clientX - dx) + 'px'; panel.style.top = (ev.clientY - dy) + 'px'; panel.style.right = 'auto'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  }
  function showFab() {
    if (document.getElementById('xaiz-cb-fab')) return;
    const fab = document.createElement('button');
    fab.id = 'xaiz-cb-fab';
    fab.textContent = '♟️';
    fab.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999999;width:52px;height:52px;border-radius:50%;border:2px solid #f59e0b;background:#111827;color:#fff;font-size:24px';
    fab.onclick = () => { panel.style.display = ''; fab.remove(); };
    document.body.appendChild(fab);
  }
  function setStatus(t) { if (els.status) els.status.textContent = t; }
  function updateStats() { if (els.count) els.count.textContent = hintMoves + ' nước'; }
  function renderTop3() {
    if (!els.top3) return;
    els.top3.innerHTML = '';
    if (!lastTop3.length) { els.top3.innerHTML = '<div class="note">Chưa có nước — bấm QUÉT BÀN trong tab CÀI ĐẶT.</div>'; return; }
    lastTop3.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = 't3';
      const pct = t.cp === null ? '—' : (winPct(myColor === 'w' ? t.cp : -t.cp) + '%');
      const mate = t.mate ? ' Mate ' + Math.abs(t.mate) : '';
      b.innerHTML = `<span>${i + 1}. ${t.move}</span><small>${mate || pct}</small>`;
      b.onclick = () => { drawArrows([t.move]); setStatus('Mũi tên đang chỉ nước: ' + t.move + ' — bạn tự đi theo mũi tên'); };
      els.top3.appendChild(b);
    });
  }
  function renderOpening() {
    if (!els.opening) return;
    if (lastOpening) {
      els.opening.textContent = lastOpening.name + ' (' + lastOpening.eco + ')';
      els.openmoves.textContent = lastOpening.moves.join(' ');
    } else {
      els.opening.textContent = 'Đã qua giai đoạn mở cờ';
      els.openmoves.textContent = '—';
    }
  }
  // ================= VÒNG QUÉT CHÍNH =================
  async function scan(manual) {
    const read = readPieces();
    if (!read) { setStatus('Chưa thấy bàn cờ — vào ván rồi bấm QUÉT BÀN'); return; }
    const { pieces } = read;
    if (Object.keys(pieces).length < 2) { setStatus('Bàn chưa tải đủ quân, đợi rồi quét lại'); return; }
    const kings = Object.values(pieces).filter(pc => pc.type === 'k').length;
    if (kings !== 2) { setStatus('Bàn đọc sai — thiếu vua (' + kings + '/2), bấm ĐỔI CHIỀU BÀN hoặc KIỂM TRA'); return; }
    const fen = buildFen(pieces);
    const sans = readMoveSANs();
    lastOpening = findOpening(sans);
    renderOpening();
    els.fen.textContent = fen;
    const mc = panel.querySelector('#xaiz-cb-mycolor');
    if (mc) mc.textContent = myColor === 'w' ? 'Trắng ♔' : 'Đen ♚';
    const tn = panel.querySelector('#xaiz-cb-turn');
    if (tn) tn.textContent = (active === 'w' ? 'Trắng ♔' : 'Đen ♚') + ' • đã đi ' + plyCount + ' nước';
    const active = fen.split(' ')[1];
    const isMyTurn = active === myColor;
    if (fen === lastFen && !manual) return;
    lastFen = fen;
    if (!isMyTurn) { drawArrows([]); setStatus('Chưa đến lượt bạn (' + (myColor === 'w' ? 'Trắng' : 'Đen') + ') — đợi đối thủ đi đã'); return; }
    if (engineBusy) return;
    engineBusy = true;
    setStatus('Engine đang tính… (' + mode + ' depth ' + CFG.modes[mode].depth + ')');
    try {
      const res = await analyse(fen);
      const reCheck = readPieces();
      if (!reCheck || buildFen(reCheck.pieces) !== fen) { engineBusy = false; return; }
      lastBest = res.best; lastTop3 = res.top3 || []; lastEvalCp = res.cp; lastMate = res.mate;
      els.best.textContent = res.best;
      const bl = panel.querySelector('#xaiz-cb-bestlabel');
      if (bl) bl.textContent = pieceLabel(res.best, pieces);
      hintHistory.unshift(res.best + ' (' + res.source + ')');
      hintHistory = hintHistory.slice(0, 3);
      const hh = panel.querySelector('#xaiz-cb-hist');
      if (hh) hh.innerHTML = hintHistory.map((h, i) => (i + 1) + '. ' + h).join('<br>');
      els.src.textContent = res.source;
      const pctW = res.cp === null ? 50 : winPct(res.cp);
      els.evalfill.style.width = pctW + '%';
      els.evaltxt.textContent = 'Trắng ' + pctW + '% thắng';
      els.eval.textContent = res.mate ? ('Chiếu hết trong ' + Math.abs(res.mate))
        : (res.cp === null ? '—' : ((res.cp > 0 ? '+' : '') + (res.cp / 100).toFixed(2) + '  •  Trắng ' + pctW + '%'));
      drawArrows(lastTop3.map(t => t.move));
      hintMoves++; updateStats();
      renderTop3();
      setStatus('Mũi tên xanh = nước tốt nhất: ' + res.best + ' (' + res.source + ') — bạn tự đi theo mũi tên');
    } catch (e) {
      setStatus('Engine lỗi: ' + e.message + ' — thử QUÉT BÀN lại');
      log('analyse lỗi', e);
    } finally { engineBusy = false; }
  }

  function init() {
    if (window.__xaizBotInterval) clearInterval(window.__xaizBotInterval);
    const old = document.getElementById('xaiz-chess-bot-panel');
    if (old) old.remove();
    const oldSvg = document.getElementById('xaiz-arrow-svg'); if (oldSvg) oldSvg.remove();
    buildPanel();
    renderTop3();
    setStatus('XAIZ VIP PRO MAX v5 đã tải — vào ván rồi bấm QUÉT BÀN, đi theo mũi tên');
    window.__xaizBotInterval = setInterval(() => { scan(false).catch(e => log('scan lỗi', e)); }, CFG.scanMs);
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'b' || e.key === 'B')) panel.style.display = panel.style.display === 'none' ? '' : 'none';
    });
    log('XAIZ Chess Hint Arrow VIP PRO MAX v5.0.0 đã tải. Mode:', mode, 'Arrow:', arrowVisible, 'Color:', arrowColor);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
