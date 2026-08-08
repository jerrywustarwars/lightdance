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

### 程式碼重構
1. 保持向後相容性
2. 增加適當的註解說明變更原因
3. 確保重構後符合程式碼品質標準

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
