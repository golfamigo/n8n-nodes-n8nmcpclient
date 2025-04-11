import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
	IDataObject,
	NodeConnectionType,
} from 'n8n-workflow';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { z, ZodObject, ZodRawShape } from 'zod'; // 移除未使用的ZodTypeAny
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
 import {
 	McpError,
 	CallToolResult,
 	ReadResourceResult,
 	GetPromptResult,
	TextContent,
	// ListResourceTemplatesResult, // 移除未使用的導入
	ResourceTemplate,
} from '@modelcontextprotocol/sdk/types.js';
import { URL } from 'url';


declare const process: {
	env: Record<string, string | undefined>;
};

// Helper function remains the same
// Using ZodRawShape for better type definition
function createZodSchemaFromMcpSchema(mcpSchema: any): ZodObject<ZodRawShape> { // eslint-disable-line @typescript-eslint/no-explicit-any
	if (!mcpSchema?.properties) {
		return z.object({});
	}
	return z.object(
		Object.entries(mcpSchema.properties).reduce(
			(acc: ZodRawShape, [key, prop]: [string, any]) => { // eslint-disable-line @typescript-eslint/no-explicit-any
				let zodType: z.ZodType;
				switch (prop.type) {
					case 'string': zodType = z.string(); break;
					case 'number': zodType = z.number(); break;
					case 'integer': zodType = z.number().int(); break;
					case 'boolean': zodType = z.boolean(); break;
					case 'array': zodType = z.array(z.any()); break; // Keep z.any() for array elements for now
					case 'object': zodType = z.record(z.string(), z.any()); break; // Keep z.any() for object values for now
					default: zodType = z.any();
				}
				if (prop.description) {
					zodType = zodType.describe(prop.description);
				}
				if (!mcpSchema?.required?.includes(key)) {
					zodType = zodType.optional();
				}
				acc[key] = zodType; // Assign directly to ZodRawShape
				return acc;
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
	} catch {
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
		inputs: [NodeConnectionType.Main],
		outputs: [NodeConnectionType.Main],
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

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as string;
		let client: Client | undefined;
		let transportClosed = false;

		const closeClientAndTransport = async (c: Client | undefined) => {
			if (c && !transportClosed) {
				try {
					await c.close();
					transportClosed = true;
					this.logger.debug('MCP Client closed.');
				} catch (closeError) {
					this.logger.error(`Error closing MCP client: ${closeError}`);
				}
			}
		};

		try {
			client = await getConnectedClientHelper(this);

			if (!client) {
				throw new NodeOperationError(this.getNode(), 'Failed to establish MCP client connection.', { itemIndex: 0 });
			}

			switch (operation) {
				case 'discoverCapabilities': {
					this.logger.info('Discovering MCP capabilities...');
					// Step 1: Get Tools, Resources, Prompts, AND Resource Templates
					const [toolsResult, resourcesResult, promptsResult, resourceTemplatesResult] = await Promise.allSettled([
						client.listTools(),
						client.listResources(),
						client.listPrompts(),
						client.listResourceTemplates() // Added back here
					]);

					// 使用any類型解決類型不匹配問題
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const allToolsForAgent: DynamicStructuredTool<any>[] = [];

					// Step 2: Process Tools
					if (toolsResult.status === 'fulfilled' && toolsResult.value?.tools) {
						const tools = toolsResult.value.tools;
						this.logger.debug(`Found ${tools.length} real tools.`);
						tools.forEach(tool => {
							const schema = createZodSchemaFromMcpSchema(tool.inputSchema);
							allToolsForAgent.push(new DynamicStructuredTool({
								name: tool.name,
								description: tool.description || `Execute the ${tool.name} tool`,
								schema,
								metadata: { type: "tool" },
								func: async (params): Promise<string> => {
									if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during tool execution");
									try {
										const result = await client.callTool({ name: tool.name, arguments: params });
										const firstContent = (Array.isArray(result.content) && result.content.length > 0) ? result.content[0] : undefined;
										return String((firstContent && firstContent.type === 'text') ? (firstContent as TextContent).text : JSON.stringify(result));
									} catch (error) {
										this.logger.error(`Error executing tool ${tool.name}: ${error}`);
										const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
										throw new NodeOperationError(this.getNode(), `Failed executing tool ${tool.name}: ${(error as Error).message}`, { description });
									}
								}
							}));
						});
					} else if (toolsResult.status === 'rejected') {
						this.logger.warn(`Failed to list tools: ${toolsResult.reason}`);
					}

					// Step 3: Process Resources
					if (resourcesResult.status === 'fulfilled' && resourcesResult.value?.resources) {
						const resources = resourcesResult.value.resources;
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
									if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during resource read");
									const targetUri = params.uri || resource.uri;
									try {
										const result = await client.readResource({ uri: targetUri });
										const firstContent = (Array.isArray(result.contents) && result.contents.length > 0) ? result.contents[0] : undefined;
										return String(firstContent && 'text' in firstContent ? firstContent.text : JSON.stringify(result));
									} catch (error) {
										this.logger.error(`Error reading resource ${resource.name} (URI: ${targetUri}): ${error}`);
										const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
										throw new NodeOperationError(this.getNode(), `Failed reading resource ${resource.name}: ${(error as Error).message}`, { description });
									}
								}
							}));
						});
					} else if (resourcesResult.status === 'rejected') {
						this.logger.warn(`Failed to list resources: ${resourcesResult.reason}`);
					}

					// Step 4: Process Prompts
					if (promptsResult.status === 'fulfilled' && promptsResult.value?.prompts) {
						const prompts = promptsResult.value.prompts;
						this.logger.debug(`Found ${prompts.length} prompts.`);
						prompts.forEach(prompt => {
							const promptToolName = `prompt_${prompt.name}`;
							const schema = z.object({}); // TODO: Handle prompt args
							allToolsForAgent.push(new DynamicStructuredTool({
								name: promptToolName,
								description: prompt.description || `Get the ${prompt.name} prompt template`,
								schema,
								metadata: { type: "prompt", originalName: prompt.name },
								func: async (): Promise<string> => {
									if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during prompt get");
									try {
										const result = await client.getPrompt({ name: prompt.name /*, arguments: params */ });
										return JSON.stringify(result);
									} catch (error) {
										this.logger.error(`Error getting prompt ${prompt.name}: ${error}`);
										const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
										throw new NodeOperationError(this.getNode(), `Failed getting prompt ${prompt.name}: ${(error as Error).message}`, { description });
									}
								}
							}));
						});
					} else if (promptsResult.status === 'rejected') {
						this.logger.warn(`Failed to list prompts: ${promptsResult.reason}`);
					}
					// 在處理 resourceTemplatesResult 之前添加這段日誌代碼
					// Removed fs.writeFileSync block (lines 325-331)

					// Step 5: Process Resource Templates (from Promise.allSettled result)
					if (resourceTemplatesResult.status === 'fulfilled' && resourceTemplatesResult.value?.resourceTemplates) {
						// Use the imported ResourceTemplate type
						const templates: ResourceTemplate[] = Array.isArray(resourceTemplatesResult.value.resourceTemplates)
							? resourceTemplatesResult.value.resourceTemplates
							: [];
						this.logger.debug(`Found ${templates.length} resource templates.`);
						templates.forEach(template => {
							// Type guard for safety, although Array.isArray should suffice
							if (template && typeof template === 'object' && 'name' in template && 'uriTemplate' in template) {
								const templateToolName = `resource_template_${template.name}`;
								allToolsForAgent.push(new DynamicStructuredTool({
									name: templateToolName,
									description: template.description || `Read a resource matching the template URI: ${template.uriTemplate}`,
									schema: z.object({
										uri: z.string().describe(`URI of the resource to read (must match template: ${template.uriTemplate})`)
									}),
									metadata: { type: "resource_template", originalName: template.name, originalUriTemplate: template.uriTemplate },
									func: async (params): Promise<string> => {
										if (!client) throw new NodeOperationError(this.getNode(), "MCP Client not connected during resource template read");
										const targetUri = params.uri;
										if (!targetUri || typeof targetUri !== 'string') {
											throw new NodeOperationError(this.getNode(), `Parameter 'uri' (string) is required for resource template tool '${templateToolName}'`);
										}
										const templateRegex = new RegExp('^' + template.uriTemplate.replace(/\{\w+\}/g, '[^/]+') + '$');
										if (!templateRegex.test(targetUri)) {
											this.logger.warn(`Provided URI '${targetUri}' might not match template '${template.uriTemplate}' for tool ${templateToolName}`);
										}
										try {
											const result = await client.readResource({ uri: targetUri });
											const firstContent = (Array.isArray(result.contents) && result.contents.length > 0) ? result.contents[0] : undefined;
											return String(firstContent && 'text' in firstContent ? firstContent.text : JSON.stringify(result));
										} catch (error) {
											this.logger.error(`Error reading resource template ${template.name} (URI: ${targetUri}): ${error}`);
											const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? '');
											throw new NodeOperationError(this.getNode(), `Failed reading resource template ${template.name}: ${(error as Error).message}`, { description });
										}
									}
								}));
							} else {
								this.logger.warn(`Skipping invalid resource template item: ${JSON.stringify(template)}`);
							}
						});
					} else if (resourceTemplatesResult.status === 'rejected') {
						// Log the reason if listing templates failed
						this.logger.warn(`Failed to list resource templates: ${resourceTemplatesResult.reason}`);
					}


					// Step 6: Finalize and return
					this.logger.info(`Total capabilities discovered for AI Agent: ${allToolsForAgent.length}`);

					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const toolDefinitionsForAgent = allToolsForAgent.map((t: DynamicStructuredTool<any>) => ({
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
					// Use unknown for initial parsing, then validate
					let toolParams: unknown = {};
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

						// Validate that toolParams is an object after parsing/assignment
						if (typeof toolParams !== 'object' || toolParams === null || Array.isArray(toolParams)) {
							// If it's empty initially, allow it, otherwise throw error
							if (toolParams !== null && toolParams !== undefined && typeof Object.keys === 'function') {
								// 修正第408行的Object.keys使用方式
								// 確保toolParams是對象且非null/undefined再使用Object.keys
								const keys = Object.keys(toolParams as object);
								if (keys.length > 0) {
									throw new NodeOperationError(this.getNode(), 'Parsed parameters must be a JSON object', { itemIndex: 0 });
								}
							}
							// If empty, ensure it's an empty object for consistency
							toolParams = {};
						}

						this.logger.debug(`Executing tool: ${toolName} with params: ${JSON.stringify(toolParams)}`);

						let result: CallToolResult | ReadResourceResult | GetPromptResult;
						let processedResult: unknown;

						// Ensure toolParams is treated as Record<string, unknown> for safety
						const safeToolParams = toolParams as Record<string, unknown>;

						if (toolName.startsWith("resource_template_")) {
							const resourceUri = safeToolParams.uri;
							if (!resourceUri || typeof resourceUri !== 'string') {
								throw new NodeOperationError(this.getNode(), `Parameter 'uri' (string) is required for resource template tool '${toolName}'`, { itemIndex: 0 });
							}
							result = await client.readResource({ uri: resourceUri });
							this.logger.debug(`Resource template read successfully: ${resourceUri}`);
							processedResult = result;

						} else if (toolName.startsWith("resource_")) {
							const resourceUri = safeToolParams.uri;
							if (!resourceUri || typeof resourceUri !== 'string') {
								throw new NodeOperationError(this.getNode(), `Parameter 'uri' (string) is required for resource tool '${toolName}'`, { itemIndex: 0 });
							}
							result = await client.readResource({ uri: resourceUri });
							this.logger.debug(`Resource read successfully: ${resourceUri}`);
							processedResult = result;

						} else if (toolName.startsWith("prompt_")) {
							const promptName = toolName.replace("prompt_", "");
							result = await client.getPrompt({ name: promptName /*, arguments: safeToolParams */ });
							this.logger.debug(`Prompt retrieved successfully: ${promptName}`);
							processedResult = result;
						} else {
							result = await client.callTool({ name: toolName, arguments: safeToolParams }) as CallToolResult;
							this.logger.debug(`Tool executed successfully: ${toolName}`);
							processedResult = result;
						}

						// Centralized result processing
						if (processedResult && typeof processedResult === 'object') {
							if ('text' in processedResult && typeof processedResult.text === 'string' && 'mimeType' in processedResult && processedResult.mimeType === 'application/json') {
								try {
									processedResult = JSON.parse(processedResult.text);
									this.logger.debug(`Parsed JSON from text content for tool ${toolName}`);
								} catch (parseError) {
									this.logger.warn(`Failed to parse JSON from text content for tool ${toolName}: ${(parseError as Error).message}. Returning raw result.`);
								}
							} else if ('contents' in processedResult && Array.isArray(processedResult.contents) && processedResult.contents.length > 0) {
								const firstContent = processedResult.contents[0];
								if (firstContent && typeof firstContent === 'object' && 'text' in firstContent && typeof firstContent.text === 'string' && 'mimeType' in firstContent && firstContent.mimeType === 'application/json') {
									try {
										processedResult = JSON.parse(firstContent.text);
										this.logger.debug(`Parsed JSON from first content for resource/template ${toolName}`);
									} catch (parseError) {
										this.logger.warn(`Failed to parse JSON from first content for resource/template ${toolName}: ${(parseError as Error).message}. Returning raw result object.`);
									}
								}
							}
						}

						if (processedResult && typeof processedResult === 'object') {
							returnData.push({ json: processedResult as IDataObject });
						} else {
							this.logger.warn(`Processed result for tool ${toolName} is not a standard object, returning raw result object.`);
							// Use the type assertion to fix the ESLint warning
							returnData.push({ json: { rawResult: result as CallToolResult | ReadResourceResult | GetPromptResult } as IDataObject });
						}

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
					const resourceUri = this.getNodeParameter('resourceUri', 0) as string;
					try {
						const result = await client.readResource({ uri: resourceUri });
						let processedResult: unknown = result;

						// Attempt to parse JSON if mimeType indicates it
						if (result.contents && result.contents.length > 0) {
							const firstContent = result.contents[0];
							if (firstContent && typeof firstContent === 'object' && 'text' in firstContent && typeof firstContent.text === 'string' && 'mimeType' in firstContent && firstContent.mimeType === 'application/json') {
								try {
									processedResult = JSON.parse(firstContent.text);
									this.logger.debug(`Parsed JSON from first content for resource ${resourceUri}`);
								} catch (parseError) {
									this.logger.warn(`Failed to parse JSON from first content for resource ${resourceUri}: ${(parseError as Error).message}. Returning raw result object.`);
								}
							}
						}

						if (processedResult && typeof processedResult === 'object') {
							returnData.push({ json: processedResult as IDataObject });
						} else {
							this.logger.warn(`Processed result for resource ${resourceUri} is not a standard object, returning raw result object.`);
							returnData.push({ json: result as IDataObject });
						}
					} catch (error) {
						this.logger.error(`Failed to read resource '${resourceUri}': ${(error as Error).message}`);
						const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? (error as Error).stack ?? '');
						throw new NodeOperationError(
							this.getNode(),
							`Failed to read resource '${resourceUri}': ${(error as Error).message}`,
							{ itemIndex: 0, description }
						);
					}
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
					const result = await client.getPrompt({ name: promptName });
					returnData.push({ json: result as IDataObject });
					break;
				}
				default:
					throw new NodeOperationError(this.getNode(), `Unsupported operation: ${operation}`, { itemIndex: 0 });
			}
		} catch (error) {
			await closeClientAndTransport(client); // Ensure cleanup on error
			if (error instanceof NodeOperationError) throw error; // Re-throw known errors
			this.logger.error(`Unhandled error in SmartMcp node: ${error}`);
			const description = typeof (error as McpError)?.data === 'object' ? JSON.stringify((error as McpError).data) : String((error as McpError)?.data ?? (error as Error).stack ?? '');
			throw new NodeOperationError(this.getNode(), `Execution failed: ${(error as Error).message}`, { itemIndex: 0, description });
		} finally {
			await closeClientAndTransport(client); // Ensure cleanup in finally block
		}

		return [returnData];
	}
}
