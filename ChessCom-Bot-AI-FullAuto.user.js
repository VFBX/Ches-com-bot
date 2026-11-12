// ==UserScript==
// @name         Chess.com Bot AI FULL AUTO v10 — XAIZ (Tự động toàn bộ)
// @namespace    xaiz-chess-fullauto
// @version      10.0.0
// @description  Tự động toàn bộ: tự nhận màu Trắng/Đen, tự phân tích (engine local + Lichess + Stockfish), tự đi, tự mở ván mới. Chỉ 1 viên thuốc nhỏ + 1 bảng cài đặt gọn — đã bỏ hết tab, TOP 3, lịch sử, sách hiển thị, chọn màu mũi tên, đổi lượt tay.
// @author       XAIZ
// @match        https://www.chess.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_xmlhttpRequest
// @connect      lichess.org
// @connect      stockfish.online
// ==/UserScript==

(function () {
  'use strict';
  // 1 file chạy được cả Tampermonkey lẫn dán Console: có GM_* thì dùng GM_*, không có thì dùng localStorage/fetch.
  const __storeGet = (k, d) => {
    try { if (typeof GM_getValue === 'function') return GM_getValue(k, d); } catch (e) {}
    try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
  };
  const __storeSet = (k, v) => {
    try { if (typeof GM_setValue === 'function') { GM_setValue(k, v); return; } } catch (e) {}
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  };
  // ================= TRẠNG THÁI (chỉ giữ thứ thật sự cần) =================
  let mode = __storeGet('xaiz_mode', 'VIP');
  let autoMove = __storeGet('xaiz_auto', true);       // TỰ ĐI mặc định BẬT
  let arrowVisible = __storeGet('xaiz_arrow', true);  // Mũi tên mặc định BẬT
  let botOnly = __storeGet('xaiz_botonly', true);     // Chỉ ván Bot (chống ban)
  let bulletMode = __storeGet('xaiz_bullet', false);  // Trận 1 phút: quét 300ms, chỉ engine local
  let autoNext = __storeGet('xaiz_autonext', true);   // Tự mở ván mới sau khi xong 1 ván
  const fenCache = new Map(); // thế cờ đã tính: gặp lại lấy ngay
  let lastAnalyseAt = 0;
  let flipped = false;
  let myColor = 'w';
  let lastFen = '';
  let lastBest = '';
  let engineBusy = false;
  let plyCount = 0;
  let halfmove = 0, fullmove = 1;
  let botMoves = 0;

  const CFG = {
    modes: {
      TURBO: { depth: 2,  delayMin: 300,  delayMax: 600,  label: 'TURBO' },
      LEGIT: { depth: 3, delayMin: 1800, delayMax: 3200, label: 'LEGIT' },
      VIP:   { depth: 3, delayMin: 800,  delayMax: 1500, label: 'VIP' },
      RAGE:  { depth: 4, delayMin: 300,  delayMax: 600,  label: 'RAGE' },
    },
    modeOrder: ['TURBO', 'LEGIT', 'VIP', 'RAGE'],
    scanMs: 700,
    minApiGapMs: 1200, // giãn nhịp gọi API tối thiểu: chống spam, chống ban
    cacheMax: 200,
    apiTimeoutMs: 12000,
  };
  const FILES = 'abcdefgh';
  const PIECE_LETTER = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const log = (...a) => console.log('[XAIZ Chess FULL AUTO v10]', ...a);
  function gmGet(url) {
    if (typeof GM_xmlhttpRequest === 'function') {
      return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
          method: 'GET', url, timeout: CFG.apiTimeoutMs,
          onload: (res) => { try { resolve(JSON.parse(res.responseText)); } catch (e) { reject(e); } },
          onerror: (e) => reject(e), ontimeout: () => reject(new Error('timeout')),
        });
      });
    }
    return fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  }
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
    flipped = detectFlipped(board); myColor = flipped ? 'b' : 'w'; // Tự nhận màu: bàn lật (Đen ở dưới) = cầm Đen, đổi ván tự nhận lại
    let pieces = parsePieces(board, flipped);
    // Tự hiệu chỉnh: nếu vua trắng lại ở hạng 8 và vua đen ở hạng 1 thì chiều
    // bàn đang bị đảo -> đọc lại với chiều ngược lại.
    const wk = Object.keys(pieces).find(sq => pieces[sq].type === 'k' && pieces[sq].color === 'w');
    const bk = Object.keys(pieces).find(sq => pieces[sq].type === 'k' && pieces[sq].color === 'b');
    if (wk && bk && parseInt(wk[1], 10) >= 7 && parseInt(bk[1], 10) <= 2) {
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
  // ============ XAIZ ENGINE: cờ vua chạy NGAY TRÊN MÁY, không cần mạng ============
  // Đã kiểm chứng bằng Node: nước hợp lệ đầu ván = 20, perft(2)=400, perft(3)=8902,
  // Kiwipete perft(2)=2039, chiếu hết kiểu Fool's Mate tìm đúng Qh4. Depth 3 ~100-160ms.
  // XAIZ ENGINE — cờ vua chạy ngay trên máy (không mạng), dùng cho Hint Arrow v7
  // Bàn bd[r][c]: r=0 là hạng 8 (trên), c=0 là cột a. Quân {t, c}. Test bằng Node.
    const XE_VAL = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };
    const XE_PST = {
    p: [0,0,0,0,0,0,0,0, 50,50,50,50,50,50,50,50, 10,10,20,30,30,20,10,10, 5,5,10,25,25,10,5,5, 0,0,0,20,20,0,0,0, 5,-5,-10,0,0,-10,-5,5, 5,10,10,-20,-20,10,10,5, 0,0,0,0,0,0,0,0],
    n: [-50,-40,-30,-30,-30,-30,-40,-50, -40,-20,0,0,0,0,-20,-40, -30,0,10,15,15,10,0,-30, -30,5,15,20,20,15,5,-30, -30,0,15,20,20,15,0,-30, -30,5,10,15,15,10,5,-30, -40,-20,0,5,5,0,-20,-40, -50,-40,-30,-30,-30,-30,-40,-50],
    b: [-20,-10,-10,-10,-10,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,10,10,5,0,-10, -10,5,5,10,10,5,5,-10, -10,0,10,10,10,10,0,-10, -10,10,10,10,10,10,10,-10, -10,5,0,0,0,0,5,-10, -20,-10,-10,-10,-10,-10,-10,-20],
    r: [0,0,0,0,0,0,0,0, 5,10,10,10,10,10,10,5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, -5,0,0,0,0,0,0,-5, 0,0,0,5,5,0,0,0],
    q: [-20,-10,-10,-5,-5,-10,-10,-20, -10,0,0,0,0,0,0,-10, -10,0,5,5,5,5,0,-10, -5,0,5,5,5,5,0,-5, 0,0,5,5,5,5,0,-5, -10,5,5,5,5,5,0,-10, -10,0,5,0,0,0,0,-10, -20,-10,-10,-5,-5,-10,-10,-20],
    k: [-30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -30,-40,-40,-50,-50,-40,-40,-30, -20,-30,-30,-40,-40,-30,-30,-20, -10,-20,-20,-20,-20,-20,-20,-10, 20,20,0,0,0,0,20,20, 20,30,10,0,0,10,30,20],
  };
  const XE_FILES = 'abcdefgh';
  const xeSq = (r, c) => XE_FILES[c] + String(8 - r);
  const xeUci = (m) => xeSq(m.fr, m.fc) + xeSq(m.tr, m.tc) + (m.promo || '');

  function xeParseFen(fen) {
    const parts = fen.trim().split(/\s+/);
    const rows = parts[0].split('/');
    const bd = [];
    for (let r = 0; r < 8; r++) {
      const row = [];
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { for (let i = 0; i < +ch; i++) row.push(null); }
        else row.push({ t: ch.toLowerCase(), c: ch === ch.toUpperCase() ? 'w' : 'b' });
      }
      bd.push(row);
    }
    const side = parts[1] || 'w';
    const cast = parts[2] || '-';
    let ep = null;
    if (parts[3] && parts[3] !== '-') ep = { r: 8 - parseInt(parts[3][1], 10), c: XE_FILES.indexOf(parts[3][0]) };
    return { bd, side, cast, ep };
  }
  function xeClone(st) {
    return { bd: st.bd.map(row => row.map(p => p ? { t: p.t, c: p.c } : null)), side: st.side, cast: st.cast, ep: st.ep ? { r: st.ep.r, c: st.ep.c } : null };
  }
  function xeAttacked(bd, r, c, by) {
    const inB = (rr, cc) => rr >= 0 && rr < 8 && cc >= 0 && cc < 8;
    // Tốt: tốt trắng tấn công từ hàng dưới (r+1), tốt đen từ hàng trên (r-1)
    const pr = by === 'w' ? r + 1 : r - 1;
    for (const dc of [-1, 1]) {
      if (inB(pr, c + dc)) { const p = bd[pr][c + dc]; if (p && p.c === by && p.t === 'p') return true; }
    }
    for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
      if (inB(r+dr, c+dc)) { const p = bd[r+dr][c+dc]; if (p && p.c === by && p.t === 'n') return true; }
    }
    for (const [dr, dc] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
      if (inB(r+dr, c+dc)) { const p = bd[r+dr][c+dc]; if (p && p.c === by && p.t === 'k') return true; }
    }
    const rays = [[[-1,0],[1,0],[0,-1],[0,1]], 'r', [[-1,-1],[-1,1],[1,-1],[1,1]], 'b'];
    for (let i = 0; i < rays.length; i += 2) {
      for (const [dr, dc] of rays[i]) {
        let rr = r + dr, cc = c + dc;
        while (inB(rr, cc)) {
          const p = bd[rr][cc];
          if (p) { if (p.c === by && (p.t === rays[i+1] || p.t === 'q')) return true; break; }
          rr += dr; cc += dc;
        }
      }
    }
    return false;
  }
  function xeKingPos(bd, color) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (p && p.t === 'k' && p.c === color) return { r, c };
    }
    return null;
  }
  function xePseudo(st) {
    const { bd, side, cast, ep } = st;
    const moves = [];
    const enemy = side === 'w' ? 'b' : 'w';
    const dir = side === 'w' ? -1 : 1;
    const startRow = side === 'w' ? 6 : 1;
    const promoRow = side === 'w' ? 0 : 7;
    const add = (fr, fc, tr, tc, promo) => moves.push({ fr, fc, tr, tc, promo: promo || null });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (!p || p.c !== side) continue;
      if (p.t === 'p') {
        const r1 = r + dir;
        if (r1 >= 0 && r1 < 8 && !bd[r1][c]) {
          if (r1 === promoRow) { for (const pr of ['q','r','b','n']) add(r, c, r1, c, pr); }
          else {
            add(r, c, r1, c);
            const r2 = r + 2 * dir;
            if (r === startRow && !bd[r2][c]) add(r, c, r2, c);
          }
        }
        for (const dc of [-1, 1]) {
          const cc = c + dc;
          if (cc < 0 || cc > 7 || r1 < 0 || r1 > 7) continue;
          const t = bd[r1][cc];
          if (t && t.c === enemy) {
            if (r1 === promoRow) { for (const pr of ['q','r','b','n']) add(r, c, r1, cc, pr); }
            else add(r, c, r1, cc);
          } else if (ep && ep.r === r1 && ep.c === cc) add(r, c, r1, cc);
        }
      } else if (p.t === 'n' || p.t === 'k') {
        const offs = p.t === 'n'
          ? [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]
          : [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
        for (const [dr, dc] of offs) {
          const rr = r + dr, cc = c + dc;
          if (rr < 0 || rr > 7 || cc < 0 || cc > 7) continue;
          const t = bd[rr][cc];
          if (!t || t.c === enemy) add(r, c, rr, cc);
        }
        if (p.t === 'k') {
          const home = side === 'w' ? 7 : 0;
          if (r === home && c === 4) {
            const K = side === 'w' ? 'K' : 'k', Q = side === 'w' ? 'Q' : 'q';
            if (cast.includes(K) && !bd[home][5] && !bd[home][6] && bd[home][7] && bd[home][7].t === 'r' && bd[home][7].c === side
              && !xeAttacked(bd, home, 4, enemy) && !xeAttacked(bd, home, 5, enemy) && !xeAttacked(bd, home, 6, enemy))
              moves.push({ fr: r, fc: c, tr: home, tc: 6, promo: null, castle: K });
            if (cast.includes(Q) && !bd[home][3] && !bd[home][2] && !bd[home][1] && bd[home][0] && bd[home][0].t === 'r' && bd[home][0].c === side
              && !xeAttacked(bd, home, 4, enemy) && !xeAttacked(bd, home, 3, enemy) && !xeAttacked(bd, home, 2, enemy))
              moves.push({ fr: r, fc: c, tr: home, tc: 2, promo: null, castle: Q });
          }
        }
      } else {
        const dirs = p.t === 'r' ? [[-1,0],[1,0],[0,-1],[0,1]]
          : p.t === 'b' ? [[-1,-1],[-1,1],[1,-1],[1,1]]
          : [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]];
        for (const [dr, dc] of dirs) {
          let rr = r + dr, cc = c + dc;
          while (rr >= 0 && rr < 8 && cc >= 0 && cc < 8) {
            const t = bd[rr][cc];
            if (!t) add(r, c, rr, cc);
            else { if (t.c === enemy) add(r, c, rr, cc); break; }
            rr += dr; cc += dc;
          }
        }
      }
    }
    return moves;
  }
  function xeMake(st, m) {
    const ns = xeClone(st);
    const pc = ns.bd[m.fr][m.fc];
    ns.bd[m.fr][m.fc] = null;
    // Ăn tốt qua đường (en passant): tốt bị ăn nằm sau ô đến
    if (pc.t === 'p' && st.ep && m.tr === st.ep.r && m.tc === st.ep.c && !st.bd[m.tr][m.tc]) ns.bd[m.fr][m.tc] = null;
    ns.bd[m.tr][m.tc] = { t: m.promo || pc.t, c: pc.c };
    if (m.castle) {
      const home = pc.c === 'w' ? 7 : 0;
      if (m.tc === 6) { ns.bd[home][5] = ns.bd[home][7]; ns.bd[home][7] = null; }
      else { ns.bd[home][3] = ns.bd[home][0]; ns.bd[home][0] = null; }
    }
    // Cập nhật quyền nhập thành
    let cast = ns.cast;
    if (pc.t === 'k') cast = cast.replace(pc.c === 'w' ? /[KQ]/g : /[kq]/g, '');
    if (m.fr === 7 && m.fc === 0) cast = cast.replace('Q', '');
    if (m.fr === 7 && m.fc === 7) cast = cast.replace('K', '');
    if (m.fr === 0 && m.fc === 0) cast = cast.replace('q', '');
    if (m.fr === 0 && m.fc === 7) cast = cast.replace('k', '');
    if (m.tr === 7 && m.tc === 0) cast = cast.replace('Q', '');
    if (m.tr === 7 && m.tc === 7) cast = cast.replace('K', '');
    if (m.tr === 0 && m.tc === 0) cast = cast.replace('q', '');
    if (m.tr === 0 && m.tc === 7) cast = cast.replace('k', '');
    ns.cast = cast === '' ? '-' : cast;
    ns.ep = (pc.t === 'p' && Math.abs(m.tr - m.fr) === 2) ? { r: (m.fr + m.tr) / 2, c: m.fc } : null;
    ns.side = st.side === 'w' ? 'b' : 'w';
    return ns;
  }
  function xeLegal(st) {
    const out = [];
    for (const m of xePseudo(st)) {
      const ns = xeMake(st, m);
      const kp = xeKingPos(ns.bd, st.side);
      if (kp && !xeAttacked(ns.bd, kp.r, kp.c, ns.side)) out.push(m);
    }
    return out;
  }
  function xeEval(bd) {
    let s = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (!p) continue;
      const idx = r * 8 + c, midx = (7 - r) * 8 + c;
      if (p.c === 'w') s += XE_VAL[p.t] + XE_PST[p.t][idx];
      else s -= XE_VAL[p.t] + XE_PST[p.t][midx];
    }
    return s;
  }
  const XE_MATE = 100000;
  function xeNegamax(st, depth, alpha, beta, ply) {
    if (depth === 0) return (st.side === 'w' ? 1 : -1) * xeEval(st.bd);
    const moves = xeLegal(st);
    if (!moves.length) {
      const kp = xeKingPos(st.bd, st.side);
      const inCheck = kp && xeAttacked(st.bd, kp.r, kp.c, st.side === 'w' ? 'b' : 'w');
      return inCheck ? -XE_MATE + ply : 0;
    }
    // Xếp nước ăn quân trước (MVV-LVA) để cắt tỉa nhanh hơn
    moves.sort((a, b) => {
      const va = st.bd[a.tr][a.tc] ? XE_VAL[st.bd[a.tr][a.tc].t] : 0;
      const vb = st.bd[b.tr][b.tc] ? XE_VAL[st.bd[b.tr][b.tc].t] : 0;
      return vb - va;
    });
    let best = -Infinity;
    for (const m of moves) {
      const sc = -xeNegamax(xeMake(st, m), depth - 1, -beta, -alpha, ply + 1);
      if (sc > best) best = sc;
      if (best > alpha) alpha = best;
      if (alpha >= beta) break;
    }
    return best;
  }
  function xeAnalyse(fen, depth) {
    const st = xeParseFen(fen);
    const moves = xeLegal(st);
    if (!moves.length) return null;
    moves.sort((a, b) => {
      const va = st.bd[a.tr][a.tc] ? XE_VAL[st.bd[a.tr][a.tc].t] : 0;
      const vb = st.bd[b.tr][b.tc] ? XE_VAL[st.bd[b.tr][b.tc].t] : 0;
      return vb - va;
    });
    let bestMove = null, bestScore = -Infinity;
    for (const m of moves) {
      const sc = -xeNegamax(xeMake(st, m), depth - 1, -Infinity, Infinity, 1);
      if (sc > bestScore) { bestScore = sc; bestMove = m; }
    }
    // cp theo Trắng (như Lichess), mate: số nước chiếu hết (dương = Trắng chiếu hết)
    const cp = st.side === 'w' ? bestScore : -bestScore;
    let mate = null;
    if (bestScore > XE_MATE - 1000) mate = Math.ceil((XE_MATE - bestScore) / 2) * (st.side === 'w' ? 1 : -1);
    else if (bestScore < -XE_MATE + 1000) mate = -Math.ceil((XE_MATE + bestScore) / 2) * (st.side === 'w' ? 1 : -1);
    return { best: xeUci(bestMove), top3: [{ move: xeUci(bestMove), cp, mate }], cp, mate, source: 'XAIZ local' };
  }
  async function analyse(fen) {
    // Gặp lại thế cờ đã tính: lấy ngay từ cache, không gọi API -> nhanh tức thì.
    if (fenCache.has(fen)) return fenCache.get(fen);
    // 1) Engine chạy ngay trên máy: tức thì (~0.1s), không mạng — tốt nhất cho trận 1 phút.
    try {
      const local = xeAnalyse(fen, CFG.modes[mode].depth);
      if (local && local.best) {
        if (fenCache.size >= CFG.cacheMax) fenCache.delete(fenCache.keys().next().value);
        fenCache.set(fen, local);
        return local;
      }
    } catch (e) { log('engine local lỗi, dùng mạng:', e.message); }
    if (bulletMode) throw new Error('BULLET: chỉ dùng engine local, không gọi mạng');
    // 2) Mạng: Lichess Cloud Eval -> Stockfish (chỉ khi không phải BULLET).
    const gap = Date.now() - lastAnalyseAt;
    if (gap < CFG.minApiGapMs) await sleep(CFG.minApiGapMs - gap);
    lastAnalyseAt = Date.now();
    let res;
    try { res = await askLichess(fen); }
    catch (e) {
      log('Lichess book không có, dùng Stockfish:', e.message);
      try { res = await askStockfish(fen, CFG.modes[mode].depth); }
      catch (e2) { await sleep(800); res = await askStockfish(fen, CFG.modes[mode].depth); }
    }
    if (fenCache.size >= CFG.cacheMax) fenCache.delete(fenCache.keys().next().value);
    fenCache.set(fen, res);
    return res;
  }

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
    const colors = ['#22c55e']; // FULL AUTO: chỉ 1 mũi tên xanh duy nhất
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
    moves.slice(0, 1).forEach((uci, i) => {
      if (!uci || uci.length < 4) return;
      const a = squareUnit(uci.slice(0, 2)), b = squareUnit(uci.slice(2, 4));
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      if (i === 0) {
        [a, b].forEach((pt) => {
          const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          r.setAttribute('x', pt.x - 0.5); r.setAttribute('y', pt.y - 0.5);
          r.setAttribute('width', '1'); r.setAttribute('height', '1');
          r.setAttribute('fill', '#22c55e'); r.setAttribute('opacity', '0.35');
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

  // ================= BẤM QUÂN (BOT TỰ ĐI) =================
  // Bấm ô theo tọa độ hiển thị trên màn hình (tính theo chiều bàn hiện tại).
  function squareCenterPoint(board, sq) {
    const r = board.getBoundingClientRect();
    const file = FILES.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10);
    let col, row;
    if (!flipped) { col = file; row = 8 - rank; } else { col = 7 - file; row = rank - 1; }
    return { x: r.left + (col + 0.5) * (r.width / 8), y: r.top + (row + 0.5) * (r.height / 8) };
  }
  function squareToXY(sq) {
    const file = FILES.indexOf(sq[0]);
    const rank = parseInt(sq[1], 10);
    return { x: file + 1, y: rank };
  }
  function fireClickAt(x, y) {
    const el = document.elementFromPoint(x, y) || document.body;
    const opts = { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, pointerId: 1, isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }
  function clickSquare(board, sq) {
    const xy = squareToXY(sq);
    const el = board.querySelector('.square-' + xy.x + '' + xy.y);
    if (el) { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); el.click(); return true; }
    const pt = squareCenterPoint(board, sq);
    fireClickAt(pt.x, pt.y);
    return true;
  }
  async function playMove(uci) {
    const board = getBoardEl();
    if (!board || !uci || uci.length < 4) return false;
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4, 5);
    clickSquare(board, from);
    await sleep(rand(120, 260));
    clickSquare(board, to);
    await sleep(400);
    if (promo) {
      const qBtn = document.querySelector('[data-test-element="promotion-piece-q"], .promotion-piece.q, [class*="promotion"] [class*="q"]');
      if (qBtn) { qBtn.click(); await sleep(300); }
    }
    return true;
  }


  // ================= GIAO DIỆN: 1 VIÊN THUỐC NHỎ, KHÔNG CHE BÀN =================
  let pill, pillText, sheet;
  function buildUI() {
    pill = document.createElement('div');
    pill.id = 'xaiz-fa-pill';
    pill.innerHTML = '<span>🤖 XAIZ</span><span id="xaiz-fa-text">Đang tải…</span><span id="xaiz-fa-gear">⚙️</span>';
    const st = document.createElement('style');
    st.textContent = `
      #xaiz-fa-pill{position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:1000000;
        display:flex;align-items:center;gap:8px;max-width:94vw;
        background:rgba(17,24,39,.92);color:#fff;border:2px solid #f59e0b;border-radius:999px;
        padding:8px 14px;font-family:sans-serif;font-size:13px;font-weight:700;
        box-shadow:0 4px 20px rgba(0,0,0,.5);cursor:move;white-space:nowrap;overflow:hidden}
      #xaiz-fa-pill #xaiz-fa-text{overflow:hidden;text-overflow:ellipsis}
      #xaiz-fa-pill #xaiz-fa-gear{cursor:pointer}
      #xaiz-fa-sheet{position:fixed;top:52px;left:50%;transform:translateX(-50%);z-index:1000000;width:min(280px,92vw);
        background:#111827;color:#fff;border:2px solid #f59e0b;border-radius:16px;padding:12px;
        font-family:sans-serif;font-size:13px;display:none;box-shadow:0 12px 40px rgba(0,0,0,.7)}
      #xaiz-fa-sheet button{width:100%;padding:11px;border:0;border-radius:12px;font-weight:800;font-size:13px;
        background:linear-gradient(90deg,#f59e0b,#f97316);color:#111827;cursor:pointer;margin:5px 0}
      #xaiz-fa-sheet button.off{background:#374151;color:#9ca3af}
      #xaiz-fa-sheet .note{font-size:11px;color:#cbd5e1;margin-top:6px}
      #xaiz-fa-sheet .check{font-size:11px;color:#4ade80;margin-top:6px;white-space:pre-line}`;
    document.head.appendChild(st);
    document.body.appendChild(pill);
    sheet = document.createElement('div');
    sheet.id = 'xaiz-fa-sheet';
    sheet.innerHTML = `
      <div style="font-weight:900;margin-bottom:6px">🤖 XAIZ FULL AUTO v10</div>
      <button id="xaiz-fa-auto">🤖 TỰ ĐI: BẬT</button>
      <button id="xaiz-fa-arrow">👁 MŨI TÊN: BẬT</button>
      <button id="xaiz-fa-mode">MODE: VIP</button>
      <button id="xaiz-fa-bullet">⚡ BULLET 1 PHÚT: TẮT</button>
      <button id="xaiz-fa-next">🔁 VÁN MỚI TỰ ĐỘNG: BẬT</button>
      <button id="xaiz-fa-test">🎯 ĐI 1 NƯỚC (thử)</button>
      <button id="xaiz-fa-check">✅ KIỂM TRA TOOL</button>
      <div class="check" id="xaiz-fa-checkres"></div>
      <div class="note">Tự động toàn bộ: tự nhận màu, tự phân tích, tự đi, tự mở ván mới. Chỉ test với Bot / ván không xếp hạng, acc phụ — đánh rank bằng engine = khóa acc, không chống ban 100%.</div>
      <div class="note">📦 GitHub: VFBX/Ches-com-bot — file ChessCom-Bot-AI-FullAuto.user.js (Tampermonkey) và ChessCom-Bot-AI-FullAuto-Console.js (dán Console).</div>`;
    document.body.appendChild(sheet);
    const q = (s) => sheet.querySelector(s);
    pillText = pill.querySelector('#xaiz-fa-text');
    const upd = () => {
      q('#xaiz-fa-auto').textContent = autoMove ? '🤖 TỰ ĐI: BẬT' : '🤖 TỰ ĐI: TẮT';
      q('#xaiz-fa-auto').classList.toggle('off', !autoMove);
      q('#xaiz-fa-arrow').textContent = arrowVisible ? '👁 MŨI TÊN: BẬT' : '👁 MŨI TÊN: TẮT';
      q('#xaiz-fa-arrow').classList.toggle('off', !arrowVisible);
      q('#xaiz-fa-mode').textContent = 'MODE: ' + mode;
      q('#xaiz-fa-bullet').textContent = bulletMode ? '⚡ BULLET 1 PHÚT: BẬT' : '⚡ BULLET 1 PHÚT: TẮT';
      q('#xaiz-fa-bullet').classList.toggle('off', !bulletMode);
      q('#xaiz-fa-next').textContent = autoNext ? '🔁 VÁN MỚI TỰ ĐỘNG: BẬT' : '🔁 VÁN MỚI TỰ ĐỘNG: TẮT';
      q('#xaiz-fa-next').classList.toggle('off', !autoNext);
    };
    upd();
    q('#xaiz-fa-auto').onclick = () => { autoMove = !autoMove; __storeSet('xaiz_auto', autoMove); upd(); setPill(autoMove ? 'TỰ ĐI đã BẬT — Bot tự chơi hết' : 'TỰ ĐI đã tắt — chỉ vẽ mũi tên'); };
    q('#xaiz-fa-arrow').onclick = () => { arrowVisible = !arrowVisible; __storeSet('xaiz_arrow', arrowVisible); upd(); if (arrowVisible && lastBest) drawArrows([lastBest]); else drawArrows([]); };
    q('#xaiz-fa-mode').onclick = () => { const i = CFG.modeOrder.indexOf(mode); mode = CFG.modeOrder[(i + 1) % CFG.modeOrder.length]; __storeSet('xaiz_mode', mode); upd(); lastFen = ''; };
    q('#xaiz-fa-bullet').onclick = () => {
      bulletMode = !bulletMode; __storeSet('xaiz_bullet', bulletMode);
      if (bulletMode) { botOnly = false; __storeSet('xaiz_botonly', false); }
      upd(); restartInterval(); lastFen = '';
      setPill(bulletMode ? 'BULLET đã BẬT: chỉ engine local, quét 300ms — chỉ acc phụ, ván không xếp hạng!' : 'BULLET đã tắt');
    };
    q('#xaiz-fa-next').onclick = () => { autoNext = !autoNext; __storeSet('xaiz_autonext', autoNext); upd(); };
    q('#xaiz-fa-test').onclick = async () => {
      if (!lastBest) { setPill('Chưa có nước tốt nhất — đợi Bot tính xong đã'); return; }
      setPill('Bot đi thử: ' + lastBest);
      await playMove(lastBest);
    };
    q('#xaiz-fa-check').onclick = async () => {
      const res = q('#xaiz-fa-checkres');
      const out = ['🔖 Bản v10.0.0 FULL AUTO — GitHub: VFBX/Ches-com-bot'];
      try { const t = xeAnalyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 2); out.push(t && t.best ? ('✅ Engine local OK: ' + t.best) : '❌ Engine local không ra nước'); }
      catch (e) { out.push('❌ Engine local lỗi: ' + e.message); }
      const read = readPieces();
      out.push(read ? ('✅ Thấy bàn cờ: ' + Object.keys(read.pieces).length + ' quân, bạn cầm ' + (myColor === 'w' ? 'Trắng' : 'Đen')) : '❌ Chưa thấy bàn cờ — vào ván Bot rồi bấm lại');
      out.push('⚙️ Mode: ' + mode + ' • Tự đi: ' + (autoMove ? 'BẬT' : 'TẮT') + ' • Ván mới tự động: ' + (autoNext ? 'BẬT' : 'TẮT') + ' • Bot đã đi: ' + botMoves + ' nước');
      res.textContent = out.join('\n');
    };
    pill.querySelector('#xaiz-fa-gear').onclick = (e) => { e.stopPropagation(); sheet.style.display = sheet.style.display === 'none' ? 'block' : 'none'; };
    pill.addEventListener('pointerdown', (e) => {
      if (e.target.id === 'xaiz-fa-gear') return;
      const r = pill.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const mv = (ev) => { pill.style.left = (ev.clientX - dx) + 'px'; pill.style.top = (ev.clientY - dy) + 'px'; pill.style.transform = 'none'; };
      const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up);
    });
  }
  function setPill(t) { if (pillText) pillText.textContent = t; }

  // ================= TỰ ĐỘNG VÁN MỚI =================
  function isGameOver() {
    const list = document.querySelector('[data-test-element="move-list"], .vertical-move-list, .move-list');
    const t = list ? (list.textContent || '') : '';
    if (/(1-0|0-1|1\/2-1\/2)\s*$/.test(t.trim())) return true;
    return !!Array.from(document.querySelectorAll('button')).find(b =>
      b.offsetParent !== null && /^(new game|rematch|play again|chơi lại|ván mới)$/i.test((b.textContent || '').trim()));
  }
  function findNextGameButton() {
    for (const b of Array.from(document.querySelectorAll('button'))) {
      const t = (b.textContent || '').trim();
      if (!t || b.offsetParent === null) continue;
      if (/^(new game|rematch|play again|chơi lại|ván mới|new match)$/i.test(t)) return b;
    }
    return null;
  }

  // ================= VÒNG QUÉT CHÍNH: TỰ ĐỘNG TOÀN BỘ =================
  async function scan(manual) {
    try { await scanInner(manual); }
    catch (e) { setPill('Lỗi quét: ' + e.message); log('scan lỗi', e); }
  }
  async function scanInner(manual) {
    if (botOnly && !location.pathname.includes('/play/computer')) {
      drawArrows([]); setPill('Chỉ chạy ở ván Bot — vào Chơi với Bot'); return;
    }
    // Tự động ván mới sau khi xong 1 ván (chỉ khi đã có kết quả + có nút ván mới).
    if (autoNext && isGameOver()) {
      const nb = findNextGameButton();
      if (nb) {
        setPill('Ván xong — tự mở ván mới…');
        await sleep(1500);
        nb.click();
        lastFen = ''; lastBest = ''; drawArrows([]);
        await sleep(1500);
        return;
      }
    }
    const read = readPieces();
    if (!read) { setPill('Chưa thấy bàn cờ — vào ván Bot rồi đợi'); return; }
    const { pieces } = read;
    if (Object.keys(pieces).length < 2) { setPill('Bàn chưa tải đủ quân…'); return; }
    const kings = Object.values(pieces).filter(pc => pc.type === 'k').length;
    if (kings !== 2) { setPill('Bàn đọc sai — thiếu vua (' + kings + '/2)'); return; }
    const fen = buildFen(pieces);
    const active = fen.split(' ')[1];
    const isMyTurn = active === myColor;
    if (fen === lastFen && !manual) return;
    lastFen = fen;
    if (!isMyTurn) { drawArrows([]); setPill('Đợi đối thủ… (bạn cầm ' + (myColor === 'w' ? 'Trắng ♔' : 'Đen ♚') + ')'); return; }
    if (engineBusy) return;
    engineBusy = true;
    try {
      const res = await analyse(fen);
      if (!res || !res.best) { setPill('Engine chưa ra nước — đợi…'); return; }
      const reCheck = readPieces();
      if (!reCheck || buildFen(reCheck.pieces) !== fen) return;
      lastBest = res.best;
      drawArrows([res.best]);
      setPill('🤖 ' + pieceLabel(res.best, pieces) + ' • ' + res.source);
      if (autoMove) {
        const d = rand(CFG.modes[mode].delayMin, CFG.modes[mode].delayMax);
        await sleep(d);
        const reCheck2 = readPieces();
        if (reCheck2 && buildFen(reCheck2.pieces) === fen && lastBest === res.best) {
          await playMove(res.best);
          botMoves++;
          setPill('🤖 Đã đi ' + res.best + ' — đợi đối thủ…');
        }
      }
    } catch (e) {
      setPill('Engine lỗi: ' + e.message + ' — đợi quét lại');
      log('analyse lỗi', e);
    } finally { engineBusy = false; }
  }
  function restartInterval() {
    if (window.__xaizFaInterval) clearInterval(window.__xaizFaInterval);
    window.__xaizFaInterval = setInterval(() => { scan(false).catch(e => log('scan lỗi', e)); }, bulletMode ? 300 : CFG.scanMs);
  }
  function init() {
    if (window.__xaizFaInterval) clearInterval(window.__xaizFaInterval);
    const oldP = document.getElementById('xaiz-fa-pill'); if (oldP) oldP.remove();
    const oldS = document.getElementById('xaiz-fa-sheet'); if (oldS) oldS.remove();
    const oldA = document.getElementById('xaiz-arrow-svg'); if (oldA) oldA.remove();
    buildUI();
    setPill('XAIZ FULL AUTO v10 — đang tự kiểm tra engine…');
    try {
      const t = xeAnalyse('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', 2);
      if (t && t.best) setPill('✅ Engine OK (' + t.best + ') — vào ván Bot, Bot tự chơi hết');
      else setPill('⚠️ Engine chưa chạy, sẽ dùng mạng');
    } catch (e) { setPill('⚠️ Engine lỗi, sẽ dùng mạng'); log('tự kiểm tra engine lỗi', e); }
    restartInterval();
    if (window.__xaizFaWatchdog) clearInterval(window.__xaizFaWatchdog);
    window.__xaizFaWatchdog = setInterval(() => {
      if (!document.getElementById('xaiz-fa-pill')) { buildUI(); setPill('Panel đã tự hồi phục'); lastFen = ''; }
    }, 5000);
    log('XAIZ Chess FULL AUTO v10.0.0 đã tải. Mode:', mode, 'Auto:', autoMove, 'AutoNext:', autoNext);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
