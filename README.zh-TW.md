# n8n-nodes-n8nmcpclient (繁體中文)

這是一個 n8n 社群節點套件。它提供了與實現模型上下文協定 (Model Context Protocol, MCP) 的伺服器進行互動的節點。

[模型上下文協定 (MCP)](https://modelcontextprotocol.io) 允許應用程式以標準化方式為大型語言模型 (LLM) 提供上下文，將提供上下文的關注點與實際的 LLM 互動分離。這個節點套件允許 n8n 工作流程，特別是 AI Agent，連接並利用 MCP 伺服器。

[n8n](https://n8n.io/) 是一個採用 [fair-code 授權](https://docs.n8n.io/reference/license/) 的工作流程自動化平台。

[安裝](#安裝)
[節點](#節點)
[開發](#開發)
[發佈](#發佈)
[操作](#操作-smart-mcp-client)
[憑證](#憑證)
[相容性](#相容性)
[使用方式](#使用方式)
[資源](#資源)

## 安裝

請遵循 n8n 社群節點文件中的[安裝指南](https://docs.n8n.io/integrations/community-nodes/installation/)。搜尋 `n8n-nodes-n8nmcpclient`。

## 開發

本節說明如何設定本地開發環境來開發此節點套件。此方法使用安裝為開發依賴項的 n8n，避免了在使用全域安裝的 n8n 和 `pnpm link` 時，原生模組（如 `sqlite3`）常見的問題。

### 先決條件

*   **Node.js**: 版本 18.10 或更高 (使用 `node -v` 檢查)。
*   **pnpm**: 版本 9.1 或更高 (使用 `pnpm -v` 檢查)。透過 `npm install -g pnpm` 安裝。
*   **(僅限 Windows) 建置工具**: 為了正確建置 `sqlite3` 依賴項，您需要 Python 和 Microsoft C++ Build Tools。
    *   從官方網站或 Microsoft Store 安裝 Python。
    *   安裝 Build Tools for Visual Studio (安裝時選擇 "使用 C++ 的桌面開發" 工作負載)。
    *   如果 `pnpm install` 在 `sqlite3` 步驟失敗，您可能需要在安裝依賴項之前設定 `GYP_MSVS_VERSION` 環境變數 (例如 `$env:GYP_MSVS_VERSION='2022'`) 來幫助 npm/pnpm 找到建置工具。

### 設定

1.  **克隆儲存庫：**
    ```bash
    git clone https://github.com/golfamigo/n8n-nodes-n8nmcpclient.git
    cd n8n-nodes-n8nmcpclient
    ```

2.  **安裝依賴項：**
    這將安裝節點的依賴項以及 n8n 本身作為開發依賴項。
    ```bash
    pnpm install
    ```
    *(如果在 Windows 上遇到與 `sqlite3` 相關的錯誤，請確保滿足建置工具的先決條件，並嘗試在再次執行 `pnpm install` 之前設定 `GYP_MSVS_VERSION`，或在安裝後執行 `npm rebuild sqlite3`。)*

3.  **建置節點：**
    將 TypeScript 程式碼編譯成 JavaScript 到 `dist` 目錄。
    ```bash
    pnpm run build
    ```

### 本地運行

1.  **添加啟動腳本 (可選但建議)：**
    將以下腳本添加到您的 `package.json` 的 `"scripts"` 下，以便使用正確的設定輕鬆啟動 n8n。請選擇適合您偏好的 shell (cmd 或 PowerShell) 的語法。

    ```json
    // package.json
    "scripts": {
      // ... 其他腳本 ...
      "dev:n8n": "$env:DB_TYPE='sqlite'; $env:N8N_HOST='127.0.0.1'; $env:N8N_RUNNERS_ENABLED='true'; n8n start" // PowerShell 語法
      // 或適用於 cmd.exe:
      // "dev:n8n": "set DB_TYPE=sqlite&& set N8N_HOST=127.0.0.1&& set N8N_RUNNERS_ENABLED=true&& n8n start"
    }
    ```

2.  **啟動 n8n：**
    在專案根目錄運行腳本 (如果已添加) 或完整命令：
    ```bash
    pnpm run dev:n8n
    ```
    或直接執行：
    ```bash
    # PowerShell
    $env:DB_TYPE='sqlite'; $env:N8N_HOST='127.0.0.1'; $env:N8N_RUNNERS_ENABLED='true'; pnpm exec n8n start
    # cmd.exe
    set DB_TYPE=sqlite&& set N8N_HOST=127.0.0.1&& set N8N_RUNNERS_ENABLED=true&& pnpm exec n8n start
    ```
    n8n 將啟動，使用本地的 `sqlite.db` 檔案進行儲存，並自動從 `dist` 目錄加載您的自訂節點。請在 `http://127.0.0.1:5678` 訪問 n8n。

### 開發工作流程

1.  **修改** 節點的 TypeScript 原始檔 (位於 `nodes/` 或 `credentials/`)。
2.  **停止** 正在運行的 n8n 實例 (在終端中按 Ctrl+C)。
3.  **重新建置** 節點以編譯您的變更：
    ```bash
    pnpm run build
    ```
4.  使用您的啟動命令 **重新啟動** n8n (例如 `pnpm run dev:n8n`)。

*(提示：您可以在另一個終端中運行 `pnpm run dev`，以便在保存時自動重新編譯 TypeScript 檔案。如果您更改了圖標或由 gulp 處理的其他資產，您仍然需要停止/重新啟動 n8n 並手動運行 `pnpm run build`。)*

## 發佈

要將此套件的新版本發佈到 npm：

1.  **確保測試通過** (如果適用)。
2.  **運行 prepublish 腳本：** 此腳本通常會建置專案並運行 linter 以確保程式碼品質。
    ```bash
    pnpm run prepublishOnly
    ```
3.  **更新版本號：** 根據 [語意化版本控制 (Semantic Versioning)](https://semver.org/) 編輯 `package.json` 中的 `version` 欄位。
4.  **提交您的變更：**
    ```bash
    git add .
    git commit -m "chore: release vX.Y.Z"
    git tag vX.Y.Z
    git push && git push --tags
    ```
5.  **發佈到 npm：** 確保您已登入 npm (`npm login`)。
    *(注意：只有 `package.json` 中 `"files"` 欄位指定的 `dist` 目錄內容會被包含在發佈的套件中。像 `n8n` 本身這樣的開發依賴項不會被發佈。)*
    ```bash
    pnpm publish
    ```

## 節點

*   **Smart MCP Client (`smartMcp`)**: 透過 STDIO 或 SSE 連接到 MCP 伺服器，並允許與其功能 (工具、資源、提示) 互動。設計用於 n8n AI Agent。

## 操作 (Smart MCP Client)

*   **探索功能 (用於 AI Agent)**: 連接到 MCP 伺服器並列出所有可用的工具、資源和提示。資源和提示會以偽工具 (pseudo-tools) 的形式呈現 (前綴為 `resource_` 或 `prompt_`)，並帶有關聯的元數據，使其可透過標準的工具執行機制被 AI Agent 探索和使用。當將此節點與 AI Agent 一起使用時，這是推薦的操作。
*   **執行工具**: 在連接的 MCP 伺服器上執行特定的工具 (真實的 MCP 工具或代表資源讀取/提示檢索的偽工具)。需要工具名稱和 JSON 格式的參數。
*   **讀取資源**: 從 MCP 伺服器讀取特定資源 URI 的內容。
*   **取得提示**: 從 MCP 伺服器檢索特定的提示模板。
*   **列出工具**: 僅列出 MCP 伺服器上可用的實際工具。
*   **列出資源**: 僅列出 MCP 伺服器上可用的資源。
*   **列出資源模板**: 列出 MCP 伺服器上可用的資源模板。
*   **列出提示**: 僅列出 MCP 伺服器上可用的提示。

## 憑證

此節點套件包含兩種憑證類型：

1.  **MCP Client (STDIO) API (`mcpClientApi`)**:
    *   用於透過標準輸入/輸出 (STDIO) 連接到作為本地命令列進程啟動的 MCP 伺服器。
    *   **Command (命令)**: 執行以啟動 MCP 伺服器的命令 (例如 `node path/to/server.js`, `python script.py`)。
    *   **Arguments (參數)**: 傳遞給命令的以空格分隔的參數。
    *   **Environments (環境變數)**: 伺服器所需的 `名稱=值` 格式的環境變數，以逗號分隔 (例如 API 金鑰)。

2.  **MCP Client (SSE) API (`mcpClientSseApi`)**:
    *   用於透過 HTTP 上的伺服器發送事件 (Server-Sent Events, SSE) 連接到遠端的 MCP 伺服器。
    *   **SSE URL**: MCP 伺服器的 SSE 端點 URL (例如 `http://localhost:3001/sse`)。
    *   **Messages Post Endpoint (訊息回傳端點)** (可選): 如果回傳訊息給伺服器的端點與基礎 SSE URL 不同，則指定自訂 URL。
    *   **Additional Headers (額外標頭)** (可選): 要包含在請求中的標頭，通常用於身份驗證 (例如 `Authorization: Bearer YOUR_TOKEN`)。格式：每行一個標頭 (`標頭名稱: 值`)。

## 相容性

*   需要 n8n 版本 1.0 或更高。
*   需要 Node.js 版本 18.10 或更高。

## 使用方式

當在 n8n **AI Agent** 中使用 **Smart MCP Client** 節點時：

1.  將 **Smart MCP Client** 節點添加到您的工作流程中。
2.  配置 **Connection Type (連接類型)** 和相應的 **Credentials (憑證)**。
3.  將 **Operation (操作)** 設定為 **Discover Capabilities (for AI Agent) (探索功能 (用於 AI Agent))**。
4.  將 **Smart MCP Client** 節點的輸出連接到 **AI Agent** 節點的 **Tool (工具)** 輸入。

AI Agent 將自動調用 `discoverCapabilities` 操作來了解 MCP 伺服器上可用的工具、資源和提示。然後，它可以決定透過調用 Smart MCP Client 節點上的 `executeTool` 操作來使用這些功能中的任何一個，並傳遞適當的工具名稱 (例如 `get_weather`, `resource_userProfile`, `prompt_summarize`) 和參數。

對於手動工作流程使用 (不使用 AI Agent)，您可以選擇特定的操作，如 `Execute Tool`、`Read Resource` 等，並直接在節點的 UI 中提供必要的參數。

## 資源

*   [n8n 社群節點文件](https://docs.n8n.io/integrations/community-nodes/)
*   [模型上下文協定 (MCP) 文件](https://modelcontextprotocol.io)
*   [MCP 規範](https://spec.modelcontextprotocol.io)
*   [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
