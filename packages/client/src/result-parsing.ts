import type {
	BatchCommand,
	BatchResult,
	CommandError,
	CommandResult,
	McpToolCallResult,
	PipelineRequest,
	PipelineResult,
} from '@lushly-dev/afd-core';
import { isBatchResult, isPipelineResult } from '@lushly-dev/afd-core';

export function getTextContent(result: McpToolCallResult): string {
	return result.content
		.filter((content): content is { type: 'text'; text: string } => content.type === 'text')
		.map((content) => content.text)
		.join('');
}

export function parseTextContent(result: McpToolCallResult): unknown {
	const text = getTextContent(result);
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export function isCommandResult(value: unknown): value is CommandResult {
	return (
		typeof value === 'object' &&
		value !== null &&
		'success' in value &&
		typeof value.success === 'boolean'
	);
}

export function createBatchFailure<T>(
	commands: BatchCommand[],
	startedAt: string,
	error: CommandError,
	reasoning: string
): BatchResult<T> {
	return {
		success: false,
		results: [],
		summary: {
			total: commands.length,
			successCount: 0,
			failureCount: commands.length,
			skippedCount: 0,
		},
		timing: {
			startedAt,
			completedAt: new Date().toISOString(),
			totalMs: 0,
			averageMs: 0,
		},
		confidence: 0,
		reasoning,
		error,
	};
}

export function createPipelineFailure<T>(
	request: PipelineRequest,
	error?: CommandError
): PipelineResult<T> {
	return {
		data: undefined as T,
		metadata: {
			confidence: 0,
			confidenceBreakdown: [],
			reasoning: [],
			warnings: [],
			sources: [],
			alternatives: [],
			executionTimeMs: 0,
			completedSteps: 0,
			totalSteps: request.steps.length,
		},
		steps: error
			? request.steps.map((step, index) => ({
					index,
					alias: step.as,
					command: step.command,
					status: 'failure' as const,
					error,
					executionTimeMs: 0,
				}))
			: [],
	};
}

export { isBatchResult, isPipelineResult };
