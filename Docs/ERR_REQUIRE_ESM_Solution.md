# 解決 n8n 自訂節點中的 ERR_REQUIRE_ESM 錯誤

## 問題描述

在開發 n8n 自訂節點 (`n8n-nodes-n8nmcpclient`) 時，執行 `n8n start` 命令可能會遇到以下錯誤：

```
Error [ERR_REQUIRE_ESM]: require() of ES Module .../pkce-challenge/dist/index.node.js from .../n8n-core/dist/nodes-loader/load-class-in-isolation.js not supported.
```

這個錯誤發生是因為：
1.  自訂節點依賴了 `@modelcontextprotocol/sdk` 套件。
2.  `@modelcontextprotocol/sdk` (特別是 v1.8.0) 依賴了 `pkce-challenge` 套件。
3.  `pkce-challenge` 的某些版本 (例如 v4.x) 是純 ES Module (ESM) 格式。
4.  n8n 核心的節點載入機制 (`load-class-in-isolation.js`) 使用 CommonJS 的 `require()` 函數來載入節點及其依賴。
5.  CommonJS 的 `require()` 無法直接載入 ESM 格式的模組，導致 `ERR_REQUIRE_ESM` 錯誤。

## 嘗試過的解決方案

1.  **使用 `esbuild` 打包**: 嘗試將節點及其依賴打包成單一 CommonJS 檔案。但由於 `pkce-challenge` v4.x 使用了頂層 `await`，`esbuild` 無法將其打包成 CommonJS 格式。
2.  **降級 `pkce-challenge`**: 嘗試降級 `pkce-challenge` 到 v3.x，但問題仍然存在，可能是因為 `@modelcontextprotocol/sdk` 內部依賴或 n8n 載入機制的問題。
3.  **修補 (Patching) SDK**: 手動修改 `@modelcontextprotocol/sdk` 的 `dist/cjs/client/auth.js` 檔案，將 `require('pkce-challenge')` 改為動態 `import()`。但這未能解決問題，因為錯誤根源在於 n8n 核心的載入器。

## 最終解決方案：使用 `overrides`

參考了另一個成功的 n8n MCP 節點專案 (`n8n-nodes-mcp`) 的作法，最終的解決方案是在專案的 `package.json` 文件中加入 `"overrides"` 區塊：

```json
{
  // ... 其他 package.json 內容 ...

  "dependencies": {
    "@langchain/core": "^0.3.43",
    "@modelcontextprotocol/sdk": "1.8.0",
    // 不再需要直接依賴 pkce-challenge
    "zod": "^3.24.2",
    "zod-to-json-schema": "^3.24.5"
  },
  "overrides": {
    "pkce-challenge": "^5.0.0" // 強制所有依賴使用 v5.0.0
  },
  "peerDependencies": {
    "n8n-workflow": "*"
  }
}
```

**原理：**
`"overrides"` (在 pnpm 或 npm v8.3+ 中可用) 允許強制指定專案中所有依賴項（包括子依賴項）使用的特定套件版本。通過將 `pkce-challenge` 強制指定為 `^5.0.0`，確保了即使 `@modelcontextprotocol/sdk` 內部可能依賴舊版本，實際安裝和使用的也是 v5.0.0。`pkce-challenge` v5.0.0 版本似乎解決了與 CommonJS 的兼容性問題或頂層 `await` 的問題，使得 n8n 的載入器可以成功處理。

**步驟：**
1.  修改 `package.json`，加入 `"overrides"` 區塊並移除對 `pkce-challenge` 的直接依賴。
2.  執行 `pnpm install` 來應用 `overrides` 設定並更新依賴。
3.  執行 `pnpm run build` (使用 `tsc`，無需 `esbuild`)。
4.  執行 `n8n start`，錯誤應已解決。
