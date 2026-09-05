// afd-override: max-lines=950 — MCP client lifecycle and public request APIs; parsing and transport helpers are separate modules
/**
 * @fileoverview MCP Client implementation
 */

import type {
	BatchCommand,
	BatchOptions,
	BatchResult,
	CommandResult,
	McpInitializeResult,
	McpResponse,
	McpTool,
	McpToolCallResult,
	McpToolsListResult,
	PipelineOptions,
	PipelineRequest,
	PipelineResult,
	PipelineStep,
	StreamCallbacks,
	StreamChunk,
	StreamOptions,
} from '@lushly-dev/afd-core';
import {
	createMcpRequest,
	failure,
	isCompleteChunk,
	isDataChunk,
	isErrorChunk,
	isProgressChunk,
	success,
	wrapError,
} from '@lushly-dev/afd-core';
import {
	createBatchFailure,
	createPipelineFailure,
	getTextContent,
	isBatchResult,
	isCommandResult,
	isPipelineResult,
	parseTextContent,
} from './result-parsing.js';
import { createTransport, type Transport } from './transport.js';
import type {
	ClientStatus,
	ConnectionState,
	McpClientConfig,
	McpClientEvents,
	PendingRequest,
} from './types.js';

/**
 * Type-safe event emitter mixin.
 */
type EventHandler<T extends (...args: never[]) => void> = T;
type EventMap = { [K in keyof McpClientEvents]: McpClientEvents[K][] };

/**
 * Resolved config type where url is always a string (resolved from url or endpoint).
 */
type ResolvedConfig = Omit<Required<McpClientConfig>, 'url' | 'endpoint'> & {
	url: string;
	endpoint?: string;
};

/**
 * MCP Client for connecting to MCP servers.
 *
 * @example
 * ```typescript
 * const client = new McpClient({ url: 'http://localhost:3100/sse' });
 *
 * await client.connect();
 *
 * // List available tools
 * const tools = await client.listTools();
 *
 * // Call a tool
 * const result = await client.call('document.create', { title: 'Test' });
 *
 * await client.disconnect();
 * ```
 */
export class McpClient {
	private readonly config: ResolvedConfig;
	private transport: Transport | null = null;
	private state: ConnectionState = 'disconnected';
	private serverInfo: McpInitializeResult['serverInfo'] | null = null;
	private capabilities: McpInitializeResult['capabilities'] | null = null;
	private tools: McpTool[] = [];
	private connectedAt: Date | null = null;
	private reconnectAttempts = 0;
	private pendingRequests = new Map<string | number, PendingRequest>();
	private intentionalDisconnect = false;
	private connectionGeneration = 0;
	private connectionController: AbortController | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconnectDelayResolve: (() => void) | null = null;
	private reconnectPromise: Promise<void> | null = null;
	private reconnectGeneration: number | null = null;
	private eventHandlers: EventMap = {
		stateChange: [],
		connected: [],
		disconnected: [],
		reconnecting: [],
		error: [],
		message: [],
		toolsChanged: [],
	};

