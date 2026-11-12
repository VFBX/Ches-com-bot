// ==UserScript==
// @name         Chess.com Bot AI - XAIZ TOOL
// @namespace    https://github.com/VFBX/chess-com-bot
// @version      1.0.0
// @description  Bot AI cho Chess.com: đọc bàn cờ trên web, Stockfish tính nước tốt nhất, hiện panel ngoài màn hình, tự đi quân khi đến lượt bạn. Chỉ dùng để test với Bot / ván không xếp hạng.
// @author       XAIZ
// @match        https://www.chess.com/play/*
// @match        https://www.chess.com/game/*
// @match        https://www.chess.com/live*
// @match        https://www.chess.com/daily*
// @connect      stockfish.online
// @connect      lichess.org
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==
/*
  CHESS.COM BOT AI - XAIZ TOOL v1.0.0
  -----------------------------------
  CÁCH HOẠT ĐỘNG (đọc kỹ trước khi dùng):
  1. Tool chạy TRÊN TRANG WEB chess.com (trình duyệt), KHÔNG chạy trong app Chess.com.
     Trên điện thoại Android: dùng trình duyệt Kiwi Browser + tiện ích Tampermonkey,
     mở chess.com bằng Kiwi, đăng nhập, vào ván rồi tool tự hiện panel.
  2. Tool đọc bàn cờ từ DOM của Chess.com: thẻ <wc-chess-board>, các quân là
     div.piece có class dạng "wp" (tốt trắng), "bn" (mã đen)... và "square-XY".
     square-XY: X = cột tính từ trái bàn (1..8), Y = hàng tính từ trên bàn (1..8).
     Tool tự nhận biết bàn có bị lật hay không (bạn cầm Đen thì bàn lật ngược),
     và có nút "ĐỔI CHIỀU BÀN" nếu FEN đọc ra sai.
  3. Engine: gọi API Stockfish online (stockfish.online, miễn phí, không cần key)
     với FEN hiện tại -> trả về nước tốt nhất (bestmove, vd "e2e4") + điểm đánh giá.
     Nếu API này lỗi thì tự đổi sang Lichess Cloud Eval để lấy nước mở cờ.
  4. Tự đi quân: tool bấm vào ô đi rồi bấm vào ô đến bằng sự kiện chuột thật
     trên bàn cờ (elementFromPoint + click). Phong hậu thì tự chọn Hậu.

  GIỚI HẠN NÓI THẬT (đừng tin ai hứa thắng 100%):
  - KHÔNG thắng 100% được. Stockfish gặp Stockfish thì hòa, đối thủ chơi chuẩn
    thì không có đường ép thắng. Engine chỉ giúp bạn không đi nước dở.
  - Chess.com có hệ thống Fair Play phát hiện chơi bằng engine: đi nước máy
    quá chuẩn, quá đều tay trong ván xếp hạng = bị khóa tài khoản, kể cả acc mới.
    KHÔNG có Anti-Ban 100%. Chỉ test với Bot của Chess.com hoặc ván không xếp hạng,
    dùng acc phụ, đừng đánh rank, đừng cày liên tục.
  - Chess.com đổi giao diện là tool có thể đọc sai bàn -> luôn có nút QUÉT BÀN
    và hiện FEN để bạn kiểm tra trước khi bật TỰ ĐI.
*/

