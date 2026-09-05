/**
 * @fileoverview Shared CLI connection resolution
 */

import { createClient, type McpClient } from '@lushly-dev/afd-client';
import { getConfig } from './config.js';

let activeClient: McpClient | null = null;

/** Get the active in-process client. */
export function getClient(): McpClient | null {
	return activeClient;
}

/** Replace the active in-process client. */
export function setClient(client: McpClient | null): void {
	activeClient = client;
}

export interface ConnectionOptions {
	/** Use this URL for only the current command. */
	url?: string;
	/** Override the configured transport for this connection. */
	transport?: 'sse' | 'http';
	/** Override the configured timeout for this connection. */
	timeout?: number;
}

/**
 * Return the live client or reconnect from explicit/configured connection details.
 * Explicit options are never persisted, so scenario tests do not replace the
 * user's default server.
 */
export async function ensureConnected(options: ConnectionOptions = {}): Promise<McpClient | null> {
	const active = getClient();
	const activeUrl = active?.getStatus().url;

	if (active?.isConnected() && (!options.url || options.url === activeUrl)) {
		return active;
	}

	const config = getConfig();
	const url = options.url ?? config.serverUrl;
	if (!url) return null;

	const client = createClient({
		url,
		transport: options.transport ?? (options.url ? 'http' : (config.transport ?? 'http')),
		timeout: options.timeout ?? config.timeout ?? 30000,
		autoReconnect: options.url ? false : config.autoReconnect,
	});

	try {
		await client.connect();
		setClient(client);
		return client;
	} catch {
		await client.disconnect().catch(() => undefined);
		return null;
	}
}
