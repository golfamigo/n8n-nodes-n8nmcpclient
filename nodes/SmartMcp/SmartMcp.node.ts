import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
	NodeConnectionType, // Re-add NodeConnectionType import again
} from 'n8n-workflow';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
 import {
 	// Import only necessary result types and error types
 	// ListToolsResult, // Not used directly
 	// ListResourcesResult, // Not used directly
 	// ListPromptsResult, // Not used directly
 	McpError,
 	// ErrorCode, // Not used directly
 	CallToolResult,
 	ReadResourceResult,
 	GetPromptResult,
	// Import specific content types for checking
	TextContent,
	// Revert to any[] as specific types might not be exported
} from '@modelcontextprotocol/sdk/types.js';
import { URL } from 'url'; // Explicitly import URL

declare const process: {
	env: Record<string, string | undefined>;
};

// Helper function remains the same
// Helper function remains the same - Keep 'any' here as schema structure is dynamic
function createZodSchemaFromMcpSchema(mcpSchema: any): z.ZodObject<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
	if (!mcpSchema?.properties) {
		return z.object({});
	}
	return z.object(
		Object.entries(mcpSchema.properties).reduce(
			(acc: any, [key, prop]: [string, any]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
				let zodType: z.ZodType;
				switch (prop.type) {
					case 'string': zodType = z.string(); break;
					case 'number': zodType = z.number(); break;
					case 'integer': zodType = z.number().int(); break;
					case 'boolean': zodType = z.boolean(); break;
					case 'array': zodType = z.array(z.any()); break;
					case 'object': zodType = z.record(z.string(), z.any()); break;
					default: zodType = z.any();
				}
				if (prop.description) {
					zodType = zodType.describe(prop.description);
				}
				if (!mcpSchema?.required?.includes(key)) {
					zodType = zodType.optional();
				}
				return { ...acc, [key]: zodType };
			},
			{},
		),
	);
}

// Define getConnectedClient as a standalone helper function outside the class
async function getConnectedClientHelper(context: IExecuteFunctions): Promise<Client> {
	let connectionType = 'cmd';
	try {
		connectionType = context.getNodeParameter('connectionType', 0) as string;
	} catch { // Remove unused 'error' variable
		context.logger.debug('ConnectionType parameter not found, using default "cmd" transport');
	}

	let transport: Transport;

	if (connectionType === 'sse') {
		const sseCredentials = await context.getCredentials('mcpClientSseApi');
		const { SSEClientTransport } = await import('@modelcontextprotocol/sdk/client/sse.js');
		const sseUrl = sseCredentials.sseUrl as string;
		const messagesPostEndpoint = (sseCredentials.messagesPostEndpoint as string) || '';
		const headers: Record<string, string> = {};
		if (sseCredentials.headers) {
			const headerLines = (sseCredentials.headers as string).split('\n');
			for (const line of headerLines) {
				const [name, value] = line.split(':', 2);
				if (name && value) headers[name.trim()] = value.trim();
			}
		}
		transport = new SSEClientTransport(new URL(sseUrl), { requestInit: { headers } });
		context.logger.debug(`Created SSE transport for MCP client URL: ${sseUrl}`);
		if (messagesPostEndpoint) {
			context.logger.warn(`Custom messagesPostEndpoint ('${messagesPostEndpoint}') provided but may not be supported by standard SSEClientTransport requestInit.`);
		}
	} else { // Default to 'cmd' (STDIO)
		const cmdCredentials = await context.getCredentials('mcpClientApi');
		const env: Record<string, string> = { PATH: process.env.PATH || '' };
		if (cmdCredentials.environments) {
			const envPairs = (cmdCredentials.environments as string).split(/[,\n\s]+/);
			for (const pair of envPairs) {
				const trimmedPair = pair.trim();
				if (trimmedPair) {
					const equalsIndex = trimmedPair.indexOf('=');
					if (equalsIndex > 0) {
						const name = trimmedPair.substring(0, equalsIndex).trim();
						const value = trimmedPair.substring(equalsIndex + 1).trim();
						if (name && value !== undefined) env[name] = value;
					}
				}
			}
		}
		for (const key in process.env) {
			if (key.startsWith('MCP_') && process.env[key]) {
				const envName = key.substring(4);
				env[envName] = process.env[key] as string;
			}
		}
		transport = new StdioClientTransport({
			command: cmdCredentials.command as string,
			args: (cmdCredentials.args as string)?.split(' ').filter(arg => arg !== '') || [],
			env: env,
		});
		context.logger.debug(`Created STDIN transport for MCP client command: ${cmdCredentials.command}`);
	}

	transport.onerror = (error) => {
		context.logger.error(`MCP Transport error: ${error}`);
	};

	const client = new Client(
		{ name: `${context.getNode().name || 'smartMcp'}-n8n-client`, version: '1.0.0' },
		{},
	);

	try {
		await client.connect(transport);
		context.logger.debug('MCP Client connected successfully');
		return client;
	} catch (connectionError) {
		context.logger.error(`MCP client connection error: ${(connectionError as Error).message}`);
		await transport.close().catch(closeErr => context.logger.error(`Error closing transport after connection failure: ${closeErr}`));
		throw new NodeOperationError(
			context.getNode(),
			`Failed to connect to MCP server: ${(connectionError as Error).message}`,
			{ itemIndex: 0 }
		);
	}
}


