# n8n-nodes-n8nmcpclient

This is an n8n community node package. It provides nodes to interact with servers implementing the Model Context Protocol (MCP).

The [Model Context Protocol (MCP)](https://modelcontextprotocol.io) allows applications to provide context for LLMs in a standardized way, separating the concerns of providing context from the actual LLM interaction. This node package allows n8n workflows, especially AI Agents, to connect to and utilize MCP servers.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Nodes](#nodes)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. Search for `n8n-nodes-n8nmcpclient`.

## Nodes

*   **Smart MCP Client (`smartMcp`)**: Connects to an MCP server via STDIO or SSE and allows interaction with its capabilities (tools, resources, prompts). Designed for use with n8n AI Agents.

## Operations (Smart MCP Client)

*   **Discover Capabilities (for AI Agent)**: Connects to the MCP server and lists all available tools, resources, and prompts. Resources and prompts are presented as pseudo-tools (prefixed with `resource_` or `prompt_`) with associated metadata, making them discoverable and usable by AI Agents through the standard tool execution mechanism. This is the recommended operation when using this node with an AI Agent.
*   **Execute Tool**: Executes a specific tool (either a real MCP tool or a pseudo-tool representing a resource read or prompt retrieval) on the connected MCP server. Requires the tool name and parameters in JSON format.
*   **Read Resource**: Reads the content of a specific resource URI from the MCP server.
*   **Get Prompt**: Retrieves a specific prompt template from the MCP server.
*   **List Tools**: Lists only the actual tools available on the MCP server.
*   **List Resources**: Lists only the resources available on the MCP server.
*   **List Resource Templates**: Lists the resource templates available on the MCP server.
*   **List Prompts**: Lists only the prompts available on the MCP server.

## Credentials

This node package includes two credential types:

1.  **MCP Client (STDIO) API (`mcpClientApi`)**:
    *   Used for connecting to MCP servers launched as local command-line processes via Standard Input/Output (STDIO).
    *   **Command**: The command to execute to start the MCP server (e.g., `node path/to/server.js`, `python script.py`).
    *   **Arguments**: Space-separated arguments to pass to the command.
    *   **Environments**: Comma-separated `NAME=VALUE` pairs for environment variables needed by the server (e.g., API keys).

2.  **MCP Client (SSE) API (`mcpClientSseApi`)**:
    *   Used for connecting to remote MCP servers via Server-Sent Events (SSE) over HTTP.
    *   **SSE URL**: The URL of the MCP server's SSE endpoint (e.g., `http://localhost:3001/sse`).
    *   **Messages Post Endpoint** (Optional): A custom URL endpoint for sending messages back to the server if it differs from the base SSE URL.
    *   **Additional Headers** (Optional): Headers to include in requests, typically for authentication (e.g., `Authorization: Bearer YOUR_TOKEN`). Format: one header per line (`Header-Name: Value`).

## Compatibility

*   Requires n8n version 1.0 or later.
*   Requires Node.js version 18.10 or later.

## Usage

When using the **Smart MCP Client** node with an n8n **AI Agent**:

1.  Add the **Smart MCP Client** node to your workflow.
2.  Configure the **Connection Type** and the corresponding **Credentials**.
3.  Set the **Operation** to **Discover Capabilities (for AI Agent)**.
4.  Connect the output of the **Smart MCP Client** node to the **Tool** input of the **AI Agent** node.

The AI Agent will automatically call the `discoverCapabilities` operation to learn about the available tools, resources, and prompts from the MCP server. It can then decide to use any of these capabilities by calling the `executeTool` operation on the Smart MCP Client node, passing the appropriate tool name (e.g., `get_weather`, `resource_userProfile`, `prompt_summarize`) and parameters.

For manual workflow usage (without an AI Agent), you can select specific operations like `Execute Tool`, `Read Resource`, etc., and provide the necessary parameters directly in the node's UI.

## Resources

*   [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
*   [Model Context Protocol (MCP) Documentation](https://modelcontextprotocol.io)
*   [MCP Specification](https://spec.modelcontextprotocol.io)
*   [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)
