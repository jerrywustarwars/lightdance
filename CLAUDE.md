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

# 檢查連接埠占用
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
store 存的是 **segments**（色塊），不是關鍵格：

```js
actionTable[armorIndex][partIndex] = [
  { id, start, end, colorStart: {R,G,B,A}, colorEnd: {R,G,B,A}, linear },
  ...
]
```

armorIndex 0-6（舞者），partIndex 0-21（14 個身體部位 + 8 個配件 LED）。
時間單位是毫秒且對齊 `TICK_MS`（50ms）網格，`linear` 為 1 時段內從
`colorStart` 漸變到 `colorEnd`。

**段與段之間可以有間隔，間隔就是熄滅**——黑色不是資料。壓平回韌體格式時
空隙前會在網格整點補一個黑關鍵格，所以韌體看到的東西不變（有等價測試守著）。

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
| `WorksetBar.jsx` | `useWorksets` | 工作集：具名軌道組的切換 / 新增 / 改名 / 刪除 |

`Timeline.jsx` 的拖曳/resize 運算已在 Phase 5f 抽到
`utils/segments/gestures.js`（`movableRange` / `moveSegments` / `resizeSegment`
三個純函式），元件裡只剩像素換算與直接寫 DOM。`waveform.jsx` 內部尚未拆。

### 文件檔案
- **`README.md`**：專案說明文件（散文式，重點在資料模型與驗收方式）
- **`docs/technical-analysis.md`**：詳細技術分析報告（架構、API、安全問題、改進路線圖）
- **`docs/configuration.md`**：完整配置說明（環境變數、API 端點、部署模式）
- **`docs/data-flow-pipeline.md`**：從編輯器到資料庫的完整資料流說明
- **`docs/backend-management.md`**：MongoDB 備份與 Docker 管理操作指南
- **`docs/network-architecture-refactor-plan.md`**：網路路由架構重構計畫
- **`docs/shortcuts.md`**：鍵盤快速鍵速查表，前端 Home 頁面可透過 Shortcuts 按鈕查看
- **`docs/troubleshooting-login-500.md`**：MongoDB 連線 500 錯誤 SOP
- **`docs/frontend-rendering-optimization.md`**：前端渲染邏輯與效能優化詳解（元件樹、播放管線、Redux 配置、memo 策略、區塊索引語意、duration 溢出防護）
- **`docs/ui-design-plan.md`**：UI 設計系統的診斷、六項拍板決策與施工回顧（token 層、無彩色原則、按鈕階層、時間刻度尺）

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
npm run e2e            # 33 項：放色 / 選取 / 剪下 / undo / 快捷鍵 / 重新整理 /
                       #        拖曳 resize / 多段一起搬 / 刻度尺 / 道具 /
                       #        工作集 / 行高 / Output / /edit
npm run audit:layout   # 5 項：控制項被蓋住 / 元素溢出容器 / 提示被裁掉 /
                       #      成對元素沒對齊 / 各塊邊緣與各排內容左緣沒對齊