export class SmartMcp implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Smart MCP Client',
		name: 'smartMcp',
		icon: 'file:mcpClient.svg',
		group: ['AI'],
		version: 1.0,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Connects to and interacts with an MCP server, discovering capabilities for AI Agents.',
		defaults: { name: 'Smart MCP Client' },
		inputs: [NodeConnectionType.Main], // Use enum value again to satisfy TS
		outputs: [NodeConnectionType.Main], // Use enum value again to satisfy TS
		usableAsTool: true,
		credentials: [
			{ name: 'mcpClientApi', required: false, displayOptions: { show: { connectionType: ['cmd'] } } },
			{ name: 'mcpClientSseApi', required: false, displayOptions: { show: { connectionType: ['sse'] } } },
		],
		properties: [
			{
				displayName: 'Connection Type', name: 'connectionType', type: 'options',
				options: [ { name: 'Command Line (STDIO)', value: 'cmd' }, { name: 'Server-Sent Events (SSE)', value: 'sse' } ],
				default: 'cmd', description: 'Choose the transport type to connect to MCP server',
			},
			{
				displayName: 'Operation', name: 'operation', type: 'options', noDataExpression: true,
				options: [
					{ name: 'Discover Capabilities (for AI Agent)', value: 'discoverCapabilities', description: 'List all available tools, resources, and prompts for AI Agent use', action: 'Discover all capabilities' },
					{ name: 'Execute Tool', value: 'executeTool', description: 'Execute a specific tool (real or pseudo)', action: 'Execute a tool' },
					{ name: 'Get Prompt', value: 'getPrompt', description: 'Get a specific prompt template', action: 'Get a prompt template' },
					{ name: 'List Prompts', value: 'listPrompts', description: 'List only available prompts', action: 'List available prompts' },
					{ name: 'List Resource Templates', value: 'listResourceTemplates', description: 'List only available resource templates', action: 'List available resource templates' },
					{ name: 'List Resources', value: 'listResources', description: 'List only available resources', action: 'List available resources' },
					{ name: 'List Tools', value: 'listTools', description: 'List only available tools', action: 'List available tools' },
					{ name: 'Read Resource', value: 'readResource', description: 'Read a specific resource by URI', action: 'Read a resource' },
				],
				default: 'discoverCapabilities', required: true,
			},
			{ displayName: 'Resource URI', name: 'resourceUri', type: 'string', required: true, displayOptions: { show: { operation: ['readResource'] } }, default: '', description: 'URI of the resource to read (e.g., file:///path/to/file, db://table/ID)' },
			{ displayName: 'Tool Name', name: 'toolName', type: 'string', required: true, displayOptions: { show: { operation: ['executeTool'] } }, default: '', description: 'Name of the tool (real or pseudo like resource_X, prompt_Y) to execute' },
			{ displayName: 'Tool Parameters', name: 'toolParameters', type: 'json', required: true, displayOptions: { show: { operation: ['executeTool'] } }, default: '{}', description: 'Parameters for the tool in JSON format (e.g., {"city": "London"}, {"uri": "file:///data.txt"})' },
			{ displayName: 'Prompt Name', name: 'promptName', type: 'string', required: true, displayOptions: { show: { operation: ['getPrompt'] } }, default: '', description: 'Name of the prompt template to get' },
		],
	};

	// No longer need the private class method

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;
		let client: Client | undefined;
		let transportClosed = false;
		// Remove 'this' alias: const executionContext = this;

		const closeClientAndTransport = async (c: Client | undefined) => {
			if (c && !transportClosed) {
				try {
					await c.close();
					transportClosed = true;
					this.logger.debug('MCP Client closed.'); // Use 'this' directly
				} catch (closeError) {
					this.logger.error(`Error closing MCP client: ${closeError}`); // Use 'this' directly
				}
			}
		};

		try {
			// Call the standalone helper function, passing the current execution context ('this')
			client = await getConnectedClientHelper(this);

			if (!client) {
				throw new NodeOperationError(this.getNode(), 'Failed to establish MCP client connection.', { itemIndex: 0 }); // Use 'this' directly
			}

			switch (operation) {
				case 'discoverCapabilities': {
					this.logger.info('Discovering MCP capabilities...');
					const [toolsResult, resourcesResult, promptsResult] = await Promise.allSettled([
						client.listTools(),
						client.listResources(),
						client.listPrompts()
					]);

					const allToolsForAgent: DynamicStructuredTool[] = [];

					// Process Tools
					if (toolsResult.status === 'fulfilled' && toolsResult.value?.tools) {
						const tools: any[] = toolsResult.value.tools; // eslint-disable-line @typescript-eslint/no-explicit-any
						this.logger.debug(`Found ${tools.length} real tools.`);
						tools.forEach(tool => {
							const schema = createZodSchemaFromMcpSchema(tool.inputSchema);
							allToolsForAgent.push(new DynamicStructuredTool({
								name: tool.name,
								description: tool.description || `Execute the ${tool.name} tool`,
								schema,
								metadata: { type: "tool" },
								func: async (params): Promise<string> => {
									if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during tool execution"); // Use 'this' directly
									try {
										const result = await client.callTool({ name: tool.name, arguments: params });
										const firstContent = (Array.isArray(result.content) && result.content.length > 0) ? result.content[0] : undefined;
										return String((firstContent && firstContent.type === 'text') ? (firstContent as TextContent).text : JSON.stringify(result));
									} catch (error) {
										this.logger.error(`Error executing tool ${tool.name}: ${error}`); // Use 'this' directly
										const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
										throw new NodeOperationError(this.getNode(), `Failed executing tool ${tool.name}: ${(error as Error).message}`, { description }); // Use 'this' directly
									}
								}
							}));
						});
					} else if (toolsResult.status === 'rejected') {
						this.logger.warn(`Failed to list tools: ${toolsResult.reason}`);
					}

					// Process Resources
					if (resourcesResult.status === 'fulfilled' && resourcesResult.value?.resources) {
						const resources: any[] = resourcesResult.value.resources; // eslint-disable-line @typescript-eslint/no-explicit-any
						this.logger.debug(`Found ${resources.length} resources.`);
						resources.forEach(resource => {
							const resourceToolName = `resource_${resource.name}`;
							allToolsForAgent.push(new DynamicStructuredTool({
								name: resourceToolName,
								description: resource.description || `Read the ${resource.name} resource`,
								schema: z.object({
									uri: z.string().describe('URI of the resource to read').optional().default(resource.uri)
								}),
								metadata: { type: "resource", originalName: resource.name, originalUri: resource.uri },
								func: async (params): Promise<string> => {
									if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during resource read"); // Use 'this' directly
									const targetUri = params.uri || resource.uri;
									try {
										const result = await client.readResource({ uri: targetUri });
										const firstContent = (Array.isArray(result.contents) && result.contents.length > 0) ? result.contents[0] : undefined;
										return String(firstContent && 'text' in firstContent ? firstContent.text : JSON.stringify(result));
									} catch (error) {
										this.logger.error(`Error reading resource ${resource.name} (URI: ${targetUri}): ${error}`); // Use 'this' directly
										const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
										throw new NodeOperationError(this.getNode(), `Failed reading resource ${resource.name}: ${(error as Error).message}`, { description }); // Use 'this' directly
									}
								}
							}));
						});
					} else if (resourcesResult.status === 'rejected') {
						this.logger.warn(`Failed to list resources: ${resourcesResult.reason}`);
					}

					// Process Prompts
					if (promptsResult.status === 'fulfilled' && promptsResult.value?.prompts) {
						const prompts: any[] = promptsResult.value.prompts; // eslint-disable-line @typescript-eslint/no-explicit-any
						this.logger.debug(`Found ${prompts.length} prompts.`);
						prompts.forEach(prompt => {
							const promptToolName = `prompt_${prompt.name}`;
							const schema = z.object({}); // TODO: Handle prompt args
							allToolsForAgent.push(new DynamicStructuredTool({
								name: promptToolName,
								description: prompt.description || `Get the ${prompt.name} prompt template`,
								schema,
								metadata: { type: "prompt", originalName: prompt.name },
								func: async (): Promise<string> => { // Remove unused _params
									if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during prompt get"); // Use 'this' directly
									try {
										const result = await client.getPrompt({ name: prompt.name /*, arguments: params */ });
										return JSON.stringify(result);
									} catch (error) {
										this.logger.error(`Error getting prompt ${prompt.name}: ${error}`); // Use 'this' directly
										const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
										throw new NodeOperationError(this.getNode(), `Failed getting prompt ${prompt.name}: ${(error as Error).message}`, { description }); // Use 'this' directly
									}
								}
							}));
						});
					} else if (promptsResult.status === 'rejected') {
						this.logger.warn(`Failed to list prompts: ${promptsResult.reason}`);
					}

					this.logger.info(`Total capabilities discovered for AI Agent: ${allToolsForAgent.length}`);

					const toolDefinitionsForAgent = allToolsForAgent.map((t: DynamicStructuredTool) => ({
						name: t.name,
						description: t.description,
						schema: zodToJsonSchema(t.schema || z.object({})),
						metadata: t.metadata,
					}));

					returnData.push({
						json: { tools: toolDefinitionsForAgent } as IDataObject,
						pairedItem: { item: 0 },
					});
					break;
				}

				case 'executeTool': {
					const toolName = this.getNodeParameter('toolName', 0) as string;
					let toolParams: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any

					try {
						const rawParams = this.getNodeParameter('toolParameters', 0);
						if (typeof rawParams === 'string' && rawParams.trim() !== '') {
							toolParams = JSON.parse(rawParams);
						} else if (typeof rawParams === 'object' && rawParams !== null) {
							toolParams = rawParams;
						} else if (rawParams !== undefined && rawParams !== null && rawParams !== '') {
							this.logger.warn(`Unexpected tool parameter type: ${typeof rawParams}. Attempting to use as is.`);
							toolParams = rawParams;
						}

						if (Object.keys(toolParams).length > 0 && (typeof toolParams !== 'object' || toolParams === null || Array.isArray(toolParams))) {
							throw new NodeOperationError(this.getNode(), 'Parsed parameters must be a JSON object', { itemIndex: 0 });
						}
						this.logger.debug(`Executing tool: ${toolName} with params: ${JSON.stringify(toolParams)}`);

						let result: CallToolResult | ReadResourceResult | GetPromptResult;

						if (toolName.startsWith("resource_")) {
							const resourceUri = toolParams.uri;
							if (!resourceUri || typeof resourceUri !== 'string') {
								throw new NodeOperationError(this.getNode(), `Parameter 'uri' (string) is required for resource tool '${toolName}'`, { itemIndex: 0 });
							}
							result = await client.readResource({ uri: resourceUri });
							this.logger.debug(`Resource read successfully: ${resourceUri}`);
						} else if (toolName.startsWith("prompt_")) {
							const promptName = toolName.replace("prompt_", "");
							result = await client.getPrompt({ name: promptName /*, arguments: toolParams */ });
							this.logger.debug(`Prompt retrieved successfully: ${promptName}`);
						} else {
							// Cast the result to CallToolResult to help TypeScript understand the structure
							result = await client.callTool({ name: toolName, arguments: toolParams }) as CallToolResult;
							this.logger.debug(`Tool executed successfully: ${toolName}`);
						}
						returnData.push({ json: { result } as IDataObject });

					} catch (error) {
						this.logger.error(`Failed to execute tool '${toolName}': ${(error as Error).message}`);
						const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? (error as Error).stack ?? '');
						throw new NodeOperationError(
							this.getNode(),
							`Failed to execute tool '${toolName}': ${(error as Error).message}`,
							{ itemIndex: 0, description }
						);
					}
					break;
				}

				// --- Other Manual Operations ---
				case 'listResources': {
					const result = await client.listResources();
					returnData.push({ json: result as IDataObject });
					break;
				}
				case 'listResourceTemplates': {
					const result = await client.listResourceTemplates();
					returnData.push({ json: result as IDataObject });
					break;
				}
				case 'readResource': {
					const uri = this.getNodeParameter('resourceUri', 0) as string;
					if (!uri) throw new NodeOperationError(this.getNode(), 'Resource URI is required for readResource operation', { itemIndex: 0 });
					const result = await client.readResource({ uri });
					returnData.push({ json: result as IDataObject });
					break;
				}
				case 'listTools': {
					const result = await client.listTools();
					returnData.push({ json: result as IDataObject });
					break;
				}
				case 'listPrompts': {
					const result = await client.listPrompts();
					returnData.push({ json: result as IDataObject });
					break;
				}
				case 'getPrompt': {
					const promptName = this.getNodeParameter('promptName', 0) as string;
					if (!promptName) throw new NodeOperationError(this.getNode(), 'Prompt Name is required for getPrompt operation', { itemIndex: 0 });
					const result = await client.getPrompt({ name: promptName });
					returnData.push({ json: result as IDataObject });
					break;
				}
				default:
					throw new NodeOperationError(this.getNode(), `Operation '${operation}' not supported`, { itemIndex: 0 });
			}

			return this.prepareOutputData(returnData);

		} catch (error) {
			await closeClientAndTransport(client);
			if (error instanceof NodeOperationError) throw error;
			this.logger.error(`Unhandled MCP Client Error: ${error}`);
			const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? (error as Error).stack ?? '');
			throw new NodeOperationError(this.getNode(), `MCP Client Error: ${(error as Error).message}`, { itemIndex: 0, description });
		} finally {
			await closeClientAndTransport(client);
		}
	}
}
