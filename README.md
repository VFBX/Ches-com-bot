# ♟️ Chess.com Bot AI — XAIZ TOOL

Bot AI cho Chess.com: đọc bàn cờ trên trang web, Stockfish tính nước tốt nhất,
hiện panel ngoài màn hình, tự đi quân khi đến lượt bạn.

> **Nói thật trước:** KHÔNG thắng 100% được. Stockfish gặp Stockfish thì hòa,
> đối thủ chơi chuẩn thì không có đường ép thắng. Chess.com có Fair Play phát
> hiện chơi bằng engine — đánh ván xếp hạng bằng engine có thể bị **khóa tài
> khoản**, không có Anti-Ban 100%. Chỉ test với **Bot của Chess.com** hoặc ván
> không xếp hạng, dùng **acc phụ**, đừng đánh rank, đừng cày liên tục.

## File

- `ChessCom-Bot-AI.user.js` — userscript Tampermonkey, chạy trên web chess.com.
  Engine gọi API Stockfish online (miễn phí, không cần key), dự phòng Lichess
  Cloud Eval. Không thu thập mật khẩu, không gửi dữ liệu tài khoản đi đâu.

## Cách cài trên điện thoại Android

1. Cài **Kiwi Browser** trên CH Play (trình duyệt Chromium hỗ trợ tiện ích).
2. Trong Kiwi, vào Chrome Web Store, cài **Tampermonkey**.
3. Mở link file này trên GitHub (bấm **Raw**):
   `ChessCom-Bot-AI.user.js` — Tampermonkey sẽ hỏi cài đặt, bấm **Install**.
4. Mở `https://www.chess.com` bằng Kiwi, đăng nhập, vào một ván
   (nên bắt đầu bằng **Play vs Computer / Bot** để test).
5. Panel **♟️ XAIZ CHESS BOT** hiện ở góc trên-phải màn hình. Bấm **QUÉT BÀN**
   để kiểm tra FEN đọc có đúng không, rồi mới bấm **BẬT TỰ ĐI**.

> App Chess.com trên điện thoại **không chạy được** userscript. Bắt buộc phải
> chơi bằng trình duyệt Kiwi như trên. Trên máy tính: Chrome/Edge + Tampermonkey,
> các bước giống vậy.

## Panel có gì

- **Trạng thái / Nước tốt nhất / Đánh giá / FEN** — kiểm tra tool đọc bàn đúng chưa.
- **BẬT TỰ ĐI** — tự bấm quân khi đến lượt bạn. Mặc định TẮT, chỉ gợi ý.
- **MODE: LEGIT / VIP / RAGE** — LEGIT depth 12, chậm như người (1.8–3.2s);
  VIP depth 15 (0.8–1.5s); RAGE depth 18, đi nhanh (0.3–0.6s).
- **ĐI 1 NƯỚC** — đi thử đúng 1 nước engine vừa tính, để test.
- **QUÉT BÀN** — đọc lại bàn cờ ngay.
- **ĐỔI CHIỀU BÀN** — nếu FEN đọc sai (quân trắng/đen đảo ngược) thì bấm nút này.
- **Ẩn** — thu panel thành nút tròn ♟️ ở góc dưới-phải. Phím tắt `Alt+B` trên PC.

## Nếu tool không đi quân

1. Bấm **QUÉT BÀN**, xem FEN trong panel có giống bàn thật không. Sai thì bấm
   **ĐỔI CHIỀU BÀN** rồi quét lại.
2. Kiểm tra đã đến lượt bạn chưa — tool chỉ tính và chỉ đi khi đến lượt bạn.
3. Kiểm tra Tampermonkey có đang bật script trên trang chess.com không
   (icon Tampermonkey phải hiện số 1).
4. Chess.com đổi giao diện thì tool có thể đọc sai — báo lại để cập nhật.

## Giấy phép

MIT — dùng để học tập / test với Bot. Bạn tự chịu trách nhiệm nếu dùng trong
ván xếp hạng với người thật.
