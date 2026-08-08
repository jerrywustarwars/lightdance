import { defineConfig } from "vitest/config";

// 測試設定與 vite.config.js 分離：測試目標是純函式（無 DOM、無 React），
// 因此用 node 環境即可，不需要載入 React plugin 與 dev server 設定。
export default defineConfig({
  test: {
    environment: "node",
    // 只收集 __tests__ 目錄下的測試，避免掃到 CRA 時期遺留的 src/App.test.js
    include: ["src/**/__tests__/**/*.test.{js,jsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  },
});
