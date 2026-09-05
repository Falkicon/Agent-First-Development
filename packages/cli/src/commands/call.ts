/**
 * @fileoverview Call command
 */

import type { Command } from 'commander';
import ora from 'ora';
import { ensureConnected } from '../connection.js';
import { type OutputFormat, printError, printResult } from '../output.js';

/**
 * Register the call command.
 */
export function registerCallCommand(program: Command): void {
	program
		.command('call')
		.description('Call a tool/command')
		.argument('<name>', 'Tool name (e.g., document.create)')
		.argument('[args]', 'JSON arguments or key=value pairs')
		.option('--connect <url>', 'Use an MCP server URL for this call without changing saved config')
		.option('--transport <type>', 'Transport type for --connect (sse, http; default: http)')
		.option('--timeout <ms>', 'Connection timeout in milliseconds')
		.option('-f, --format <format>', 'Output format (json, text)', 'text')
		.option('-v, --verbose', 'Show detailed output including reasoning and sources')
		.action(async (name: string, args: string | undefined, options) => {
			const client = await ensureConnected({
				url: options.connect,
				transport: options.transport as 'sse' | 'http',
				timeout: options.timeout ? Number.parseInt(options.timeout, 10) : undefined,
			});

			if (!client) {
				printError('Not connected. Run "afd connect <url>" first.');
				process.exit(1);
			}

			// Parse arguments
			let parsedArgs: Record<string, unknown> = {};

			if (args) {
				try {
					// Try JSON first
					if (args.startsWith('{')) {
						parsedArgs = JSON.parse(args);
					} else {
						// Parse key=value pairs
						parsedArgs = parseKeyValuePairs(args);
					}
				} catch (_error) {
					printError('Invalid arguments format. Use JSON or key=value pairs.');
					process.exit(1);
				}
			}

			const spinner = ora(`Calling ${name}...`).start();

			try {
				const result = await client.call(name, parsedArgs);
				spinner.stop();

				printResult(result, {
					format: options.format as OutputFormat,
					verbose: options.verbose,
				});

				// Exit with error code if command failed
				if (!result.success) {
					process.exit(1);
				}
			} catch (error) {
				spinner.fail(`Failed to call ${name}`);
				printError('Command execution failed', error instanceof Error ? error : undefined);
				process.exit(1);
			}
		});
}

/**
 * Parse key=value pairs into an object.
 */
function parseKeyValuePairs(input: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const pairs = input.split(/\s+/);

	for (const pair of pairs) {
		const [key, ...valueParts] = pair.split('=');
		if (key && valueParts.length > 0) {
			const value = valueParts.join('=');
			// Try to parse as JSON for complex values
			try {
				result[key] = JSON.parse(value);
			} catch {
				result[key] = value;
			}
		}
	}

	return result;
}
