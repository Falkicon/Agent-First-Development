import { type CommandDefinition, type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import { validateCommandDefinition, validateError, validateResult } from './validators.js';

const validCommand: CommandDefinition = {
	name: 'todo-create',
	description: 'Create a todo item',
	category: 'todos',
	parameters: [{ name: 'title', type: 'string', description: 'Todo title' }],
	errors: ['INVALID_TITLE'],
	handler: async () => success({ id: '1' }),
};

describe('validateResult', () => {
	it('accepts a complete AI result', () => {
		const result = success(
			{ id: '1' },
			{
				confidence: 0.9,
				reasoning: 'The input was valid',
				sources: [{ type: 'document', id: 'spec' }],
				plan: [{ id: 'create', action: 'Create item', status: 'complete' }],
			}
		);

		expect(
			validateResult(result, {
				requireConfidence: true,
				requireReasoning: true,
				requireSources: true,
			})
		).toEqual({ valid: true, errors: [], warnings: [] });
	});

	it('reports structural errors and missing AI guidance together', () => {
		const result = {
			success: 'yes',
			confidence: 2,
			plan: [{ id: '', action: '', status: '' }, undefined],
		} as unknown as CommandResult;

		const validation = validateResult(result, {
			requireConfidence: true,
			requireReasoning: true,
			requireSources: true,
		});

		expect(validation.valid).toBe(false);
		expect(validation.errors.map((error) => error.code)).toEqual([
			'INVALID_SUCCESS_TYPE',
			'INVALID_CONFIDENCE_RANGE',
			'MISSING_STEP_ID',
			'MISSING_STEP_ACTION',
			'MISSING_STEP_STATUS',
		]);
		expect(validation.warnings.map((warning) => warning.code)).toEqual([
			'MISSING_DATA',
			'MISSING_REASONING',
			'MISSING_SOURCES',
		]);
	});

	it('distinguishes missing data, error, and confidence type failures', () => {
		expect(validateResult(success(undefined)).warnings).toContainEqual(
			expect.objectContaining({ code: 'MISSING_DATA' })
		);
		expect(validateResult(success(undefined), { requireData: false }).warnings).toEqual([]);
		expect(
			validateResult({ success: false } as CommandResult).errors.map((error) => error.code)
		).toContain('MISSING_ERROR');
		expect(
			validateResult({ success: true, data: {}, confidence: 'high' } as unknown as CommandResult)
				.errors
		).toContainEqual(expect.objectContaining({ code: 'INVALID_CONFIDENCE_TYPE' }));
		expect(validateResult(success({}), { requireConfidence: true }).warnings).toContainEqual(
			expect.objectContaining({ code: 'MISSING_CONFIDENCE' })
		);
	});

	it('prefixes nested error findings with the error path', () => {
		const validation = validateResult(failure({ code: '', message: '', retryable: false }));

		expect(validation.errors.map((error) => error.path)).toEqual(['error.code', 'error.message']);
		expect(validation.warnings).toContainEqual(
			expect.objectContaining({ path: 'error.suggestion', code: 'MISSING_SUGGESTION' })
		);
	});
});

describe('validateError', () => {
	it('rejects values that do not satisfy the command error contract', () => {
		expect(validateError(new Error('boom'))).toEqual({
			valid: false,
			errors: [
				{
					path: '',
					message: 'Error must have code and message properties',
					code: 'INVALID_ERROR_STRUCTURE',
				},
			],
			warnings: [],
		});
	});

	it('requires non-empty codes and messages and recommends recovery metadata', () => {
		const validation = validateError({ code: '', message: '' });

		expect(validation.errors.map((error) => error.code)).toEqual([
			'INVALID_ERROR_CODE',
			'INVALID_ERROR_MESSAGE',
		]);
		expect(validation.warnings.map((warning) => warning.code)).toEqual([
			'MISSING_SUGGESTION',
			'MISSING_RETRYABLE',
		]);
	});
});

describe('validateCommandDefinition', () => {
	it('accepts a complete command definition', () => {
		expect(validateCommandDefinition(validCommand)).toEqual({
			valid: true,
			errors: [],
			warnings: [],
		});
	});

	it('reports invalid required fields without stopping at the first problem', () => {
		const invalid = {
			name: '',
			description: '',
			parameters: null,
			handler: null,
		} as unknown as CommandDefinition;
		const validation = validateCommandDefinition(invalid);

		expect(validation.valid).toBe(false);
		expect(validation.errors.map((error) => error.code)).toEqual([
			'MISSING_NAME',
			'MISSING_DESCRIPTION',
			'MISSING_PARAMETERS',
			'MISSING_HANDLER',
		]);
		expect(validation.warnings.map((warning) => warning.code)).toEqual([
			'MISSING_CATEGORY',
			'MISSING_ERROR_DOCS',
		]);
	});

	it('provides actionable warnings for weak names, descriptions, and parameters', () => {
		const command = {
			...validCommand,
			name: 'createTodo',
			description: 'short',
			parameters: [{ name: '', type: undefined, description: '' }, undefined],
		} as unknown as CommandDefinition;

		const validation = validateCommandDefinition(command);

		expect(validation.errors.map((error) => error.code)).toEqual([
			'MISSING_PARAM_NAME',
			'MISSING_PARAM_TYPE',
		]);
		expect(validation.warnings.map((warning) => warning.code)).toEqual([
			'INVALID_NAME_FORMAT',
			'SHORT_DESCRIPTION',
			'MISSING_PARAM_DESCRIPTION',
		]);
	});
});
