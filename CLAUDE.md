# LightDance 專案 - Claude Code 記憶檔案

## 專案基本資訊

**專案名稱**：LightDance 燈光舞蹈控制系統  
**維護團隊**：國立陽明交通大學電機工程學系學生   
**開發語言**：繁體中文為主，專有名詞保持原文

## 專案概述

這是一個**全端 Web 應用程式**，用於設計和控制燈光舞蹈表演。專案採用現代化的微服務架構，透過 Docker 容器化技術確保環境一致性。

### 技術架構

```
開發環境：
  前端 (Vite/React, Port 3000) ── /api proxy ──→ 後端 (FastAPI, Port 8000) ──→ MongoDB (Port 27017)
生產環境：
  Nginx (Port 80) ── /api 轉發 ──→ 後端 (FastAPI, Port 8000) ──→ MongoDB (Port 27017)
                    └── 靜態檔案 (React build)
```

> **注意**：開發與生產環境的 API 路由方式不同，詳見 `docs/network-architecture-refactor-plan.md`。

## 開發環境指令

### 必備檢查指令
```bash
# 檢查專案狀態
docker compose -f docker-compose.dev.yml ps

# 查看所有服務日誌
docker compose -f docker-compose.dev.yml logs -f

# 啟動開發環境
./start-dev.sh

# 停止開發環境
# 使用 Ctrl+C 或
docker compose -f docker-compose.dev.yml down
```

### 故障排除指令
```bash
# 重新建置並啟動
docker compose -f docker-compose.dev.yml down
docker compose -f docker-compose.dev.yml up --build

# 檢查端口占用
lsof -i :3000  # 前端
lsof -i :8000  # 後端
lsof -i :27017 # 資料庫

# 清除前端快取
docker volume rm lightdance_frontend_node_modules

# MongoDB 連線問題（登入 500 錯誤）
# 請參考 docs/troubleshooting-login-500.md 的完整 SOP
```

## 專案特色

### 對 C++ 開發者友好的設計
- **詳細的中文註解**：所有重要概念都有對應 C++ 的解釋
- **一鍵啟動環境**：使用 `./start-dev.sh` 避免複雜的環境配置
- **完整的故障排除指南**：常見問題都有詳細的解決步驟
- **容器化部署**：類似跨平台編譯，確保環境一致性

### 程式碼品質標準
根據專案要求，程式碼優先順序為：
1. **可讀性** - 程式碼要讓其他開發者容易理解
2. **可維護性** - 便於未來修改和擴展  
3. **可擴展性** - 支援功能增加和系統擴展
4. **易懂** - 邏輯清晰，註解適當
5. **簡潔** - 在滿足以上條件下保持簡潔

## 資料流管道 (Data Flow Pipeline)

```
Editor (actionTable) → Redux Store → handleOutput() → 32-bit RGBA 打包 → POST /api/upload_full → MongoDB
```

### 編輯器資料格式 (actionTable)
巢狀結構：`actionTable[armorIndex][partIndex] = [{time, color: {R,G,B,A}, linear}]`
- armorIndex: 0-6（舞者編號），partIndex: 0-21（22 個身體部位，含 8 個配件 LED）
- time: 毫秒，linear: 0（固定色）/ 1（線性過渡）

### 上傳格式轉換 (handleOutput, Home.jsx:155)
1. 時間軸對齊至 50ms 的倍數
2. 線性過渡顏色插值（等同 `std::lerp`）
3. 32-bit RGBA 打包：`(R<<24) | (G<<16) | (B<<8) | ((alpha7)<<1 | linear)`
4. 一次寫入 `collection_color`（播放資料）和 `collection_raw`（編輯器原始 JSON）

### 本地備份
IndexedDB（localforage）自動備份，30 天自動清理。Redux 透過 redux-persist 持續持久化。

詳細流程說明請參考 `docs/data-flow-pipeline.md`。

## 重要檔案說明

### 配置檔案
- **`.env.development`**：開發環境變數設定
- **`docker-compose.dev.yml`**：開發環境容器編排
- **`start-dev.sh`**：開發環境一鍵啟動腳本

### 核心程式碼
- **`frontend/src/`**：React 前端程式碼
- **`backend/main.py`**：FastAPI 後端主程式
- **`mongo-init/`**：資料庫初始化腳本

#### 編輯器元件（Phase 3 拆件後）

