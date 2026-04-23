# Formula Flow - Trình Chuyển Đổi Công Thức Toán Học

Formula Flow là một ứng dụng web tiện ích hỗ trợ chuyển đổi mã công thức LaTeX thành các định dạng thuận tiện cho việc sao chép và dán trực tiếp vào phần mềm Microsoft Word.

## Tính Năng Chính
- **Chuyển đổi trực tiếp:** Biến đổi các đoạn mã LaTeX thông thường hoặc Markdown chứa LaTeX sang nội dung dễ đọc.
- **Copy For Word:** Hỗ trợ Copy toàn bộ text và công thức hệ thống ở định dạng MathML, giữ nguyên độ hiển thị chuẩn Word mà không bị lỗi font hay bị tách chữ.
- **Export .doc:** Tải ngay kết quả dưới dạng file MS Word dễ dàng lưu trữ.
- **Giới hạn tự động:** Hạn chế số lượt sử dụng miễn phí mỗi IP (tối đa 5 lượt/ngày).
- **Hệ thống Quản Trị / Email:** Cho phép quản trị viên (Admin) mở khóa giới hạn bằng cách cấp quyền thông qua xác thực Email bằng Google Login.

## Công Nghệ
- **React.js (Vite)**
- **Tailwind CSS**
- **KaTeX** & **Marked.js**
- **Firebase Auth & Firestore**

## Cài đặt cấu hình (Local Development)

1. Clone kho lưu trữ:
\`\`\`bash
git clone ...
cd ...
\`\`\`

2. Cài đặt các thư viện:
\`\`\`bash
npm install
\`\`\`

3. Chạy giao diện dev server:
\`\`\`bash
npm run dev
\`\`\`

***
*Developed by Thầy Lê Thanh Huy - TH1P.*
