/** @fileoverview HTTP transport handler — MCP protocol, SSE, and REST endpoints. */
import { once } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type {
	BatchRequest,
	BatchResult,
	CommandContext,
	CommandResult,
	StreamChunk,
} from '@lushly-dev/afd-core';
import { createErrorChunk, isBatchRequest } from '@lushly-dev/afd-core';
import {
	HttpRequestError,
	type HttpSecurityOptions,
	readJsonBody,
	validateHttpRequest,
} from './http-security.js';
import type { ToolCallResult } from './tool-router.js';

interface SseClient {
	id: string;
	response: ServerResponse;
}
interface McpRequest {
	jsonrpc?: '2.0';
	id?: string | number;
	method: string;
	params?: unknown;
}

export interface HttpHandlerDeps extends HttpSecurityOptions {
	name: string;
	version: string;
	port: number;
	cors: boolean;
	getToolsList: () => unknown[];
	routeToolCall: (toolName: string, args: unknown) => Promise<ToolCallResult>;
	executeCommand: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => Promise<CommandResult>;
	executeBatch: (request: BatchRequest, context?: CommandContext) => Promise<BatchResult>;
	executeStream: (
		name: string,
		input: unknown,
		context?: CommandContext
	) => AsyncGenerator<StreamChunk, void, unknown>;
}

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { 'Content-Type': 'application/json' });
	res.end(JSON.stringify(body));
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new HttpRequestError(400, 'Expected a JSON object');
	}
	return value as Record<string, unknown>;
}