`components/audio/audioplayer.jsx` 現在只是外殼（狀態容器 + 版面組合）。
有快捷鍵的功能一律拆成 **hook（邏輯）+ 元件（UI）**，外殼呼叫一次 hook，
按鈕與鍵盤共用同一組函式：

| 檔案 | hook | 內容 |
|---|---|---|
| `MusicSelector.jsx` | — | 音樂清單與切歌（完全自持） |
| `PlayerControls.jsx` | — | 速度 / 播放 / 時間 / 縮放 / 音量 |
| `ShiftTool.jsx` | `useTimeShift` | 區間平移（按鈕 + 時間軸標記） |
| `EffectMenu.jsx` | `useLightEffects` | 漸變 / 頻閃 / 亮度階梯 |
| `TrackToolbar.jsx` | `useTrackActions` | 導航 / 剪下 / 刪除 / 亮度 / 改色 / 統一透明度 |
| `CopyPasteManager.jsx` | `useCopyPaste` | 五種複製貼上 + 複製模式 |
| `hooks/useKeyboardShortcuts.js` | — | 全站唯一的 keydown 註冊點（宣告式 keymap） |

`Timeline.jsx` 與 `waveform.jsx` 內部尚未拆（留給 Phase 5）。

### 文件檔案
- **`README.md`**：專案說明文件（已針對 C++ 開發者優化）
- **`docs/technical-analysis.md`**：詳細技術分析報告（架構、API、安全問題、改進路線圖）
- **`docs/configuration.md`**：完整配置說明（環境變數、API 端點、部署模式）
- **`docs/data-flow-pipeline.md`**：從編輯器到資料庫的完整資料流說明
- **`docs/backend-management.md`**：MongoDB 備份與 Docker 管理操作指南
- **`docs/network-architecture-refactor-plan.md`**：網路路由架構重構計畫
- **`docs/shortcuts.md`**：鍵盤快速鍵速查表，前端 Home 頁面可透過 Shortcuts 按鈕查看
- **`docs/troubleshooting-login-500.md`**：MongoDB 連線 500 錯誤 SOP
- **`docs/frontend-rendering-optimization.md`**：前端渲染邏輯與效能優化詳解（元件樹、播放管線、Redux 配置、memo 策略、區塊索引語意、duration 溢出防護）

### 後端管理腳本
- **`backend/mongo-backup.sh`**：MongoDB 自動備份主腳本
- **`backend/mongo-restore.sh`**：資料還原輔助腳本
- **`backend/setup-cron.sh`**：crontab 定時備份設定腳本
- **`backend/BACKUP_README.md`**：備份系統完整使用說明
- **`backend/SHELL_SCRIPT_GUIDE.md`**：Shell 腳本語法教學（適合 C++ 開發者）

## 常見開發任務

### 新增功能開發
1. 先閱讀 `docs/technical-analysis.md` 了解現有架構
2. 確認功能需求符合專案目標（燈光控制相關）
3. 遵循程式碼品質標準進行開發
4. 確保前後端都能正常運行後再提交

### 修復 Bug
1. 使用 `docker compose logs -f` 查看錯誤日誌
2. 查閱 README.md 中的故障排除章節
3. 如果是安全性相關問題，參考 `docs/technical-analysis.md` 第五章節

### 前端驗收（瀏覽器，不需要後端）

單元測試（`npm test`）跑在 jsdom 上，測不到真實瀏覽器的鍵盤事件序列與版面
重疊。前端有兩支 Playwright 腳本補這一段，`/api/**` 全部攔截回假資料，
所以**後端不用跑**：

```bash
cd frontend
npm run dev            # 另一個終端機
npm run e2e            # 功能驗收：放色 / 選取 / 剪下 / undo / 快捷鍵 / 重新整理 / Output
npm run audit:layout   # 版面稽核：控制項被蓋住 / 元素溢出容器 / 提示被裁掉
```

兩支都會把截圖存在 `frontend/e2e/shots/`。動過 CSS、版面或快捷鍵之後請跑一次
——它們抓到過 jsdom 測試全綠但實際完全不能用的問題（Ctrl+數字被防彈跳吃掉、
Edit/Logout 被橫幅蓋住、舞者開關蓋掉 12 個光衣部位、按鈕階層被 Bootstrap 的
`.btn` 蓋掉、17 則提示有 12 則被 `overflow` 裁光）。

