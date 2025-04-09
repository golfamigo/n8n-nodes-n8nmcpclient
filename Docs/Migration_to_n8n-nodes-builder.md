# 將 n8n-nodes-n8nmcpclient 遷移至 n8n-nodes-builder 開發環境

本文件記錄了將 `n8n-nodes-n8nmcpclient` 專案遷移至使用 `n8n-nodes-builder` (https://github.com/mathisgauthey/n8n-nodes-builder) 開發環境的步驟。`n8n-nodes-builder` 提供了一個基於 Docker Dev Container 的環境，旨在簡化 n8n 自訂節點的開發流程。

## 遷移步驟

1.  **複製 n8n-nodes-builder 儲存庫：**
    *   使用 Git 將 `n8n-nodes-builder` 儲存庫複製到本地。
    *   指令：`git clone https://github.com/mathisgauthey/n8n-nodes-builder E:\github\n8n-nodes-builder`
    *   *(注意：目標路徑 `E:\github\n8n-nodes-builder` 是根據使用者要求設定的)*

2.  **建立 custom-nodes 資料夾：**
    *   在 `E:\github\n8n-nodes-builder` 資料夾內建立一個名為 `custom-nodes` 的子資料夾。
    *   指令 (部分)：`mkdir E:\github\n8n-nodes-builder\custom-nodes`

3.  **複製專案檔案：**
    *   將原始專案 `e:\gitHub\n8n-nodes-n8nmcpclient` 的所有內容複製到新建立的 `custom-nodes` 資料夾下，目標路徑為 `E:\github\n8n-nodes-builder\custom-nodes\n8n-nodes-n8nmcpclient\`。
    *   指令：`xcopy e:\gitHub\n8n-nodes-n8nmcpclient E:\github\n8n-nodes-builder\custom-nodes\n8n-nodes-n8nmcpclient\ /E /I /H /Y`
    *   *(注意：由於原始專案目錄可能正在使用中，因此採用複製而非移動)*

4.  **建立 .env 設定檔：**
    *   讀取 `E:\github\n8n-nodes-builder\.devcontainer\.env.example` 的內容。
    *   根據範本內容，在 `E:\github\n8n-nodes-builder\.devcontainer\` 資料夾下建立一個名為 `.env` 的新檔案。

## 後續設定與開發流程 (在 VS Code 中操作)

**疑難排解：連接埠衝突 (Port Conflict)**

*   如果在啟動 Dev Container 時遇到類似 `Bind for 0.0.0.0:5432 failed: port is already allocated` 的錯誤，表示你的電腦上已有其他程式 (可能是舊的 Docker n8n 或 PostgreSQL) 正在使用 5432 連接埠。
*   **解決方法：**
    1.  開啟 `E:\github\n8n-nodes-builder\.devcontainer\docker-compose.yaml` 檔案。
    2.  找到 `n8n_db` 服務下的 `ports` 設定。
    3.  將 `- "${DB_PORT}:5432"` 修改為 `- "5433:5432"` (或其他未被佔用的埠號，例如 5434、5435 等)。
    4.  儲存檔案後，重新嘗試「Reopen in Container」。

**疑難排解：init.sh 腳本錯誤 (Line Endings)**

*   如果在啟動 Dev Container 過程中，看到類似 `$'\r': command not found` 或 `syntax error near unexpected token` 的錯誤，且錯誤指向 `/workspace/.devcontainer/init.sh`，這通常是因為 `init.sh` 檔案使用了 Windows 的換行符 (CRLF) 而不是 Unix 的換行符 (LF)。
*   **解決方法：**
    1.  在 `E:\github\n8n-nodes-builder\.devcontainer\` 目錄下建立 `.gitattributes` 檔案，內容為：
        ```
        *.sh text eol=lf
        ```
        這樣 Git 會強制所有 `.sh` 檔案使用 LF 換行符。
    2.  在 VS Code 中打開 `init.sh`，點擊右下角的「CRLF」，選擇「LF」，然後儲存檔案。
    3.  確認 `devcontainer.json` 中 `"onCreateCommand": "bash /workspace/.devcontainer/init.sh"` 存在，這樣容器啟動時會自動執行 `init.sh`。
    4.  修正後，重新嘗試「Reopen in Container」。

**標準流程：**

1.  **關閉** 原始專案 (`e:\gitHub\n8n-nodes-n8nmcpclient`) 的 VS Code 工作區（如果已開啟）。
2.  在 VS Code 中 **開啟** `E:\github\n8n-nodes-builder` 資料夾。
3.  VS Code 應提示「Reopen in Container」。點擊此按鈕（或使用 `F1` -> `Dev Containers: Reopen in Container`）。
4.  等待 Dev Container 環境建置完成（首次啟動可能較久）。
5.  進入容器後，在 VS Code 的終端機中執行以下操作：
    *   切換到節點目錄：`cd /workspaces/n8n-nodes-builder/custom-nodes/n8n-nodes-n8nmcpclient`
    *   安裝依賴：`pnpm install`
    *   建置節點：`pnpm build` (或使用 `pnpm dev` 進行監看與自動建置)
6.  按下 `F5` 並選擇 `Start n8n`，即可在偵錯模式下啟動 n8n，此時你的自訂節點 (`SmartMcp`) 應已載入。

## 注意事項

*   原始專案路徑 `e:\gitHub\n8n-nodes-n8nmcpclient` 現在可視為備份。
*   所有後續開發工作應在 `E:\github\n8n-nodes-builder` 資料夾內，並透過 Dev Container 進行。