(function () {
  'use strict';

  // ================= CẤU HÌNH =================
  const CFG = {
    // Độ sâu engine theo chế độ. Depth càng cao càng mạnh, càng chậm.
    modes: {
      LEGIT: { depth: 12, delayMin: 1800, delayMax: 3200, label: 'LEGIT' },
      VIP:   { depth: 15, delayMin: 800,  delayMax: 1500, label: 'VIP' },
      RAGE:  { depth: 18, delayMin: 300,  delayMax: 600,  label: 'RAGE' },
    },
    modeOrder: ['LEGIT', 'VIP', 'RAGE'],
    scanMs: 800,          // quét bàn mỗi 0.8s
    apiTimeoutMs: 12000,
  };
  let mode = GM_getValue('xaiz_mode', 'VIP');
  let autoMove = GM_getValue('xaiz_auto', false);
  let flipped = false;        // bàn có đang lật (bạn cầm Đen) không
  let myColor = 'w';          // 'w' hoặc 'b' - tự nhận theo chiều bàn
  let panelVisible = true;

  // Trạng thái ván
  let lastFen = '';
  let lastBest = '';          // UCI, vd "e2e4" / "e7e8q"
  let lastEval = null;        // điểm, tính theo trắng, đơn vị tốt (pawn)
  let lastMate = null;
  let engineBusy = false;
  let lastBoardKey = '';
  let plyCount = 0;           // số nửa nước đã đi (đọc từ danh sách nước đi)
  let castling = { K: true, Q: true, k: true, q: true };
  let halfmove = 0, fullmove = 1;

  const FILES = 'abcdefgh';
  const PIECE_LETTER = { p: 'p', n: 'n', b: 'b', r: 'r', q: 'q', k: 'k' };

  // ================= TIỆN ÍCH =================
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const rand = (a, b) => a + Math.random() * (b - a);
  const log = (...a) => console.log('[XAIZ Chess Bot]', ...a);

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

  // Nhận biết bàn có lật không: nhìn nhãn tọa độ ở góc dưới-trái của bàn.
  // Bàn trắng ở dưới -> góc dưới-trái là "a". Bàn đen ở dưới -> là "h".
  function detectFlipped(board) {
    if (!board) return false;
    if (board.classList && board.classList.contains('flipped')) return true;
    const coords = board.parentElement
      ? board.parentElement.querySelectorAll('.coordinate, [class*="coordinate"]')
      : [];
    for (const c of coords) {
      const t = (c.textContent || '').trim().toLowerCase();
      if (t === 'h') return true;
      if (t === 'a') return false;
    }
    // Dự phòng: nhìn quân vua trắng lúc đầu ván còn ở e1 hay e8 (qua square class)
    return false;
  }

  // square-XY -> ô cờ "e4". X = cột từ trái (1..8), Y = hàng từ trên (1..8).
  // Bàn không lật: hàng trên cùng là hạng 8 -> rank = 9 - Y, file = X.
  // Bàn lật: hàng trên cùng là hạng 1 -> rank = Y, file = 9 - X.
  function squareXYtoAlgebraic(x, y) {
    if (!flipped) return FILES[x - 1] + String(9 - y);
    return FILES[8 - x] + String(y);
  }

  // Đọc toàn bộ quân trên bàn -> map ô -> {color:'w'|'b', type:'p'|'n'|'b'|'r'|'q'|'k'}
  function readPieces() {
    const board = getBoardEl();
    if (!board) return null;
    flipped = detectFlipped(board);
    myColor = flipped ? 'b' : 'w';
    const pieces = {};
    board.querySelectorAll('.piece').forEach((el) => {
      const cls = el.className || '';
      const mSq = cls.match(/square-(\d)(\d)/);
      const mPc = cls.match(/\b([wb])([pnbrqk])\b/);
      if (!mSq || !mPc) return;
      const sq = squareXYtoAlgebraic(parseInt(mSq[1], 10), parseInt(mSq[2], 10));
      pieces[sq] = { color: mPc[1], type: PIECE_LETTER[mPc[2]] };
    });
    return { board, pieces };
  }

  // Đếm số nửa nước đã đi từ danh sách nước đi trên trang (nếu đọc được).
  function readPlyCount() {
    const list = document.querySelector('[data-test-element="move-list"], .vertical-move-list, .move-list');
    if (!list) return null;
    const nodes = list.querySelectorAll('.move, .node, [class*="move-"]');
    // Mỗi nước đi của 1 bên là 1 node có SAN; lọc node có text dạng nước cờ.
    let n = 0;
    nodes.forEach((el) => {
      const t = (el.textContent || '').trim();
      if (/^[KQRBN]?[a-h][1-8]/.test(t) || t === 'O-O' || t === 'O-O-O') n++;
    });
    return n > 0 ? n : null;
  }

  // Dựng FEN từ vị trí quân. Nhập thành suy ra từ vị trí vua/xe còn nguyên.
  function buildFen(pieces) {
    let placement = '';
    for (let rank = 8; rank >= 1; rank--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const sq = FILES[f] + rank;
        const pc = pieces[sq];
        if (!pc) { empty++; continue; }
        if (empty) { placement += empty; empty = 0; }
        placement += pc.color === 'w' ? pc.type.toUpperCase() : pc.type;
      }
      if (empty) placement += empty;
      if (rank > 1) placement += '/';
    }
    // Quyền nhập thành: vua còn ở e1/e8 và xe còn ở góc thì coi như còn quyền.
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
    const ply = readPlyCount();
    if (ply !== null) plyCount = ply;
    const active = (plyCount % 2 === 0) ? 'w' : 'b';
    fullmove = Math.floor(plyCount / 2) + 1;
    return `${placement} ${active} ${c} - ${halfmove} ${fullmove}`;
  }

  // ================= ENGINE =================
  async function askStockfish(fen, depth) {
    const url = 'https://stockfish.online/api/s/v2.php?fen=' + encodeURIComponent(fen) + '&depth=' + depth;
    const data = await gmGet(url);
    // API trả bestmove dạng "bestmove e2e4 ponder e7e5" -> chỉ lấy token UCI "e2e4".
    if (data && data.success && data.bestmove && data.bestmove !== '(none)') {
      const uci = String(data.bestmove).split(/\s+/).find(t => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(t));
      if (!uci) throw new Error('stockfish.online trả bestmove lạ: ' + data.bestmove);
      let ev = null, mate = null;
      if (typeof data.evaluation === 'number') ev = data.evaluation;
      if (typeof data.mate === 'number') mate = data.mate;
      return { best: uci, eval: ev, mate };
    }
    throw new Error('stockfish.online không trả nước đi');
  }

  // Dự phòng: Lichess cloud eval chỉ có nước mở cờ / nước đã có trong CSDL.
  async function askLichess(fen) {
    const url = 'https://lichess.org/api/cloud-eval?fen=' + encodeURIComponent(fen) + '&multiPv=1';
    const data = await gmGet(url);
    if (data && data.pvs && data.pvs[0] && data.pvs[0].moves) {
      const best = data.pvs[0].moves.split(' ')[0];
      const cp = typeof data.pvs[0].cp === 'number' ? data.pvs[0].cp / 100 : null;
      return { best, eval: cp, mate: data.pvs[0].mate || null };
    }
    throw new Error('lichess cloud-eval không có nước này');
  }

  async function analyse(fen) {
    const depth = CFG.modes[mode].depth;
    try { return await askStockfish(fen, depth); }
    catch (e) { log('Stockfish API lỗi, thử Lichess:', e.message); return await askLichess(fen); }
  }

  // ================= ĐI QUÂN TRÊN BÀN =================
  function squareCenterPoint(board, sq) {
    const r = board.getBoundingClientRect();
    const file = FILES.indexOf(sq[0]);       // 0..7, a..h
    const rank = parseInt(sq[1], 10);        // 1..8
    // Tọa độ hiển thị: cột từ trái, hàng từ trên.
    let col, row;
    if (!flipped) { col = file; row = 8 - rank; }
    else { col = 7 - file; row = rank - 1; }
    return { x: r.left + (col + 0.5) * (r.width / 8), y: r.top + (row + 0.5) * (r.height / 8) };
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

  async function playMove(uci) {
    const board = getBoardEl();
    if (!board) return false;
    const from = uci.slice(0, 2), to = uci.slice(2, 4), promo = uci.slice(4, 5);
    const p1 = squareCenterPoint(board, from);
    fireClickAt(p1.x, p1.y);
    await sleep(rand(120, 260));
    const p2 = squareCenterPoint(board, to);
    fireClickAt(p2.x, p2.y);
    await sleep(400);
    // Phong hậu: Chess.com hiện bảng chọn quân -> chọn Hậu.
    if (promo) {
      const qBtn = document.querySelector('[data-test-element="promotion-piece-q"], .promotion-piece.q, [class*="promotion"] [class*="q"]');
      if (qBtn) { qBtn.click(); await sleep(300); }
    }
    return true;
  }

  // ================= PANEL NGOÀI MÀN HÌNH =================
  let panel, elStatus, elFen, elBest, elEval, elMode, elAuto;
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'xaiz-chess-bot-panel';
    panel.innerHTML = `
      <div id="xaiz-cb-head">♟️ XAIZ CHESS BOT <span id="xaiz-cb-min">—</span></div>
      <div id="xaiz-cb-body">
        <div class="row"><span>Trạng thái:</span><b id="xaiz-cb-status">Đang quét bàn…</b></div>
        <div class="row"><span>Nước tốt nhất:</span><b id="xaiz-cb-best">—</b></div>
        <div class="row"><span>Đánh giá:</span><b id="xaiz-cb-eval">—</b></div>
        <div class="row small"><span>FEN:</span><code id="xaiz-cb-fen">—</code></div>
        <div class="btns">
          <button id="xaiz-cb-auto">▶ BẬT TỰ ĐI</button>
          <button id="xaiz-cb-mode">MODE: VIP</button>
        </div>
        <div class="btns">
          <button id="xaiz-cb-test">🎯 ĐI 1 NƯỚC</button>
          <button id="xaiz-cb-scan">🔍 QUÉT BÀN</button>
        </div>
        <div class="btns">
          <button id="xaiz-cb-flip">↕ ĐỔI CHIỀU BÀN</button>
          <button id="xaiz-cb-hide">✕ ẨN</button>
        </div>
        <div class="note">Chỉ test với Bot / ván không xếp hạng. Engine không thắng 100%, đánh rank bằng engine = khóa acc.</div>
      </div>`;
    const st = document.createElement('style');
    st.textContent = `
      #xaiz-chess-bot-panel{position:fixed;top:10px;right:10px;z-index:999999;width:248px;
        background:#111827;color:#fff;border:2px solid #f59e0b;border-radius:12px;
        font-family:sans-serif;font-size:13px;box-shadow:0 4px 20px rgba(0,0,0,.5)}
      #xaiz-cb-head{background:#f59e0b;color:#111827;font-weight:900;padding:8px 10px;
        border-radius:10px 10px 0 0;cursor:move;display:flex;justify-content:space-between}
      #xaiz-cb-body{padding:10px}
      #xaiz-cb-body .row{margin:4px 0;display:flex;gap:6px}
      #xaiz-cb-body .row.small{font-size:11px;word-break:break-all}
      #xaiz-cb-body .btns{display:flex;gap:6px;margin-top:8px}
      #xaiz-cb-body button{flex:1;padding:8px 4px;border:0;border-radius:8px;font-weight:800;
        background:#374151;color:#fff;cursor:pointer;font-size:12px}
      #xaiz-cb-auto.on{background:#16a34a}
      #xaiz-cb-body .note{font-size:11px;color:#fbbf24;margin-top:8px;line-height:1.4}`;
    document.head.appendChild(st);
    document.body.appendChild(panel);
    elStatus = panel.querySelector('#xaiz-cb-status');
    elFen = panel.querySelector('#xaiz-cb-fen');
    elBest = panel.querySelector('#xaiz-cb-best');
    elEval = panel.querySelector('#xaiz-cb-eval');
    elMode = panel.querySelector('#xaiz-cb-mode');
    elAuto = panel.querySelector('#xaiz-cb-auto');

    elMode.textContent = 'MODE: ' + mode;
    elAuto.textContent = autoMove ? '⏸ TẮT TỰ ĐI' : '▶ BẬT TỰ ĐI';
    elAuto.classList.toggle('on', autoMove);

    elAuto.onclick = () => {
      autoMove = !autoMove; GM_setValue('xaiz_auto', autoMove);
      elAuto.textContent = autoMove ? '⏸ TẮT TỰ ĐI' : '▶ BẬT TỰ ĐI';
      elAuto.classList.toggle('on', autoMove);
      setStatus(autoMove ? 'TỰ ĐI đang BẬT' : 'TỰ ĐI đã tắt (chỉ gợi ý)');
    };
    elMode.onclick = () => {
      const i = CFG.modeOrder.indexOf(mode);
      mode = CFG.modeOrder[(i + 1) % CFG.modeOrder.length];
      GM_setValue('xaiz_mode', mode);
      elMode.textContent = 'MODE: ' + mode;
      lastFen = ''; // tính lại với depth mới
    };
    panel.querySelector('#xaiz-cb-scan').onclick = () => { lastFen = ''; lastBoardKey = ''; scan(true); };
    panel.querySelector('#xaiz-cb-flip').onclick = () => {
      flipped = !flipped; myColor = flipped ? 'b' : 'w'; lastFen = ''; lastBoardKey = '';
      setStatus('Đã đổi chiều bàn, đang quét lại…'); scan(true);
    };
    panel.querySelector('#xaiz-cb-test').onclick = async () => {
      if (!lastBest) { setStatus('Chưa có nước tốt nhất, bấm QUÉT BÀN trước'); return; }
      setStatus('Đang đi thử: ' + lastBest);
      await playMove(lastBest);
    };
    panel.querySelector('#xaiz-cb-hide').onclick = () => { panel.style.display = 'none'; showFab(); };
    panel.querySelector('#xaiz-cb-min').onclick = () => {
      const b = panel.querySelector('#xaiz-cb-body');
      b.style.display = b.style.display === 'none' ? '' : 'none';
    };
    // Kéo panel bằng đầu panel (cho điện thoại).
    const head = panel.querySelector('#xaiz-cb-head');
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
    fab.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:999999;width:46px;height:46px;border-radius:50%;border:2px solid #f59e0b;background:#111827;color:#fff;font-size:22px';
    fab.onclick = () => { panel.style.display = ''; fab.remove(); };
    document.body.appendChild(fab);
  }

  function setStatus(t) { if (elStatus) elStatus.textContent = t; }

  // Vẽ ô from/to lên bàn để bạn thấy nước engine chọn.
  function highlightMove(uci) {
    const board = getBoardEl();
    if (!board || !uci) return;
    document.querySelectorAll('.xaiz-hl').forEach(el => el.remove());
    [uci.slice(0, 2), uci.slice(2, 4)].forEach((sq, i) => {
      const p = squareCenterPoint(board, sq);
      const r = board.getBoundingClientRect();
      const d = document.createElement('div');
      d.className = 'xaiz-hl';
      d.style.cssText = `position:fixed;left:${p.x - r.width / 16}px;top:${p.y - r.width / 16}px;width:${r.width / 8}px;height:${r.width / 8}px;border:3px solid ${i === 0 ? '#22c55e' : '#eab308'};border-radius:6px;z-index:999998;pointer-events:none;box-sizing:border-box`;
      document.body.appendChild(d);
    });
  }

  // ================= VÒNG QUÉT CHÍNH =================
  async function scan(manual) {
    const read = readPieces();
    if (!read) { setStatus('Chưa thấy bàn cờ — vào ván rồi bấm QUÉT BÀN'); return; }
    const { pieces } = read;
    const count = Object.keys(pieces).length;
    if (count < 2) { setStatus('Bàn chưa tải đủ quân (' + count + '), đợi rồi quét lại'); return; }
    const fen = buildFen(pieces);
    const key = JSON.stringify(pieces);
    elFen.textContent = fen;
    const active = fen.split(' ')[1];
    const isMyTurn = active === myColor;
    if (fen === lastFen && !manual) return; // bàn không đổi thì thôi
    lastFen = fen; lastBoardKey = key;

    if (!isMyTurn) { setStatus('Chưa đến lượt bạn (' + (myColor === 'w' ? 'Trắng' : 'Đen') + ')'); return; }
    if (engineBusy) return;
    engineBusy = true;
    setStatus('Engine đang tính… (Depth ' + CFG.modes[mode].depth + ')');
    try {
      const res = await analyse(fen);
      // Bàn đổi trong lúc tính thì bỏ kết quả cũ.
      if (buildFen(readPieces().pieces) !== fen) { engineBusy = false; return; }
      lastBest = res.best; lastEval = res.eval; lastMate = res.mate;
      elBest.textContent = res.best + (res.mate ? '  (chiếu hết trong ' + res.mate + ')' : '');
      elEval.textContent = res.eval === null ? '—' : (res.eval > 0 ? '+' : '') + res.eval.toFixed(2);
      highlightMove(res.best);
      setStatus('Đã có nước: ' + res.best);
      if (autoMove) {
        const d = rand(CFG.modes[mode].delayMin, CFG.modes[mode].delayMax);
        setStatus('Tự đi sau ' + Math.round(d / 1000 * 10) / 10 + 's: ' + res.best);
        await sleep(d);
        if (lastBest === res.best && autoMove) {
          await playMove(res.best);
          setStatus('Đã đi: ' + res.best);
        }
      }
    } catch (e) {
      setStatus('Engine lỗi: ' + e.message + ' — thử QUÉT BÀN lại');
      log('analyse lỗi', e);
    } finally { engineBusy = false; }
  }

  // ================= KHỞI ĐỘNG =================
  function init() {
    if (document.getElementById('xaiz-chess-bot-panel')) return;
    buildPanel();
    setStatus('Đã tải XAIZ Chess Bot — vào ván rồi bấm QUÉT BÀN');
    setInterval(() => scan(false), CFG.scanMs);
    // Phím tắt: Alt+B ẩn/hiện panel.
    document.addEventListener('keydown', (e) => {
      if (e.altKey && (e.key === 'b' || e.key === 'B')) {
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
      }
    });
    log('XAIZ Chess Bot v1.0.0 đã tải. Mode:', mode, 'Auto:', autoMove);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