⚠️ 若出現 `編輯器一直載入不了` / `一直被彈回首頁`，**先重開 `npm run dev` 再判斷**。
連續改一堆 CSS 之後 vite 的 HMR 狀態會累積到 `/home` 載不起來，這是開發伺服器的
問題不是程式碼的問題（重開後同一份程式碼就 17/17 全過）。

### 設計系統（2026-08-12 起）

**顏色只能定義在 `frontend/src/styles/tokens.css`，其他地方一律 `var()`。**
`styles/__tests__/tokens.test.js` 會掃描所有 CSS 把違規的抓出來（目前 0 處）。

核心原則是**編輯器介面無彩色** —— 畫面上唯一飽和的顏色是使用者的燈光資料，
狀態靠亮度與圖示表達，不靠色相。這樣色塊和光衣才會自己跳出來。

| 檔案 | 內容 |
|---|---|
| `styles/tokens.css` | 42 個 token：背景 5 階、文字 4 階、邊框、選取 ring、光衣、波形、圓角 3 階、字級 6 階、間距 |
| `styles/buttons.css` | 按鈕四階層 `.ld-btn--primary / secondary / ghost / danger` |
| `styles/tooltip.css` | 提示的唯一定義：自我置中、寬度由內容決定、`:hover > .tooltip` 顯示 |

⚠️ 按鈕的類別前綴是 **`ld-`** 而不是 `.btn` —— Bootstrap 也用 `.btn`，
而且比它晚載入，撞名會讓四個階層整組失效。

改視覺時只動 token 的值，不要回頭在元件的 CSS 裡寫死顏色。入口頁
（Welcome / Dashboard）保留自己的品牌色，但一樣收成各自的區域 token。

完整的設計決策與施工回顧見 `docs/ui-design-plan.md`。

### 程式碼重構
1. 保持向後相容性
2. 增加適當的註解說明變更原因
3. 確保重構後符合程式碼品質標準

### 調整舞者人數或部位清單

**只需要改 `frontend/src/constants/parts.js`**（該檔案開頭有完整說明）：

- **改人數**：改 `PLAYER_COUNT` 一個數字。初始光表、`dancerVisibility`、
  ControlPanel 的全選欄位、People 渲染幾套光衣全部由它推導。
- **改部位**：在 `PARTS` 增刪一列（`{key, label, type}`）。`PART_COUNT` /
  `PART_KEYS` / `PART_LABELS` / `BODY_PART_COUNT` 都會跟著變。

有三件事**不會**自動跟上，`frontend/src/constants/__tests__/partsConfig.test.js`
會在改壞時指出是哪一項：

| 項目 | 為什麼要人工處理 |
|---|---|
| 韌體 ABI | `PART_KEYS` 的順序就是上傳每一列的欄位順序，韌體那端要同步改（`buildPlayers.golden.test.js` 會紅，那是提醒不是阻礙） |
| 光衣 SVG | `Armor.jsx` 的圖形是手繪的，新增 `type: "body"` 的部位要自己畫 |
| 飾品索引 | `config/accessoryConfig.js` 的 `indices` 會隨身體部位增減而位移，要重新對過 |

改完跑 `cd frontend && npm test` 確認。

## Backend 管理

### MongoDB 備份系統
- 手動備份: `cd backend && ./mongo-backup.sh`
- 設定定時備份: `cd backend && ./setup-cron.sh`（每兩天凌晨 6:00）
- 互動式還原: `cd backend && ./mongo-backup.sh --restore`
- 快速還原最新備份: `cd backend && ./mongo-restore.sh --latest`
- 備份日誌: `tail -20 db/dump_data/backup.log`
- 完整說明: `backend/BACKUP_README.md`

### Docker 管理
- 開發環境啟動: `./start-dev.sh`
- 生產環境部署: `./run-deploy.sh`
- 容器狀態檢查: `docker compose -f docker-compose.dev.yml ps`
- 即時日誌: `docker compose -f docker-compose.dev.yml logs -f`
- 進入容器: `docker compose -f docker-compose.dev.yml exec <service> sh`

詳細操作請參考 `docs/backend-management.md`。

## 安全性注意事項

⚠️ **重要**：專案目前存在以下安全問題需要注意：

1. **密碼明文儲存** - 需實施 bcrypt 或 Argon2 加密
2. **Token 機制不安全** - 需要改用 JWT
3. **輸入驗證不足** - 需加強使用者輸入驗證
4. **CORS 設定過寬** - 需要限制允許的來源

詳細改進方案請參考 `docs/technical-analysis.md`。

## 學習建議