export function createHttpHandler(deps: HttpHandlerDeps) {
	const {
		name,
		version,
		cors,
		devMode,
		getToolsList,
		routeToolCall,
		executeCommand,
		executeBatch,
		executeStream,
	} = deps;
	const maxBodyBytes = deps.maxBodyBytes ?? 1024 * 1024;
	if (!Number.isSafeInteger(maxBodyBytes) || maxBodyBytes <= 0)
		throw new Error('maxBodyBytes must be a positive integer');
	const sseClients = new Map<string, SseClient>();
	const streams = new Map<ServerResponse, AbortController>();
	let clientIdCounter = 0;

	async function handleMcpRequest(value: unknown): Promise<unknown> {
		const request = object(value) as unknown as McpRequest;
		const { id = null, method, params } = request;
		if (typeof method !== 'string') throw new HttpRequestError(400, 'Request method is required');
		let result: unknown;
		switch (method) {
			case 'initialize':
				result = {
					protocolVersion: '2024-11-05',
					capabilities: { tools: {} },
					serverInfo: { name, version },
				};
				break;
			case 'tools/list':
				result = { tools: getToolsList() };
				break;
			case 'notifications/initialized':
				result = {};
				break;
			case 'tools/call': {
				const args = object(params);
				if (typeof args.name !== 'string') throw new HttpRequestError(400, 'Tool name is required');
				result = await routeToolCall(args.name, args.arguments ?? {});
				break;
			}
			default:
				return {
					jsonrpc: '2.0',
					id,
					error: { code: -32601, message: `Method not found: ${method}` },
				};
		}
		return { jsonrpc: '2.0', id, result };
	}

	async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const url = validateHttpRequest(req, deps);
		if (cors && req.headers.origin) {
			res.setHeader('Access-Control-Allow-Origin', devMode ? '*' : req.headers.origin);
			res.setHeader('Vary', 'Origin');
			res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
			res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
		}
		if (req.method === 'OPTIONS') {
			res.writeHead(204);
			res.end();
			return;
		}
		if (url.pathname === '/health' && req.method === 'GET') {
			json(res, 200, { status: 'ok', name, version });
			return;
		}
		if (url.pathname === '/sse' && req.method === 'GET') {
			const clientId = `client-${++clientIdCounter}`;
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			sseClients.set(clientId, { id: clientId, response: res });
			res.write(
				`event: endpoint\ndata: ${JSON.stringify({ url: new URL('/message', url).href })}\n\n`
			);
			res.once('close', () => sseClients.delete(clientId));
			return;
		}
		if (url.pathname === '/message' && req.method === 'POST') {
			json(res, 200, await handleMcpRequest(await readJsonBody(req, maxBodyBytes)));
			return;
		}
		if (url.pathname === '/rpc' && req.method === 'POST') {
			const request = object(await readJsonBody(req, maxBodyBytes));
			if (typeof request.method !== 'string' || !request.method)
				throw new HttpRequestError(400, 'Request method is required');
			const result = await executeCommand(request.method, request.params ?? {}, {
				traceId: `rpc-${crypto.randomUUID()}`,
			});
			json(res, 200, { jsonrpc: '2.0', id: request.id ?? null, result });
			return;
		}
		if (url.pathname === '/batch' && req.method === 'POST') {
			const request = await readJsonBody(req, maxBodyBytes);
			if (!isBatchRequest(request))
				throw new HttpRequestError(400, 'Provide { commands: [...] } with command objects');
			json(res, 200, await executeBatch(request, { traceId: `batch-${crypto.randomUUID()}` }));
			return;
		}
		if (url.pathname.startsWith('/stream/') && (req.method === 'GET' || req.method === 'POST')) {
			let commandName: string;
			try {
				commandName = decodeURIComponent(url.pathname.slice('/stream/'.length));
			} catch {
				throw new HttpRequestError(400, 'Invalid stream command name');
			}
			let input: unknown;
			if (req.method === 'POST') input = await readJsonBody(req, maxBodyBytes);
			else {
				try {
					input = JSON.parse(url.searchParams.get('input') ?? '{}');
				} catch {
					throw new HttpRequestError(400, 'Stream input must be valid JSON');
				}
			}
			const controller = new AbortController();
			streams.set(res, controller);
			const abort = () => controller.abort();
			res.once('close', abort);
			res.writeHead(200, {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache',
				Connection: 'keep-alive',
			});
			res.flushHeaders();
			try {
				const context = { traceId: `stream-${crypto.randomUUID()}`, signal: controller.signal };
				for await (const chunk of executeStream(commandName, input, context)) {
					if (controller.signal.aborted) break;
					if (!res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`)) {
						await once(res, 'drain', { signal: controller.signal });
					}
				}
			} catch (error) {
				if (!controller.signal.aborted) {
					const chunk = createErrorChunk(
						{
							code: 'STREAM_ERROR',
							message:
								devMode && error instanceof Error ? error.message : 'Stream execution failed',
							suggestion: 'Retry the command or contact the server operator',
							retryable: true,
						},
						0,
						true
					);
					res.write(`event: chunk\ndata: ${JSON.stringify(chunk)}\n\n`);
				}
			} finally {
				controller.abort();
				streams.delete(res);
				res.off('close', abort);
				res.end();
			}
			return;
		}
		json(res, 404, { error: 'Not found' });
	}

	const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
		// Rejected/unconsumed uploads can emit a late socket error after the response.
		const observeRequestError = () => {};
		req.on('error', observeRequestError);
		req.once('close', () => req.off('error', observeRequestError));
		try {
			await route(req, res);
		} catch (error) {
			if (res.destroyed || res.writableEnded) return;
			if (res.headersSent) {
				res.end();
				return;
			}
			const status = error instanceof HttpRequestError ? error.status : 500;
			const message =
				error instanceof HttpRequestError ? error.message : 'An internal error occurred';
			res.setHeader('Connection', 'close');
			json(res, status, {
				success: false,
				error: {
					code: `HTTP_${status}`,
					message,
					suggestion:
						status === 500
							? 'Retry or contact the server operator'
							: 'Correct the request headers or body and retry',
				},
			});
		}
	};
	const dispose = () => {
		for (const client of sseClients.values()) client.response.end();
		sseClients.clear();
		for (const [response, controller] of streams) {
			controller.abort();
			response.end();
		}
		streams.clear();
	};
	return { handler, sseClients, dispose };
}
