import { type CommandResult, failure, success } from '@lushly-dev/afd-core';
import { describe, expect, it } from 'vitest';
import {
	assertAiResult,
	assertConfidence,
	assertErrorCode,
	assertFailure,
	assertHasPlan,
	assertHasReasoning,
	assertHasSources,
	assertHasSuggestion,
	assertRetryable,
	assertStepStatus,
	assertSuccess,
} from './assertions.js';

const failed = failure({
	code: 'TEMPORARY',
	message: 'Try again',
	suggestion: 'Retry later',
	retryable: true,
});

const aiResult = success(
	{ answer: 42 },
	{
		confidence: 0.9,
		reasoning: 'Calculated from the inputs',
		sources: [{ type: 'document', id: 'source-1' }],
		alternatives: [{ data: { answer: 41 }, reason: 'Approximation' }],
		plan: [{ id: 'calculate', action: 'Calculate answer', status: 'complete' }],
	}
);

describe('result assertions', () => {
	it('accepts matching success and failure contracts', () => {
		expect(() => assertSuccess(aiResult)).not.toThrow();
		expect(() => assertFailure(failed)).not.toThrow();
		expect(() => assertErrorCode(failed, 'TEMPORARY')).not.toThrow();
	});

	it('describes mismatched success and failure results', () => {
		expect(() => assertSuccess(failed)).toThrow(
			'Expected success but got failure: TEMPORARY: Try again'
		);
		expect(() => assertSuccess({ success: false } as CommandResult)).toThrow('Unknown error');
		expect(() => assertFailure(aiResult)).toThrow(
			'Expected failure but got success with data: {"answer":42}'
		);
		expect(() => assertErrorCode(failed, 'PERMANENT')).toThrow(
			"Expected error code 'PERMANENT' but got 'TEMPORARY'"
		);
	});

	it('uses caller-provided messages for failed assertions', () => {
		expect(() => assertSuccess(failed, 'custom success')).toThrow('custom success');
		expect(() => assertFailure(aiResult, 'custom failure')).toThrow('custom failure');
		expect(() => assertErrorCode(failed, 'OTHER', 'custom code')).toThrow('custom code');
	});
});

describe('UX field assertions', () => {
	it('accepts the complete AI result', () => {
		expect(() => assertConfidence(aiResult, 0.8)).not.toThrow();
		expect(() => assertHasReasoning(aiResult)).not.toThrow();
		expect(() => assertHasSources(aiResult, 1)).not.toThrow();
		expect(() => assertHasPlan(aiResult)).not.toThrow();
		expect(() => assertStepStatus(aiResult, 'calculate', 'complete')).not.toThrow();
		expect(() =>
			assertAiResult(aiResult, {
				minConfidence: 0.8,
				requireSources: true,
				requireAlternatives: true,
			})
		).not.toThrow();
	});

	it('reports missing and insufficient confidence', () => {
		expect(() => assertConfidence(success({}), 0.5)).toThrow(
			'Expected confidence score but none was provided'
		);
		expect(() => assertConfidence(aiResult, 0.95)).toThrow(
			'Expected confidence >= 0.95 but got 0.9'
		);
	});

	it('reports missing reasoning, sources, plans, and plan steps', () => {
		const empty = success({});
		expect(() => assertHasReasoning(empty)).toThrow('Expected reasoning but none was provided');
		expect(() => assertHasSources(empty)).toThrow('Expected sources but none were provided');
		expect(() => assertHasSources(aiResult, 2)).toThrow('Expected at least 2 sources but got 1');
		expect(() => assertHasPlan(empty)).toThrow('Expected plan but none was provided');
		expect(() => assertStepStatus(aiResult, 'missing', 'complete')).toThrow(
			"Plan step 'missing' not found"
		);
		expect(() => assertStepStatus(aiResult, 'calculate', 'failed')).toThrow(
			"Expected step 'calculate' to have status 'failed' but got 'complete'"
		);
	});

	it('checks recovery guidance on failures', () => {
		expect(() => assertHasSuggestion(failed)).not.toThrow();
		expect(() => assertRetryable(failed)).not.toThrow();
		expect(() => assertRetryable(failed, false)).toThrow(
			'Expected error.retryable to be false but got true'
		);
		const bare = failure({ code: 'BAD', message: 'Bad input' });
		expect(() => assertHasSuggestion(bare)).toThrow(
			'Expected error to have a suggestion but none was provided'
		);
	});

	it.each([
		[success({}, { reasoning: 'Known' }), 'AI result must include confidence score'],
		[success({}, { confidence: 0.2, reasoning: 'Known' }), 'below minimum'],
		[success({}, { confidence: 0.9 }), 'AI result should include reasoning'],
		[success({}, { confidence: 0.9, reasoning: 'Known' }), 'AI result must include sources'],
		[
			success({}, { confidence: 0.9, reasoning: 'Known', sources: [{ type: 'other' }] }),
			'AI result must include alternatives',
		],
	] as const)('rejects incomplete AI results', (result, message) => {
		expect(() =>
			assertAiResult(result, {
				minConfidence: 0.5,
				requireSources: true,
				requireAlternatives: true,
			})
		).toThrow(message);
	});
});