### 推薦學習順序
1. 先熟悉 Docker 基本概念和指令
2. 了解 HTTP 協定和 RESTful API 設計
3. 學習 React 前端框架基礎
4. 學習 Python 和 FastAPI 後端開發
5. 了解 MongoDB 文件式資料庫

## 協作指引

### 與 C++ 背景開發者溝通
- 多使用類比的方式解釋 Web 開發概念
- 提供具體的指令範例而非抽象描述
- 解釋每個步驟的原因和目的
- 先詢問需求細節再開始實作

### 程式碼審查重點
- 檢查是否有適當的中文註解
- 確認程式碼符合可讀性優先的原則
- 驗證新功能是否破壞現有功能
- 確保安全性問題沒有被引入

## 更新記錄

- **2026-08-12（晚）**：**UI 設計系統**。CSS 寫死顏色 **287 → 0**（新增
  `styles/tokens.css` 42 個 token + `tokens.test.js` 防腐測試）。編輯器介面
  全面無彩色化：波形去綠、舞者標籤去藍、未儲存橫幅去橘，色塊選取改白色雙層
  ring（舊版橘色撞到橘色色塊就改判青色，只擋得住一種顏色）。光衣加描邊並站上
  黑卡——部位的 fill 帶 alpha 而 alpha 是 LED 亮度，墊底盤會讓低亮度的顏色
  系統性偏亮。色塊新增亮度角標（「鮮紅 30%」與「暗紅 100%」合成後像素完全相同）。
  按鈕收成四階層、工具列分五組、16 則提示改繁中並刪掉 8 個寫死座標。
  新增時間刻度尺（密度由「相鄰標籤至少 60px」推導）。調色盤 debug 整數換成
  HEX 欄位、最愛色 4 → 6 格。測試 292 passed
- **2026-08-12**：**UI 版面修正**。用瀏覽器實測稽核（`npm run audit:layout`）
  抓到 9 處控制項被蓋住：Edit/Logout 被「尚未儲存」橫幅整個蓋住、音樂選單被
  擠到畫面外 x=−16 蓋住左側工具列、舞者開關浮在光衣上蓋掉 12 個部位、光衣 SVG
  （寫死 480px）溢出容器蓋住整條工具列、調色盤各區互疊。根因都是
  `position: absolute` + 寫死像素座標，改成 flex 排版後 1600×950 與 1280×800
  兩種尺寸都是 0 問題。另修好登入後立刻重新整理會被彈回首頁（persist 有 2 秒
  debounce，新增 `flushPersist()`）與 Ctrl/Shift+數字快捷鍵被防彈跳吃掉。
  新增 `npm run e2e`（17 項功能驗收）與 `npm run audit:layout`
- **2026-08-10**：**人數與部位數集中化**。`constants/parts.js` 成為唯一來源
  （`PLAYER_INDICES` / `PART_INDICES` / `isAccessoryPart` / `createEmptyActionTable`），
  取代散落 5 個檔案的 9 處 `Array.from({length: 7})` 與寫死的身體/飾品分界 `14`。
  新增 `partsConfig.test.js` 當安全網（光衣 SVG 覆蓋率、飾品索引範圍、
  `dancerVisibility` 形狀）。實測改成 9 人全綠、拿掉一個身體部位會被準確指出。
  操作方式見上方「調整舞者人數或部位清單」。測試 183 passed
- **2026-08-09（晚）**：**效能稽核與優化**。三項實測影響最大的問題：
  ① persist 每次編輯序列化 72.9ms（`serialize: false` 後 0.5ms，主因是
  `Float32Array` 被 JSON 化成 5.3MB）；② undo 用 `JSON.stringify` 深度比較
  （53ms → O(1) reference）；③ 訂閱粒度太粗（新增 `useKeyframePartTimeline` /
  `useKeyframeArmorTimelines`，一次編輯只重算 1/154 條 Timeline、1/7 個 Armor）。
  另修好 Phase 4 引入的回歸：no-op 編輯會佔掉一格 undo。測試 168 passed
- **2026-08-09（下午）**：**Phase 4 完成** —— store 的 `data.actionTable` 改存 segments。
  新增遷移入口 `utils/migration/loadProjectData.js`（五條載入路徑統一、靠形狀辨認格式）、
  轉接橋 `utils/segments/withKeyframeAdapter.js` + `hooks/useKeyframeActionTable.js`
  （逐部位 reference 快取，既有寫入者零邏輯改動）；persist key bump `root` → `root_v2`。
  測試 150 passed，閘門測試全 fixture 結構性差異 0
