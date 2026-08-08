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
## 色塊資料模型重構計畫 (進行中)

> 詳細執行步驟與 checklist 見 [todo.md](todo.md)。本章節記錄設計動機與已拍板的決策，
> 讓未來的協作者（與 Claude）一進專案就能看到方向。

### 為什麼要改

目前 `actionTable[armor][part] = [{time, color, linear}, ...]` 是「關鍵格 + 黑色哨兵」模型。
為了表達「色塊在此結束、不要漸變到下一段」，必須在前後塞純黑斷點，導致：

- [Armor.jsx `insertArray`](frontend/src/components/Armor.jsx) 有 5 分支判斷前/後是不是黑，
  並用魔術數字 `blackthreshold = 10ms` 偷偷偏移使用者輸入的時間
- [ControlPanel.jsx](frontend/src/components/ControlPanel.jsx) W/S/A/D 必須「自動跳過黑色」
- [Home.jsx `cleanActionTableByDuration`](frontend/src/pages/Home.jsx) 要重新尋找/補上黑色終止格
- 線性插值 (`handleOutput`) 要抓 prev/next/afterNext 三格才能算對顏色
- 拖曳色塊 / resize / Ctrl 框選複製貼上 等 DAW 風功能 **幾乎做不到**，
  因為「色塊」根本不是資料模型中的一級物件

根因：**資料形狀沒有顯式表達色塊邊界**，整份程式碼一直在從「關鍵格序列 + 鄰居黑色」反推色塊在哪。

### 新模型 (已拍板)

```js
actionTable[armor][part] = [
  { id, start, end, colorStart: {R,G,B,A}, colorEnd: {R,G,B,A} },
  ...
]
```

**核心決策：**
| 項目 | 決策 |
|---|---|
| segment 之間 | **可以有間隔**，間隔 = LED 關閉 (黑) |
| 時間最小單位 | **50ms**，所有 `start` / `end` 都對齊 50ms 網格 |
| 漸變語意 | **(A) 段內漸變** — `colorStart → colorEnd` 在 `[start, end]` 內線性插值；無漸變則 `colorEnd === colorStart` |
| 拖曳碰撞策略 | **trim** — 新 segment 蓋到舊 segment 上時，舊 segment 被覆蓋的部分被裁掉 (可能 split 成兩段) |
| 空白區域語意 | **黑色** (LED off)，與現況一致，硬體輸出不變 |
| 後端格式 | **完全不變** — `upload_items` / `upload_raw` / mongo `color` & `raw_json` collection schema 維持原樣，**所有轉換在前端完成** |
| 不變式 | segment 不重疊；`start <= end`；都對齊 50ms |
| segment 識別 | 每段有穩定 `id`（uuid 或自增），方便多選、複製貼上、undo diff |

### 對現有 UI 的影響（重構後）

| 功能 | 重構前 | 重構後 |
|---|---|---|
| 點光衣放色 | 5 分支 + 10ms 黑色偏移 | `insertSegment(start, end, color)`，碰撞用 trim split，約 15 行 |
| 渲染當前時間 | binary search keyframe → 看 linear → 看 afterNext → 三格內插 | 找包含 `t` 的 segment；有則 `lerp(colorStart, colorEnd, (t-start)/(end-start))`，無則黑 |
| W/S/A/D 跳格 | 要 skip black | 直接 `segments[i±1]` |
| `cleanActionTableByDuration` | 過濾 + 補黑 + 排序 | `segments.filter(s => s.start < dur).map(s => ({...s, end: min(s.end, dur)}))` |
| 匯出壓平 (`handleOutput` 50ms 取樣) | 走 keyframe + linear 三格 | 對每個 tick `t` 找包含 `t` 的 segment（O(log n)），無則輸出黑色 0 |
| Undo/Redo | reducer diff 整張 table | 可用 segment id 細粒度 diff，連續拖曳可 coalesce 成一筆 |

### 重構後可解鎖的新功能

- **拖曳移動色塊**（DAW 風）：改 `seg.start/end`，碰撞 trim
- **拖邊 resize**：改單一端點
- **Ctrl 框選多個色塊**：`selectedIds = Set<id>`
- **複製 / 貼上 / 時間平移**：deep clone 後加 offset
- **量化 / 對齊到節拍**

### 遷移策略 (漸進式，每步可獨立 ship/rollback)

1. 寫雙向轉換器 `keyframesToSegments()` / `segmentsToKeyframes()` 放 utils
2. **驗證腳本**：對現有 raw_json 跑 `keyframes → segments → 壓平`，與直接從 keyframes 壓平的 `upload_items` payload 做 **byte-equal diff**，全綠才繼續
3. 載入時 lazy migrate（後端格式不變，只在前端 in-memory 轉換）
4. 依序改：Armor render → `insertArray` → EditActionTable → ControlPanel → `handleOutput`
5. 移除 `blackthreshold` 與 `cleanActionTableByDuration` 補黑邏輯
6. 開始加 DAW 風新功能

### 注意事項

- segment **不重疊** 是強制不變式，所有寫入路徑（insert / drag / resize / paste）都必須保證
- 單 tick 閃爍：以 `end - start === 50` 表達（最小單位）
- `keyframesToSegments` 轉換規則：遇到非黑 keyframe 開新 segment，下一個黑 keyframe 或下一個非黑 keyframe 為終點；若原 keyframe `linear === 1`，則 `colorEnd` 取自下一格顏色
- **暫不支援鏈式漸變**（連續多個 `linear === 1`）：使用者若需相同效果，自行拉多個相鄰 segment。轉換器遇到鏈式時，把每段拆獨立 segment（中間 keyframe 同時當前段 end 與下段 start，邊界用半開區間 `[start, end)` 避免重複取樣）
- 後端壓平輸出 (`upload_items`) 必須 byte-equal 等價於現況，否則硬體會看到不同畫面

## 長期願景：多軌音訊（DAW 風）

未來目標是讓**音軌也像色塊一樣可拖曳、可拼貼多個音軌**，修改音樂時不用重新上傳整首。

### 為何寫進這份檔案
這個願景會反向影響 segment 重構的介面設計：
- segment utils 必須做成 **generic `Segment<T>`**，不能寫死 `colorStart/colorEnd`
- 拖曳/resize/move 的 UI 邏輯（重構後的 Timeline）必須能被音軌複用
- 50ms 量化、trim collision、id/多選/undo coalesce 都要 generic

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
目前 [waveform.jsx](frontend/src/components/audio/waveform.jsx) 是「整條 timeline 只播一個音檔」的單軌設計（單一 sourceNode）。多軌時要改寫成：一個 AudioContext + N 個 AudioBufferSourceNode mix + 每軌獨立 gain node。Phase 0/0.5 拆檔時要避免把單軌假設更深地綁進新元件。

### 與後端的關係
- 後端音檔池 (`MUSIC_FILE_PATH=/music`，host 端是 `./music_file/`) 維持不變
- 韌體不關心音訊（只吃 PlayerData），所以 `color` collection / `upload_items` 路徑完全不變
- 新增「專案 ↔ 音軌 ↔ 音檔池」的關聯（mongo 新 collection 或塞進 `raw_json.tracks`）

詳細執行步驟見 [todo.md](todo.md) Phase 6。

> ⚠️ 死代碼提醒：[frontend/src/components/audio/musicsrc/](frontend/src/components/audio/musicsrc/) 是**前端 webpack bundle 的歷史遺留**，與後端音檔池完全無關，已在 Phase 0 cleanup 中刪除。未來多軌會走後端 API，不會回頭用 musicsrc。