	constructor(config: McpClientConfig) {
		// Resolve url from url or endpoint
		const resolvedUrl = config.url ?? config.endpoint;
		if (!resolvedUrl) {
			throw new Error('Either url or endpoint must be provided');
		}

		this.config = {
			url: resolvedUrl,
			endpoint: config.endpoint,
			transport: config.transport ?? 'sse',
			clientName: config.clientName ?? '@lushly-dev/afd-client',
			clientVersion: config.clientVersion ?? '0.1.0',
			timeout: config.timeout ?? 30000,
			autoReconnect: config.autoReconnect ?? true,
			maxReconnectAttempts: config.maxReconnectAttempts ?? 5,
			reconnectDelay: config.reconnectDelay ?? 1000,
			headers: config.headers ?? {},
			debug: config.debug ?? false,
		};
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// CONNECTION MANAGEMENT
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Connect to the MCP server.
	 */
	async connect(): Promise<McpInitializeResult> {
		if (this.state === 'connected') {
			throw new Error('Already connected');
		}

		this.intentionalDisconnect = false;
		this.cancelReconnectDelay();
		this.reconnectAttempts = 0;
		const generation = ++this.connectionGeneration;
		return this.establishConnection(generation, false);
	}

	/**
	 * Disconnect from the MCP server.
	 */
	async disconnect(): Promise<void> {
		this.intentionalDisconnect = true;
		this.connectionGeneration++;
		this.cancelReconnectDelay();
		this.connectionController?.abort(new Error('Client disconnected'));
		this.connectionController = null;

		const transport = this.transport;
		this.transport = null;
		transport?.disconnect();

		// Reject all pending requests
		for (const pending of this.pendingRequests.values()) {
			clearTimeout(pending.timeout);
			pending.controller.abort(new Error('Client disconnected'));
		}
		this.pendingRequests.clear();

		this.setState('disconnected');
		this.emit('disconnected', 'Manual disconnect');

		this.serverInfo = null;
		this.capabilities = null;
		this.connectedAt = null;
		this.tools = [];
	}

	/**
	 * Get current client status.
	 */
	getStatus(): ClientStatus {
		return {
			state: this.state,
			url: this.state !== 'disconnected' ? this.config.url : null,
			serverInfo: this.serverInfo,
			capabilities: this.capabilities,
			connectedAt: this.connectedAt,
			reconnectAttempts: this.reconnectAttempts,
			pendingRequests: this.pendingRequests.size,
		};
	}

	/**
	 * Check if connected.
	 */
	isConnected(): boolean {
		return this.state === 'connected' && this.transport?.isConnected() === true;
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// MCP OPERATIONS
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * List available tools.
	 */
	async listTools(): Promise<McpTool[]> {
		const response = await this.request<McpToolsListResult>('tools/list');
		this.tools = response.tools;
		return this.tools;
	}

	/**
	 * Get cached tools list.
	 */
	getTools(): McpTool[] {
		return this.tools;
	}

	/**
	 * Refresh tools list from server.
	 */
	async refreshTools(): Promise<McpTool[]> {
		const tools = await this.listTools();
		this.emit('toolsChanged', tools);
		return tools;
	}

	/**
	 * Call a tool and return raw MCP result.
	 *
	 * @param name - Tool name
	 * @param args - Tool arguments
	 */
	async callTool(name: string, args?: Record<string, unknown>): Promise<McpToolCallResult> {
		const params = {
			name,
			arguments: args,
		};

		return this.request<McpToolCallResult>('tools/call', params as Record<string, unknown>);
	}

	/**
	 * Call a command and return a CommandResult.
	 *
	 * This is the preferred method for AFD - it wraps the MCP response
	 * in a standardized CommandResult.
	 *
	 * @param name - Command/tool name
	 * @param args - Command arguments
	 */
	async call<T = unknown>(name: string, args?: Record<string, unknown>): Promise<CommandResult<T>> {
		try {
			const result = await this.callTool(name, args);
			const parsed = parseTextContent(result);

			if (isCommandResult(parsed)) {
				return parsed as CommandResult<T>;
			}

			if (result.isError) {
				const errorText = getTextContent(result);

				return failure({
					code: 'TOOL_ERROR',
					message: errorText || 'Tool execution failed',
					suggestion: 'Check the tool arguments and try again',
				});
			}

			// Try to parse JSON from text content
			if (parsed !== undefined) return success(parsed as T);

			// SAFETY: Non-AFD tools may return plain text. Preserve that established fallback.
			return success(getTextContent(result) as unknown as T);
		} catch (error) {
			return failure(wrapError(error));
		}
	}

	/**
	 * Execute multiple commands in a single batch request.
	 *
	 * Batch execution provides partial success semantics - the batch
	 * succeeds if at least one command succeeds, with aggregated
	 * confidence scores and detailed timing information.
	 *
	 * @param commands - Array of commands to execute
	 * @param options - Batch execution options
	 * @returns BatchResult with individual command results
	 *
	 * @example
	 * ```typescript
	 * const result = await client.batch([
	 *   { name: 'todo-create', input: { title: 'First' } },
	 *   { name: 'todo-create', input: { title: 'Second' } },
	 *   { name: 'todo-list', input: {} }
	 * ], { stopOnError: false });
	 *
	 * console.log(`${result.summary.successCount}/${result.summary.total} succeeded`);
	 * console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
	 * ```
	 */
	async batch<T = unknown>(
		commands: BatchCommand[],
		options?: BatchOptions
	): Promise<BatchResult<T>> {
		const startedAt = new Date().toISOString();

		try {
			const result = await this.callTool('afd-batch', {
				commands,
				options,
			});
			const parsed = parseTextContent(result);

			if (isBatchResult(parsed)) {
				return parsed as BatchResult<T>;
			}

			if (result.isError) {
				const errorText = getTextContent(result);

				return createBatchFailure(
					commands,
					startedAt,
					{
						code: 'BATCH_ERROR',
						message: errorText || 'Batch execution failed',
						suggestion: 'Check the batch commands and try again',
					},
					`Batch execution failed: ${errorText || 'Unknown error'}`
				);
			}

			return createBatchFailure(
				commands,
				startedAt,
				{
					code: 'PARSE_ERROR',
					message: 'Failed to parse batch result',
					suggestion: 'The server returned an invalid response',
				},
				'Failed to parse batch result'
			);
		} catch (error) {
			const err = error instanceof Error ? error.message : String(error);
			return createBatchFailure(
				commands,
				startedAt,
				{
					code: 'BATCH_ERROR',
					message: err,
					suggestion: 'Check the connection and try again',
				},
				`Batch execution failed: ${err}`
			);
		}
	}

	/**
	 * Execute a pipeline of chained commands.
	 *
	 * Pipelines enable declarative composition of commands where the output
	 * of one becomes the input of the next via variable resolution.
	 *
	 * @param stepsOrRequest - Array of pipeline steps or full PipelineRequest
	 * @param options - Optional pipeline options
	 * @returns Pipeline result with aggregated metadata
	 *
	 * @example
	 * ```typescript
	 * const result = await client.pipe([
	 *   { command: 'user-get', input: { id: 123 }, as: 'user' },
	 *   { command: 'order-list', input: { userId: '$prev.id' } },
	 *   { command: 'order-summarize', input: {
	 *     orders: '$prev',
	 *     userName: '$steps.user.name'
	 *   }}
	 * ]);
	 *
	 * console.log(`Confidence: ${(result.metadata.confidence * 100).toFixed(1)}%`);
	 * console.log(`Completed: ${result.metadata.completedSteps}/${result.metadata.totalSteps}`);
	 * ```
	 */
	async pipe<T = unknown>(
		stepsOrRequest: PipelineStep[] | PipelineRequest,
		options?: PipelineOptions
	): Promise<PipelineResult<T>> {
		const request: PipelineRequest = Array.isArray(stepsOrRequest)
			? { steps: stepsOrRequest, options }
			: stepsOrRequest;

		try {
			// SAFETY: PipelineRequest is a plain object that serializes correctly as Record<string, unknown>
			// for the MCP tool call wire format.
			const result = await this.callTool('afd-pipe', request as unknown as Record<string, unknown>);
			const parsed = parseTextContent(result);

			if (isPipelineResult(parsed)) {
				return parsed as PipelineResult<T>;
			}

			if (result.isError) {
				const errorText = getTextContent(result);

				return createPipelineFailure<T>(request, {
					code: 'PIPELINE_ERROR',
					message: errorText || 'Pipeline execution failed',
					suggestion: 'Check the pipeline steps and try again',
				});
			}

			return createPipelineFailure<T>(request);
		} catch (error) {
			const err = error instanceof Error ? error.message : String(error);
			return createPipelineFailure<T>(request, {
				code: 'PIPELINE_ERROR',
				message: err,
				suggestion: 'Check the connection and try again',
			});
		}
	}

	/**
	 * Stream command execution results with real-time progress.
	 *
	 * Returns an async generator that yields StreamChunk objects
	 * containing progress updates, incremental data, completion,
	 * or error information.
	 *
	 * @param name - Command name to execute
	 * @param args - Command arguments
	 * @param options - Stream options (abort signal, timeout)
	 * @returns AsyncGenerator of StreamChunk objects
	 *
	 * @example
	 * ```typescript
	 * for await (const chunk of client.stream('llm.generate', { prompt: 'Hello' })) {
	 *   if (chunk.type === 'progress') {
	 *     console.log(`Progress: ${(chunk.progress * 100).toFixed(0)}%`);
	 *   } else if (chunk.type === 'data') {
	 *     process.stdout.write(String(chunk.data));
	 *   } else if (chunk.type === 'complete') {
	 *     console.log('Done!', chunk.data);
	 *   } else if (chunk.type === 'error') {
	 *     console.error('Error:', chunk.error.message);
	 *   }
	 * }
	 * ```
	 */
	async *stream<T = unknown>(
		name: string,
		args?: Record<string, unknown>,
		options?: StreamOptions
	): AsyncGenerator<StreamChunk<T>, void, unknown> {
		const url = new URL(this.config.url);
		// Use the stream endpoint relative to base URL
		const streamUrl = `${url.protocol}//${url.host}/stream/${encodeURIComponent(name)}`;

		const controller = new AbortController();
		const signal = options?.signal
			? AbortSignal.any([options.signal, controller.signal])
			: controller.signal;

		// Setup timeout if specified
		let timeoutId: ReturnType<typeof setTimeout> | undefined;
		if (options?.timeout) {
			timeoutId = setTimeout(() => controller.abort(), options.timeout);
		}

		let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
		let chunksReceived = 0;
		try {
			const response = await fetch(streamUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Accept: 'text/event-stream',
					...this.config.headers,
				},
				body: JSON.stringify(args ?? {}),
				signal,
			});

			if (!response.ok) {
				yield {
					type: 'error',
					error: {
						code: 'STREAM_ERROR',
						message: `HTTP ${response.status}: ${response.statusText}`,
						suggestion: 'Check the command name and arguments',
					},
					chunksBeforeError: 0,
					recoverable: false,
				};
				return;
			}

			reader = response.body?.getReader();
			if (!reader) {
				yield {
					type: 'error',
					error: {
						code: 'STREAM_ERROR',
						message: 'Response body is not readable',
						suggestion: 'The server does not support streaming',
					},
					chunksBeforeError: 0,
					recoverable: false,
				};
				return;
			}

			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();

				if (done) break;

				buffer += decoder.decode(value, { stream: true });

				// Process SSE events
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? ''; // Keep incomplete line in buffer

				for (const line of lines) {
					if (line.startsWith('data: ')) {
						const data = line.slice(6).trim();
						if (data === '[DONE]') {
							return;
						}

						try {
							const chunk = JSON.parse(data) as StreamChunk<T>;
							chunksReceived++;
							yield chunk;

							// Stop on complete or error
							if (isCompleteChunk(chunk) || isErrorChunk(chunk)) {
								return;
							}
						} catch {
							// Ignore malformed JSON
							this.debug('Malformed stream chunk:', data);
						}
					}
				}
			}
		} catch (error) {
			if (signal.aborted) {
				yield {
					type: 'error',
					error: {
						code: 'STREAM_CANCELLED',
						message: 'Stream was cancelled',
						suggestion: 'The request was aborted by the client',
					},
					chunksBeforeError: chunksReceived,
					recoverable: false,
				};
			} else {
				yield {
					type: 'error',
					error: wrapError(error),
					chunksBeforeError: chunksReceived,
					recoverable: true,
				};
			}
		} finally {
			if (timeoutId) {
				clearTimeout(timeoutId);
			}
			controller.abort();
			if (reader) {
				try {
					await reader.cancel();
				} catch {
					// The underlying fetch may already have released the reader.
				}
				reader.releaseLock();
			}
		}
	}

	/**
	 * Stream with callback-style API for convenience.
	 *
	 * This is a convenience wrapper around stream() that uses callbacks
	 * instead of async iteration.
	 *
	 * @param name - Command name to execute
	 * @param args - Command arguments
	 * @param callbacks - Callback handlers for stream events
	 * @param options - Stream options
	 * @returns Promise that resolves when stream completes
	 *
	 * @example
	 * ```typescript
	 * await client.streamWithCallbacks('llm.generate', { prompt: 'Hello' }, {
	 *   onProgress: (chunk) => console.log(`${(chunk.progress * 100).toFixed(0)}% - ${chunk.message}`),
	 *   onData: (chunk) => process.stdout.write(String(chunk.data)),
	 *   onComplete: (chunk) => console.log('Done!', chunk.data),
	 *   onError: (chunk) => console.error('Error:', chunk.error.message),
	 * });
	 * ```
	 */
	async streamWithCallbacks<T = unknown>(
		name: string,
		args: Record<string, unknown> | undefined,
		callbacks: StreamCallbacks<T>,
		options?: StreamOptions
	): Promise<void> {
		for await (const chunk of this.stream<T>(name, args, options)) {
			if (isProgressChunk(chunk) && callbacks.onProgress) {
				callbacks.onProgress(chunk);
			} else if (isDataChunk(chunk) && callbacks.onData) {
				callbacks.onData(chunk);
			} else if (isCompleteChunk(chunk) && callbacks.onComplete) {
				callbacks.onComplete(chunk);
			} else if (isErrorChunk(chunk) && callbacks.onError) {
				callbacks.onError(chunk);
			}
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// LOW-LEVEL REQUEST/RESPONSE
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Send a raw MCP request and wait for response.
	 */
	async request<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
		// Initialization requests must work during both initial connection and reconnection.
		const canRequest =
			this.transport &&
			(this.state === 'connected' ||
				this.state === 'connecting' ||
				this.state === 'reconnecting') &&
			this.transport.isConnected();

		if (!canRequest || !this.transport) {
			throw new Error('Not connected');
		}

		const request = createMcpRequest(method, params);
		this.debug(`Request [${request.id}]: ${method}`, params);
		const transport = this.transport;
		const controller = new AbortController();
		const timeout = setTimeout(() => {
			controller.abort(new Error(`Request '${method}' timed out after ${this.config.timeout}ms`));
		}, this.config.timeout);
		this.pendingRequests.set(request.id, { controller, timeout, method });

		try {
			const response = await transport.send(request, controller.signal);
			this.debug(`Response [${request.id}]:`, response);

			if (response.error) throw new Error(response.error.message);
			return response.result as T;
		} catch (error) {
			if (controller.signal.aborted && controller.signal.reason instanceof Error) {
				throw controller.signal.reason;
			}
			throw error;
		} finally {
			clearTimeout(timeout);
			this.pendingRequests.delete(request.id);
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// EVENT HANDLING
	// ═══════════════════════════════════════════════════════════════════════════

	/**
	 * Subscribe to an event.
	 */
	on<K extends keyof McpClientEvents>(
		event: K,
		handler: EventHandler<McpClientEvents[K]>
	): () => void {
		this.eventHandlers[event].push(handler as never);

		// Return unsubscribe function
		return () => {
			const index = this.eventHandlers[event].indexOf(handler as never);
			if (index > -1) {
				this.eventHandlers[event].splice(index, 1);
			}
		};
	}

	/**
	 * Emit an event.
	 */
	private emit<K extends keyof McpClientEvents>(
		event: K,
		...args: Parameters<McpClientEvents[K]>
	): void {
		for (const handler of this.eventHandlers[event]) {
			try {
				(handler as (...args: Parameters<McpClientEvents[K]>) => void)(...args);
			} catch (error) {
				console.error(`Error in event handler for '${event}':`, error);
			}
		}
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// INTERNAL
	// ═══════════════════════════════════════════════════════════════════════════

	private async initialize(): Promise<McpInitializeResult> {
		const params = {
			protocolVersion: '2024-11-05',
			capabilities: {
				roots: { listChanged: false },
			},
			clientInfo: {
				name: this.config.clientName,
				version: this.config.clientVersion,
			},
		};

		return this.request<McpInitializeResult>('initialize', params as Record<string, unknown>);
	}

	private async establishConnection(
		generation: number,
		reconnecting: boolean
	): Promise<McpInitializeResult> {
		this.setState(reconnecting ? 'reconnecting' : 'connecting');

		if (this.config.transport === 'stdio') {
			throw new Error('stdio transport not yet implemented');
		}
		if (this.config.transport === 'direct') {
			throw new Error(
				'Direct transport requires a registry. Use DirectClient or DirectTransport instead.'
			);
		}

		const transport = createTransport(this.config.transport, this.config.url, this.config.headers);
		this.transport = transport;
		transport.onMessage((response) => this.handleMessage(response));
		transport.onError((error) => this.handleError(error));
		transport.onClose(() => this.handleClose(generation, transport));

		const controller = new AbortController();
		this.connectionController = controller;
		const timeout = setTimeout(() => {
			controller.abort(new Error(`Connection timed out after ${this.config.timeout}ms`));
		}, this.config.timeout);

		try {
			await transport.connect(controller.signal);
			clearTimeout(timeout);
			if (generation !== this.connectionGeneration || this.intentionalDisconnect) {
				throw new Error('Connection attempt is no longer current');
			}

			const initResult = await this.initialize();
			if (generation !== this.connectionGeneration || this.intentionalDisconnect) {
				throw new Error('Connection attempt is no longer current');
			}

			this.serverInfo = initResult.serverInfo;
			this.capabilities = initResult.capabilities;
			this.connectedAt = new Date();
			this.setState('connected');
			this.emit('connected', initResult);
			await this.refreshTools();
			return initResult;
		} catch (error) {
			const err =
				controller.signal.aborted && controller.signal.reason instanceof Error
					? controller.signal.reason
					: error instanceof Error
						? error
						: new Error(String(error));
			if (this.transport === transport) this.transport = null;
			transport.disconnect();
			if (generation === this.connectionGeneration && !this.intentionalDisconnect) {
				this.setState('error');
				this.emit('error', err);
			}
			throw err;
		} finally {
			clearTimeout(timeout);
			if (this.connectionController === controller) this.connectionController = null;
		}
	}

	private async runReconnectLoop(generation: number): Promise<void> {
		while (
			!this.intentionalDisconnect &&
			generation === this.connectionGeneration &&
			this.reconnectAttempts < this.config.maxReconnectAttempts
		) {
			this.reconnectAttempts++;
			this.setState('reconnecting');
			this.emit('reconnecting', this.reconnectAttempts, this.config.maxReconnectAttempts);
			const delay = this.config.reconnectDelay * 2 ** (this.reconnectAttempts - 1);
			await this.waitForReconnectDelay(delay);
			if (this.intentionalDisconnect || generation !== this.connectionGeneration) return;

			try {
				await this.establishConnection(generation, true);
				this.reconnectAttempts = 0;
				return;
			} catch {
				// Continue until the configured attempt bound is reached.
			}
		}

		if (!this.intentionalDisconnect && generation === this.connectionGeneration) {
			this.setState('error');
			this.emit('error', new Error('Max reconnection attempts reached'));
		}
	}

	private waitForReconnectDelay(delay: number): Promise<void> {
		return new Promise((resolve) => {
			this.reconnectDelayResolve = resolve;
			this.reconnectTimer = setTimeout(() => {
				this.reconnectTimer = null;
				this.reconnectDelayResolve = null;
				resolve();
			}, delay);
		});
	}

	private cancelReconnectDelay(): void {
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		this.reconnectTimer = null;
		const resolve = this.reconnectDelayResolve;
		this.reconnectDelayResolve = null;
		resolve?.();
	}

	private setState(state: ConnectionState): void {
		if (this.state !== state) {
			this.state = state;
			this.emit('stateChange', state);
		}
	}

	private handleMessage(response: McpResponse): void {
		this.emit('message', response);
	}

	private handleError(error: Error): void {
		this.emit('error', error);
	}

	private handleClose(generation: number, transport: Transport): void {
		if (generation !== this.connectionGeneration || transport !== this.transport) return;

		if (!this.intentionalDisconnect && this.state === 'connected' && this.config.autoReconnect) {
			void this.attemptReconnect(generation);
		} else {
			this.setState('disconnected');
			this.emit('disconnected', 'Connection closed');
		}
	}

	private attemptReconnect(generation: number): Promise<void> {
		if (this.reconnectPromise && this.reconnectGeneration === generation) {
			return this.reconnectPromise;
		}

		const reconnectPromise = this.runReconnectLoop(generation).finally(() => {
			if (this.reconnectPromise === reconnectPromise) {
				this.reconnectPromise = null;
				this.reconnectGeneration = null;
			}
		});
		this.reconnectPromise = reconnectPromise;
		this.reconnectGeneration = generation;
		return reconnectPromise;
	}

	private debug(message: string, data?: unknown): void {
		if (this.config.debug) {
			console.log(`[McpClient] ${message}`, data ?? '');
		}
	}
}

/**
 * Create a new MCP client.
 *
 * @param config - Client configuration
 * @returns New McpClient instance
 */
export function createClient(config: McpClientConfig): McpClient {
	return new McpClient(config);
}