```

兩支都會把截圖存在 `frontend/e2e/shots/`。動過 CSS、版面或快捷鍵之後請跑一次
——它們抓到過 jsdom 測試全綠但實際完全不能用的問題（Ctrl+數字被防彈跳吃掉、
Edit/Logout 被橫幅蓋住、舞者開關蓋掉 12 個光衣部位、按鈕階層被 Bootstrap 的
`.btn` 蓋掉、17 則提示有 12 則被 `overflow` 裁光）。

⚠️ 若出現 `編輯器一直載入不了` / `一直被彈回首頁`，**先重開 `npm run dev` 再判斷**。
連續改一堆 CSS 之後 vite 的 HMR 狀態會累積到 `/home` 載不起來，這是開發伺服器的
問題不是程式碼的問題（重開後同一份程式碼就全過）。

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

**欄寬只定義在兩個地方**：上半部在 `pages/Home.css` 的 `.homepage`
（`--page-inset` / `--palette-w`），下半部在 `ControlPanel.css` 的 `.control-panel`
（`--gutter-w` 左側軌名欄寬、`--row-inset` 每一排內容的左內縮）。

這些數字先前散在四個 CSS 檔各寫各的，實測出過三種對不齊：上半部右緣停 1427 而
下半部停 1595；三排的內容左緣是 12 / 6 / 1；軌名欄 15%（240px）而播放器從 235px
開始，兩者重疊 5px。版面稽核的第五項同時守容器邊緣與各排的內容左緣——後者用
容器比較是抓不到的，三排的容器都從 0 開始，差別在各自的內縮。

**光衣的幾何在 `config/armorShapes.js`**，圖形與選取高亮吃同一組座標（先前兩份
各寫一遍，鞋子的高亮框比鞋子高 10px）。圓角由短邊推導、不逐個手填，
`viewBox` 收緊到圖形的實際範圍。點某個部位請用 `data-part` 指名，
不要用「第 N 個有 fill 的元素」——帽子與領帶各由兩個形狀組成。

完整的設計決策與施工回顧見 `docs/ui-design-plan.md`。

### 工作集（軌道組合）

154 條時間軸不可能同時擺在畫面上，所以軌道一直由使用者自己挑。**那組挑選現在
是具名的、存得起來、可以一鍵切換**——`utils/worksets.js` 是形狀與不變式的
唯一定義處，`hooks/useWorksets.js` 是唯一的讀取入口。

寫入仍然走既有的 `updateShowPart(tracks)`：payload 形狀沒變，只是 reducer 把它
寫進**目前那一組**。加軌、移除、上下移、套用選取四個呼叫端因此一行都沒改。

⚠️ 讀取一律用 `useActiveTracks()` / `useWorksets()`，不要自己去讀
`state.profiles.worksets`。「目前是哪一組」必須只有一個答案，否則軌名列與
Timeline 有機會顯示不同組——而且畫面看起來都正常，只是點某一軌會編到別條。

兩個不變式由 `worksets.js` 保證：`sets` 至少留一組（刪到剩一組就不准再刪，
沒有工作集的話畫面上一條軌道都沒有），`activeId` 永遠指得到東西（指不到時
退回第一組而不是回傳 null）。舊的 `showPart` 由 persist 的 outbound transform
收成「未命名」那一組，靠形狀辨認、不看版本號。

### 道具就掛在人旁邊

飾品燈原本列在右側一個獨立的「裝備編輯」側欄，離它所屬的舞者好幾百像素遠——
播放的時候看不出「這位舞者的刀亮了」。現在它們畫在**同一張光衣卡片裡、與人並排**
（`Armor.jsx` 的 `.armor-props`），顏色和光衣一樣走 `getColorAt(segments, time)`，
播放時整個人連同手上的東西一起亮。

身體部位一直都能在光衣上點，所以右側不需要再列一份部位清單；右欄現在只剩調色盤
（`--palette-w: 200px`，先前「調色盤 168 + 飾品側欄 200」共 376px）。

⚠️ **光衣卡片的寬度是先分好的**（`.personBackGround { flex: 1 1 0 }`），圖形再在
裡面等比縮放。先前卡片寬度由 SVG 的固有比例撐出來，人與道具並排之後那條路走不通
——SVG 在 flex row 裡沒有固有寬度，卡片沒有確定寬度時它不是塌成一條線就是溢出到
卡片外面（兩種都實測過）。`.armor-figure` 的 `min-width: 0` 也不能拿掉，
flex 項目的預設最小寬度是內容寬，少了它道具一多就會把圖形推出去。

### 軌道行高

**高度是像素，不是百分比**（`utils/tracks.js`）。舊版是 `100 / 軌道數 %`，
超過 7 條之後改成寫死的 14%——高度由軌道數決定，加一條軌就把其他每一條壓矮，
使用者說了不算。而且左側軌名欄與右側時間軸各自算自己的百分比，兩邊容器只要
有一點高度差，捲到下面時軌名就會對到隔壁那條軌（畫面上完全看不出來）。

全域行高在 `state.profiles.rowHeight`，逐軌覆寫在 `track.height`
（`trackHeight(track, rowHeight)` 是唯一的取值方式）。低於 `COMPACT_ROW_H`
時軌名列收起上下移與刪除——那兩顆疊起來要 56px，硬留著會變成畫得出來但點不到。

逐軌把手拖曳時只改自己的 DOM，**放開才 dispatch 一次**：每格像素都寫 redux
的話 154 條 Timeline 會跟著重繪，手感會變成一格一格跳。

### 手勢（拖曳與 resize）

運算在 `utils/segments/gestures.js`，元件裡只剩像素換算與寫 DOM。

**「能移多遠」只有 `movableRange` 一份答案**：像素預覽拿它換算成像素，放開時
`moveSegments` 拿它決定最終落點。先前 Timeline 自己用像素重算一遍邊界，那正是
「拖到底了但放開後又跳一點」那類錯位的來源。最小間距與最小長度兩個常數同理，
只在那個檔案定義一次。

多選時整批共用**同一個位移量**（相對位置不變，樂句的節奏才不會跑掉），
可動範圍是每一段各自對「最近的未選取鄰居」的限制取交集。範圍**永遠包含 0**
——色塊允許首尾相接，這時「至少留 50ms」的下界是正數，少了這道夾緊，
拖 0 像素會把色塊自己彈開一格。

邊界情況（撞到鄰居、越過 0、超過總長、被夾死、縮到最小、首尾相接、
表演長度還沒載入）在 `utils/segments/__tests__/gestures.test.js` 窮舉過。
真正的手感（幾何接線）只有 `npm run e2e` 的拖曳兩項驗得到，jsdom 量不到版面。

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
| 光衣圖形 | 幾何在 `config/armorShapes.js`（一張表，索引 = 身體部位索引），新增部位要自己補一列座標 |
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

- **2026-08-14（深夜）**：**下半部三排對齊**。工作集列、工具列、軌名列的內容
  左緣先前是 12 / 6 / 1，工作集列的右緣停在 1600 而其他停在 1595，左側軌名欄
  （15% = 240px）還和播放器（從 235px 開始）重疊 5px。收成 `.control-panel` 的
  `--gutter-w` / `--row-inset` 兩個變數之後三排一致。版面稽核第五項加上「各排
  內容左緣」——容器比較抓不到這個，三排的容器都從 0 開始，差別在各自的內縮
  （故意把內縮改成 30px 驗過，稽核會指出差 18px）。
- **2026-08-14（晚）**：**道具搬到人旁邊，右欄收成純調色盤**。飾品燈原本在右側
  一個獨立側欄裡，離所屬的舞者好幾百像素遠，播放時看不出「這位舞者的刀亮了」；
  現在畫在同一張光衣卡片裡與人並排，顏色一樣走 `getColorAt`，播放時整個人連同
  手上的東西一起亮。身體部位本來就能在光衣上點，右側不需要再列一份清單，
  於是右欄從「調色盤 168 + 飾品側欄 200 = 376px」收成單一 200px。
  調色盤改橫排（調色器與 HEX／亮度並排、最愛色一列六格）——直排時它自己就 272px，
  而這一欄在 1280×800 下只有 220px。版面稽核抓到 header 在 1280 寬被擠到溢出
  （六顆按鈕放不下，flex 不自己裁切，最後一顆跑到右欄底下被蓋住），修法是讓右欄
  從 header 下方才開始、header 拿回整個寬度，解耦而不是調數字。
  光衣卡片的寬度改成先分好再縮放圖形（`flex: 1 1 0`）：與道具並排之後 SVG 在
  flex row 裡沒有固有寬度，舊的「由內容撐開」會讓它塌成一條線或溢出卡片。
  e2e 31 → 33。測試 393 passed

- **2026-08-14（下午）**：**軌道行高可調**。高度從「`100 / 軌道數 %`，超過 7 條
  改寫死 14%」換成使用者指定的像素（`utils/tracks.js`）。舊模型有兩個問題：
  加一條軌會把其他每一條壓矮，以及左右兩欄各自算自己的百分比——容器高度只要
  有一點差，捲到下面軌名就對到隔壁那條軌，而畫面上完全看不出來。現在兩欄吃
  同一個數字，對齊是結構上保證的（e2e 直接量兩邊的 `getBoundingClientRect`）。
  工作集列加行高滑桿，軌名列左緣加逐軌把手（拖曳中只改 DOM、放開才 dispatch），
  低於 64px 自動收起上下移與刪除。e2e 27 → 31。測試 395 passed
- **2026-08-14**：**工作集**。`showPart` 從一個沒有名字的陣列升級成具名軌道組
  （`utils/worksets.js` + `hooks/useWorksets.js` + `WorksetBar.jsx`），可以命名、
  存起來、一鍵切換。新增時預設複製目前這一組——多數新組是從現有的微調而來
  （「上半身」是從「全身」拿掉腿和鞋），從空白開始要重加十幾條。
  既有的四個寫入端一行都沒改：`updateShowPart` 的 payload 形狀不變，
  只是 reducer 把它寫進目前那一組。舊 persist 資料由 outbound transform 收成
  「未命名」，靠形狀辨認不看版本號，順便丟掉已移除的 `hidden` 欄位。
  另外移除軌道的眼睛按鈕——它把軌道設成 `opacity: 0` 但**照樣佔滿高度**，
  變成看不見也點不到的空白帶，而且 persist 裡存了 `hidden: true` 的話使用者
  除了刪掉那條軌之外沒辦法讓它回來（按鈕就在那條看不見的列上）。
  e2e 24 → 27。測試 385 passed
- **2026-08-13（深夜）**：**光表區對齊與光衣重畫**。上下兩塊的右緣先前一個停在
  1427、一個停在 1595（欄寬散在三個 CSS 檔各寫各的），右上角空出 168px 的缺口。
  收成 `.homepage` 的三個變數之後兩塊都是 0..1595，版面稽核加第五項守住。
  光衣的幾何抽到 `config/armorShapes.js`：`Armor.jsx` 從 14 段重複 JSX（圖形一份、
  選取高亮一份，鞋子的高亮框因此比鞋子高 10px）變成一張表驅動的 141 行；
  `viewBox` 原本 480 高而內容只到 348，**底下空了 130px**，收緊後同一張卡片裡的
  光衣大了三成且置中；圓角改由短邊推導、帽子拆成兩個圓角矩形、加了舞台地板線、
  舞者標籤從浮在頭上的膠囊改成卡片的標題列（SVG 不必再往下平移 35px 讓位）、
  目前編輯裝備的那位舞者卡片會亮邊框。點部位改用 `data-part` 指名——先前單元測試
  與 e2e 都用「第 N 個有 fill 的元素」，帽子與領帶各有兩個形狀之後會靜默點錯。
  測試 356 passed
- **2026-08-13（晚）**：**Phase 6 起步：多個色塊一起搬**。`gestures.js` 新增
  `movableRange`（能移多遠的單一真相）與 `moveSegments`，`moveSegment` 收成它的
  單元素版本。Timeline 的像素預覽改問同一個函式——先前它自己用像素重算一遍邊界，
  那是「拖到底又跳一點」的來源；兩份重複的拖曳 commit 邏輯（其中一份多一個守衛，
  於是兩條路徑行為不同）也收成一份。順手修掉兩個洞：色塊首尾相接時拖 0 像素會
  自己彈開 50ms（範圍沒夾住 0）、表演長度還沒載入時 `duration` 是 undefined 會讓
  NaN 流進位移把 start/end 寫壞。另外擋下「會讓光表縮小的 commit」——四個呼叫端
  都拿 hook 給的表當基準，而它在資料還沒載入時是空陣列，整場表演會被靜默清空。
  e2e 22 → 24。測試 354 passed
- **2026-08-13**：**Phase 5g 完成，黑色哨兵從執行路徑消失**。刪掉
  `withKeyframeAdapter.js` / `useKeyframeActionTable.js` /
  `insertColorKeyframes.js` / `LEGACY_BLACK_SENTINEL_MS`，以及選取項目上的
  `blockIndex`——現在 `multiSelectedBlocks` 只帶 `{armorIndex, partIndex, segmentId}`。
  最後兩個轉接橋使用者原生化：audioplayer 的調色盤／最愛色改走
  `insertColorSegment`，`EditActionTable` 從關鍵格表格改寫成 segment 表格
  （start / end / 兩端顏色 / linear），本地那份 JSON 深拷貝歷史換成全域 undo。
  補上時抓到兩個真的 bug：調色盤 effect 少了「顏色沒變就回傳原陣列」的判斷會
  **無限重繪**（舊版靠 immer 的結構共享矇混過去）；`EditActionTable.css` 有裸的
  `button` / `table` 選擇器，一 import 就把首頁標題撐出容器 1237px。
  e2e 新增 `/edit` 兩項（20 → 22）。測試 336 passed
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
4. **Phase 5（5a–5g 全部完成）**：逐寫入者 segment 原生化並拆橋。放色、工具列、
   效果選單、複製貼上、區間平移、拖曳與 resize 全部改成直接操作 segments。
   5g 收尾刪掉 `blackSentinel.js`、`withKeyframeAdapter.js`、
   `useKeyframeActionTable.js`、`insertColorKeyframes.js`、`LEGACY_BLACK_SENTINEL_MS`
   與選取項目上的 `blockIndex`——**黑色哨兵與陣列索引在執行路徑上完全消失**，
   keyframe 只剩壓平輸出時存在（`segmentsToKeyframes`）
5. **Phase 6**：blink 改 `seg.effect` metadata（壓平才展開）、框選、多 segment 拖曳、對齊節拍

### 注意事項

- **零 re-render 拖曳路徑必須保留**（詳見 `docs/frontend-rendering-optimization.md`）：手勢期間 direct-DOM transform、commit 恰好一次 dispatch、undo 合併一筆。
  Phase 5f 之後手勢的**運算**抽到 `utils/segments/gestures.js` 成為純函式
  （`moveSegment` / `resizeSegment`），元件裡只剩像素換算與寫 DOM——
  兩邊必須共用同一組常數，否則會出現「拖到底了但放開後又跳一點」
- actionTable 容器統一為巢狀 **array**
- 韌體輸出欄位順序（hat..acc7）是 ABI，用測試鎖定
- `GET /api/raw/{u}/LATEST` 查錯 collection 的 bug 已修（2026-08-12）

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