- **2026-08-09**：`refract` 分支完成重構 Phase 0–3。測試從 0 建到 125；audioplayer.jsx 從 1,992 行拆到 368 行（`components/audio/` 下 6 個新元件 + `hooks/useKeyboardShortcuts.js`）；segment 轉換器與 Phase 4 閘門測試就位
- **2026-05-06**：修復區塊剪下失敗與紅線視覺偏移（blockIndex 語意統一、currentTime 同步、stale closure 消除、duration 溢出防護），更新 `docs/frontend-rendering-optimization.md`
- **2026-05-04**：前端效能優化（rAF 三層分離、React.memo、persist 剝離、middleware 禁用），新增 `docs/frontend-rendering-optimization.md`
- **2026-05-03**：重整 docs/ 目錄，新增資料流管道與後端管理文檔，更新 CLAUDE.md 架構圖與引用
- **2025-08-20**：建立專案記憶檔案，針對 C++ 背景開發者優化 README.md
- **專案狀態**：開發版本，包含已知安全性問題待修復

## 色塊資料模型重構計畫（2026-08-08 修訂版）

> 詳細執行步驟、16 項更正、風險表與 checklist 見 [todo.md](todo.md)。本章節記錄設計動機與已拍板的決策，
> 讓未來的協作者（與 Claude）一進專案就能看到方向。
> 4 月版規劃已於 2026-08-08 重新稽核修訂（upstream 前進 39 個 commit 後多項假設過時）。

### 為什麼要改

目前 `actionTable[armor][part] = [{time, color, linear}, ...]` 是「關鍵格 + 黑色哨兵」模型。
為了表達「色塊在此結束、不要漸變到下一段」，必須在前後塞純黑斷點，導致：

- `insertArray` 的 5 分支黑點判斷 + 魔術數字 `blackthreshold = 10ms` 重複了 **4 份**
  （[Armor.jsx](frontend/src/components/Armor.jsx)、[audioplayer.jsx](frontend/src/components/audio/audioplayer.jsx)
  `insertFavoriteColorArray`、[AccessoryPanel.jsx](frontend/src/components/AccessoryPanel.jsx)、已死的 Item.jsx）
- W/S/A/D 與 handleGoLeft/Right 必須「自動跳過黑色」；點到黑色 block 會清空選取
- 拖曳/resize 一個色塊要同步搬 2-N 個 keyframe + 鄰居黑點（Timeline.jsx Move Mode / resize commit）
- `removeDuplicateBlackBlocks`、`ensureBlackBefore` 等清理函式存在的唯一理由就是黑點
- 「色塊」不是資料模型的一級物件，框選/多選拖曳/量化等 DAW 風功能幾乎做不到

根因：**資料形狀沒有顯式表達色塊邊界**，整份程式碼一直在從「關鍵格序列 + 鄰居黑色」反推色塊在哪。

### 新模型（已拍板）

```js
actionTable[armor][part] = [
  { id, start, end, colorStart: {R,G,B,A}, colorEnd: {R,G,B,A}, linear, effect? },
  ...
]
```

**核心決策（2026-08-08 最終版）：**

| 項目 | 決策 |
|---|---|
| segment 之間 | **可以有間隔**，間隔 = LED 關閉（黑）——黑色不再是資料 |
| 黑色哨兵 | **徹底消滅**（使用者拍板）：`blackthreshold` / -10ms 從專案完全消失；f9489cf 的「黑點豁免 50ms 對齊」特例隨遷移作廢 |
| 時間單位 | 可調常數 `TICK_MS = 50`（`constants/time.js`），所有 `start`/`end` 對齊網格 |
| 放色預設長度 | `DEFAULT_SEGMENT_MS = 1000`（1 秒） |
| 漸變語意 | 段內漸變 — `colorStart → colorEnd` 在 `[start, end]` 內線性插值 |
| 拖曳碰撞策略 | **trim** — 新 segment 蓋到舊 segment 時，被覆蓋部分裁掉（可能 split 成兩段） |
| 部位 | **22 個**（14 身體 + 8 飾品 acc0-7），`isPartAllowed` 閘門不變 |
| 後端 | **完全不變** — 前端只走 `upload_full`；mongo schema、韌體 PlayerData 路徑原樣 |
| raw_data | 可改（前端黑盒子）：直接存 `{schemaVersion: 2, actionTable: segments}` |
| 輸出等價標準 | **結構化 diff**（非 byte-equal，見 `utils/export/structuredDiff.js`）：所有列 time 完全相同；差異只允許出現在線性漸變**內部**取樣點（黑點 g−10→g 的插值分母微調所致）。**真實 production 全庫實測（336 份光表、54 萬關鍵格）：結構性差異 0、最大通道差 2**；預設容許 16。其他任何差異 = bug |
| 不變式 | segment 排序、不重疊、`start/end % TICK_MS === 0`、`end > start` |
| segment 識別 | 穩定 `id`（`crypto.randomUUID()`），供多選、複製貼上、undo diff |
| 型別 | 核心做成 generic `Segment<T>`，`utils/segments/core.js` 不 import 色彩（多軌鋪路） |

