import type { McpTool } from '@lushly-dev/afd-core';
import { validateCommandSurface } from '@lushly-dev/afd-testing';
import { describe, expect, it } from 'vitest';
import { mapToolsToSurfaceCommands } from './validate.js';

describe('remote surface metadata', () => {
	it('preserves category, prerequisites, output schema, examples, and contexts', () => {
		const tools: McpTool[] = [
			{
				name: 'alpha-run',
				description: 'Run the alpha operation',
				inputSchema: { type: 'object' },
				_meta: {
					category: 'alpha',
					requires: ['missing-command'],
					examples: [{ title: 'Basic', input: {} }],
					outputSchema: { type: 'object', properties: { value: { type: 'string' } } },
					contexts: ['editing'],
				},
			},
		];

		const commands = mapToolsToSurfaceCommands(tools);
		expect(commands[0]).toMatchObject({
			category: 'alpha',
			requires: ['missing-command'],
			examples: [{ title: 'Basic', input: {} }],
			outputJsonSchema: { type: 'object' },
			contexts: ['editing'],
		});

		const result = validateCommandSurface(commands, { configuredContexts: ['editing'] });
		expect(result.findings.some((finding) => finding.rule === 'unresolved-prerequisite')).toBe(
			true
		);
		expect(result.findings.some((finding) => finding.rule === 'missing-output-schema')).toBe(false);
		expect(result.findings.some((finding) => finding.rule === 'missing-context')).toBe(false);
	});

	it('retains prerequisite cycles from MCP metadata', () => {
		const tools: McpTool[] = ['alpha-run', 'beta-run'].map((name, index, names) => ({
			name,
			description: `Run the ${name} operation`,
			inputSchema: { type: 'object' },
			_meta: { requires: [names[1 - index] ?? ''] },
		}));

		const result = validateCommandSurface(mapToolsToSurfaceCommands(tools));
		expect(result.findings.some((finding) => finding.rule === 'circular-prerequisite')).toBe(true);
	});
});
