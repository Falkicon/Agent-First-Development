/** Complete envelope validation before a batch or pipeline can execute side effects. */
import type { BatchCommand, BatchRequest } from './batch.js';
import type { PipelineRequest, PipelineStep } from './pipeline.js';

function record(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function optionalString(value: unknown): boolean {
	return value === undefined || typeof value === 'string';
}
function optionalBoolean(value: unknown): boolean {
	return value === undefined || typeof value === 'boolean';
}
function timeout(value: unknown): boolean {
	return value === undefined || (typeof value === 'number' && Number.isFinite(value) && value >= 0);
}
export function isBatchCommand(value: unknown): value is BatchCommand {
	return (
		record(value) &&
		typeof value.command === 'string' &&
		value.command.trim().length > 0 &&
		optionalString(value.id)
	);
}
export function isBatchRequest(value: unknown): value is BatchRequest {
	if (
		!record(value) ||
		!Array.isArray(value.commands) ||
		!Array.from(value.commands).every(isBatchCommand)
	)
		return false;
	const options = value.options;
	return (
		options === undefined ||
		(record(options) &&
			optionalBoolean(options.stopOnError) &&
			timeout(options.timeout) &&
			(options.parallelism === undefined ||
				(typeof options.parallelism === 'number' &&
					Number.isInteger(options.parallelism) &&
					options.parallelism > 0)))
	);
}
function condition(value: unknown, ancestors = new Set<unknown>()): boolean {
	if (!record(value) || ancestors.has(value) || ancestors.size >= 128) return false;
	const keys = Object.keys(value);
	if (keys.length !== 1) return false;
	const key = keys[0];
	if (!key) return false;
	const operand = value[key];
	if (key === '$exists') return typeof operand === 'string';
	if (['$eq', '$ne', '$gt', '$gte', '$lt', '$lte'].includes(key)) {
		return (
			Array.isArray(operand) &&
			operand.length === 2 &&
			typeof operand[0] === 'string' &&
			(key === '$eq' ||
				key === '$ne' ||
				(typeof operand[1] === 'number' && Number.isFinite(operand[1])))
		);
	}
	ancestors.add(value);
	const valid =
		key === '$not'
			? condition(operand, ancestors)
			: (key === '$and' || key === '$or') &&
				Array.isArray(operand) &&
				Array.from(operand).every((item) => condition(item, ancestors));
	ancestors.delete(value);
	return valid;
}
export function isPipelineStep(value: unknown): value is PipelineStep {
	return (
		record(value) &&
		typeof value.command === 'string' &&
		value.command.trim().length > 0 &&
		optionalString(value.as) &&
		optionalBoolean(value.stream) &&
		(value.input === undefined || record(value.input)) &&
		(value.when === undefined || condition(value.when))
	);
}
export function isPipelineRequest(value: unknown): value is PipelineRequest {
	if (
		!record(value) ||
		!optionalString(value.id) ||
		!Array.isArray(value.steps) ||
		!Array.from(value.steps).every(isPipelineStep)
	)
		return false;
	const options = value.options;
	return (
		options === undefined ||
		(record(options) &&
			optionalBoolean(options.continueOnFailure) &&
			optionalBoolean(options.parallel) &&
			timeout(options.timeoutMs) &&
			(options.onProgress === undefined || typeof options.onProgress === 'function'))
	);
}