### 遷移策略（adapter 橋，取代 4 月版混合期）

1. **Phase 0**：vitest + `buildPlayers` 抽出 + golden fixtures（真實本地備份/mongo 指定 timestamp/合成邊界）+ 結構化 diff 比對器——專案零測試，此為動 shape 前提
2. **Phase 2**：轉換器 `keyframesToSegments`（黑點上網格後丟棄）/ `segmentsToKeyframes`（空隙在網格點熄滅），round-trip 冪等 + 全 fixture 結構化 diff 全綠 = 閘門
3. **Phase 4 單一原子 PR**：store 換 segments；舊寫入者包 `withKeyframeAdapter`、舊渲染讀 memoized `selectKeyframes`，既有程式碼零改動；三條載入路徑（redux-persist / 遠端 raw_data / IndexedDB 本地備份）走單一遷移入口；persist key bump（root→root_v2）保 deploy 回滾
4. **Phase 5**：逐寫入者 segment 原生化並拆橋；最後 `blackthreshold`、`ensureBlackBefore`、`removeDuplicateBlackBlocks`、skip-black 導航全數刪除
5. **Phase 6**：blink 改 `seg.effect` metadata（壓平才展開）、框選、多 segment 拖曳、對齊節拍

### 注意事項

- **零 re-render 拖曳路徑必須保留**（詳見 `docs/frontend-rendering-optimization.md`）：手勢期間 direct-DOM transform、commit 恰好一次 dispatch、undo 合併一筆
- actionTable 容器統一為巢狀 **array**（現況 array/object 混用，Phase 1 統一）
- 韌體輸出欄位順序（hat..acc7）是 ABI，用測試鎖定
- 已知後端 bug：`GET /api/raw/{u}/LATEST` 查錯 collection——fixture 擷取用明確 timestamp，後端本身不動

## 長期願景：多軌音訊（DAW 風）

未來目標是讓**音軌也像色塊一樣可拖曳、可拼貼多個音軌**，修改音樂時不用重新上傳整首。

### 為何寫進這份檔案
這個願景反向影響 segment 重構的介面設計（todo.md Phase 7 記錄的不得反悔事項）：
- segment 核心必須是 generic `Segment<T>`，`utils/segments/core.js` 永不 import 色彩程式碼
- Timeline 拖曳/resize/多選手勢邏輯做成可複用 hook
- raw_data 的 `schemaVersion` envelope 未來可長出 `tracks` 陣列，後端零改動
- audioplayer 拆件（Phase 3）不得把單一 `sourceNode` 假設更深綁進新元件

### 音訊 segment 草案
```js
audioTracks = [
  {
    id, name,
    segments: [
      { id, start, end, sourceFile, sourceOffset, volume, fadeIn, fadeOut },
      ...
    ]
  },
  ...
]
```
與燈光 segment **幾乎同構**，只差 payload 欄位。

### 與目前 waveform.jsx 的距離
目前 [waveform.jsx](frontend/src/components/audio/waveform.jsx) 是「整條 timeline 只播一個音檔」的單軌設計（單一 sourceNode）。多軌時要改寫成：一個 AudioContext + N 個 AudioBufferSourceNode mix + 每軌獨立 gain node，預先 decode 引用音檔 cache 成 AudioBuffer。

### 與後端的關係
- 後端音檔池（`MUSIC_FILE_PATH=/music`）維持不變
- 韌體不關心音訊（只吃 PlayerData），`color` collection 路徑完全不變
- 「專案 ↔ 音軌 ↔ 音檔池」關聯塞進 raw_data 的 v2 envelope（`tracks` 陣列），後端不解析
