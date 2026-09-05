import { chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Scenario, Step } from '../types/scenario.js';
import type { CommandHandler } from './executor.js';
import {
	createExecutor,
	InProcessExecutor,
	ScenarioExecutor,
	validateScenario,
} from './executor.js';

const cliFixturePath = join(
	dirname(fileURLToPath(import.meta.url)),
	'fixtures',
	'fake-afd-cli.mjs'
);

beforeAll(() => chmodSync(cliFixturePath, 0o755));

// ═══════════════════════════════════════════════════════════════════════════════
// Test Fixtures
// ═══════════════════════════════════════════════════════════════════════════════

function makePassingHandler(): CommandHandler {
	return async (command, input) => ({
		success: true,
		data: { id: '123', command, ...(input ?? {}) },
		confidence: 1.0,
		reasoning: 'Test passed',
	});
}

function makeFailingHandler(): CommandHandler {
	return async () => ({
		success: false,
		error: {
			code: 'TEST_FAIL',
			message: 'Intentional failure',
		},
	});
}

function makeThrowingHandler(): CommandHandler {
	return async () => {
		throw new Error('Handler exploded');
	};
}

function makeScenario(overrides?: Partial<Scenario>): Scenario {
	return {
		name: 'Test Scenario',
		description: 'A test scenario',
		job: 'test-job',
		tags: ['test'],
		steps: [
			{
				command: 'test-cmd',
				input: { title: 'Hello' },
				expect: { success: true },
			},
		],
		...overrides,
	};
}

describe('ScenarioExecutor', () => {
	const config = {
		cliPath: cliFixturePath,
		serverUrl: 'http://test.example/mcp',
	} as const;

	it('executes CLI steps and invokes lifecycle callbacks', async () => {
		const onScenarioStart = vi.fn();
		const onStepComplete = vi.fn();
		const onScenarioComplete = vi.fn();
		const executor = new ScenarioExecutor({
			...config,
			onScenarioStart,
			onStepComplete,
			onScenarioComplete,
		});

		const result = await executor.execute(makeScenario());

		expect(result).toMatchObject({ outcome: 'pass', passedSteps: 1, failedSteps: 0 });
		expect(onScenarioStart).toHaveBeenCalledOnce();
		expect(onStepComplete).toHaveBeenCalledOnce();
		expect(onScenarioComplete).toHaveBeenCalledWith(result);
	});

	it('formats multiple expectation mismatches for diagnosis', async () => {
		const executor = new ScenarioExecutor(config);
		const result = await executor.execute(
			makeScenario({
				steps: [
					{
						command: 'test-cmd',
						input: { title: 'actual' },
						expect: { success: true, data: { title: 'expected', missing: { exists: true } } },
					},
				],
			})
		);

		expect(result.outcome).toBe('fail');
		expect(result.stepResults[0]?.error?.message).toContain('2 assertions failed');
		expect(result.stepResults[0]?.error?.message).toContain('data.title');
	});

	it('skips later steps after a malformed CLI response', async () => {
		const onStepComplete = vi.fn();
		const executor = new ScenarioExecutor({ ...config, onStepComplete });
		const result = await executor.execute(
			makeScenario({
				steps: [
					{ command: 'malformed', expect: { success: true } },
					{ command: 'test-cmd', expect: { success: true } },
				],
			})
		);

		expect(result).toMatchObject({ outcome: 'fail', failedSteps: 1, skippedSteps: 1 });
		expect(result.stepResults[0]?.error?.type).toBe('parse_error');
		expect(result.stepResults[1]?.skippedReason).toBe('Previous step failed');
		expect(onStepComplete).toHaveBeenCalledTimes(2);
	});

	it('can be reconfigured to continue and execute multiple scenarios', async () => {
		const completed = vi.fn();
		const executor = createExecutor(config);
		executor.configure({ stopOnFailure: false, onScenarioComplete: completed });
		const scenario = makeScenario({
			steps: [
				{ command: 'fail-command', input: { id: 'missing' }, expect: { success: true } },
				{ command: 'test-cmd', input: { id: 'next' }, expect: { success: true } },
			],
		});

		const results = await executor.executeAll([scenario, makeScenario()]);

		expect(results[0]?.stepResults.map((step) => step.outcome)).toEqual(['fail', 'pass']);
		expect(results.map((result) => result.outcome)).toEqual(['partial', 'pass']);
		expect(completed).toHaveBeenCalledTimes(2);
	});

	it('contains unexpected thrown values as step errors', async () => {
		const executor = new ScenarioExecutor(config);
		const internal = executor as unknown as {
			cli: { execute: () => Promise<never> };
		};
		internal.cli.execute = async () => {
			throw 'transport crashed';
		};

		const result = await executor.execute(makeScenario());

		expect(result.stepResults[0]?.error).toMatchObject({
			type: 'unknown',
			message: 'transport crashed',
		});
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// InProcessExecutor
// ═══════════════════════════════════════════════════════════════════════════════

describe('InProcessExecutor', () => {
	it('executes passing scenario', async () => {
		const executor = new InProcessExecutor({
			handler: makePassingHandler(),
		});

		const result = await executor.execute(makeScenario());

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(1);
		expect(result.failedSteps).toBe(0);
		expect(result.skippedSteps).toBe(0);
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.jobName).toBe('test-job');
	});

	it('handles failing command', async () => {
		const executor = new InProcessExecutor({
			handler: makeFailingHandler(),
		});

		const scenario = makeScenario({
			steps: [
				{
					command: 'test-cmd',
					input: {},
					expect: { success: true },
				},
			],
		});

		const result = await executor.execute(scenario);

		expect(result.outcome).toBe('fail');
		expect(result.failedSteps).toBe(1);
	});

	it('handles handler exception as error', async () => {
		const executor = new InProcessExecutor({
			handler: makeThrowingHandler(),
		});

		const result = await executor.execute(makeScenario());

		expect(result.outcome).toBe('fail');
		expect(result.stepResults[0]?.outcome).toBe('error');
		expect(result.stepResults[0]?.error?.message).toContain('Handler exploded');
	});

	it('stopOnFailure skips remaining steps', async () => {
		const handler: CommandHandler = async (command) => {
			if (command === 'fail-cmd') {
				return { success: false, error: { code: 'FAIL', message: 'fail' } };
			}
			return { success: true, data: 'ok' };
		};

		const executor = new InProcessExecutor({
			handler,
			stopOnFailure: true,
		});

		const scenario = makeScenario({
			steps: [
				{ command: 'fail-cmd', input: {}, expect: { success: true } },
				{ command: 'pass-cmd', input: {}, expect: { success: true } },
				{ command: 'pass-cmd', input: {}, expect: { success: true } },
			],
		});

		const result = await executor.execute(scenario);

		expect(result.failedSteps).toBe(1);
		expect(result.skippedSteps).toBe(2);
		expect(result.stepResults[1]?.outcome).toBe('skip');
		expect(result.stepResults[1]?.skippedReason).toBe('Previous step failed');
	});

	it('continueOnFailure does not skip remaining', async () => {
		const handler: CommandHandler = async (command) => {
			if (command === 'fail-cmd') {
				return { success: false, error: { code: 'FAIL', message: 'fail' } };
			}
			return { success: true, data: 'ok' };
		};

		const executor = new InProcessExecutor({
			handler,
			stopOnFailure: true,
		});

		const scenario = makeScenario({
			steps: [
				{
					command: 'fail-cmd',
					input: {},
					expect: { success: true },
					continueOnFailure: true,
				},
				{ command: 'pass-cmd', input: {}, expect: { success: true } },
			],
		});

		const result = await executor.execute(scenario);

		expect(result.failedSteps).toBe(1);
		expect(result.skippedSteps).toBe(0);
		expect(result.passedSteps).toBe(1);
		expect(result.outcome).toBe('partial');
	});

	it('resolves step references', async () => {
		const handler: CommandHandler = async (_command, input) => ({
			success: true,
			data: { id: 'abc-123', ...(input ?? {}) },
		});

		const executor = new InProcessExecutor({ handler });

		const scenario = makeScenario({
			steps: [
				{
					command: 'create-cmd',
					input: { title: 'Test' },
					expect: { success: true },
				},
				{
					command: 'get-cmd',
					input: { id: '${{ steps[0].data.id }}' },
					expect: { success: true },
				},
			],
		});

		const result = await executor.execute(scenario);

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(2);
		// The second step should have received the resolved id
		const secondStep = result.stepResults[1];
		expect(secondStep?.commandResult?.data).toEqual({ id: 'abc-123' });
	});

	it('dry run validates without executing', async () => {
		const handler = vi.fn(makePassingHandler());

		const executor = new InProcessExecutor({
			handler,
			dryRun: true,
		});

		const result = await executor.execute(makeScenario());

		expect(result.outcome).toBe('pass');
		expect(result.passedSteps).toBe(1);
		expect(handler).not.toHaveBeenCalled();
	});

	it('calls callbacks', async () => {
		const onScenarioStart = vi.fn();
		const onStepComplete = vi.fn();
		const onScenarioComplete = vi.fn();

		const executor = new InProcessExecutor({
			handler: makePassingHandler(),
			onScenarioStart,
			onStepComplete,
			onScenarioComplete,
		});

		await executor.execute(makeScenario());

		expect(onScenarioStart).toHaveBeenCalledOnce();
		expect(onStepComplete).toHaveBeenCalledOnce();
		expect(onScenarioComplete).toHaveBeenCalledOnce();
	});

	it('determineOutcome returns correct values', async () => {
		const handler: CommandHandler = async (command) => {
			if (command === 'fail-cmd') {
				return { success: false, error: { code: 'FAIL', message: 'fail' } };
			}
			return { success: true, data: 'ok' };
		};

		// All pass
		const executor1 = new InProcessExecutor({ handler, stopOnFailure: false });
		const allPass = await executor1.execute(
			makeScenario({
				steps: [
					{ command: 'pass-cmd', input: {}, expect: { success: true } },
					{ command: 'pass-cmd', input: {}, expect: { success: true } },
				],
			})
		);
		expect(allPass.outcome).toBe('pass');

		// All fail
		const allFail = await executor1.execute(
			makeScenario({
				steps: [
					{ command: 'fail-cmd', input: {}, expect: { success: true } },
					{ command: 'fail-cmd', input: {}, expect: { success: true } },
				],
			})
		);
		expect(allFail.outcome).toBe('fail');

		// Partial
		const partial = await executor1.execute(
			makeScenario({
				steps: [
					{ command: 'pass-cmd', input: {}, expect: { success: true } },
					{ command: 'fail-cmd', input: {}, expect: { success: true } },
				],
			})
		);
		expect(partial.outcome).toBe('partial');
	});
});

// ═══════════════════════════════════════════════════════════════════════════════
// validateScenario
// ═══════════════════════════════════════════════════════════════════════════════

describe('validateScenario', () => {
	it('valid scenario passes validation', async () => {
		const result = await validateScenario(makeScenario(), { checkFixtures: false });
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it('reports missing name', async () => {
		const result = await validateScenario(makeScenario({ name: '' }), { checkFixtures: false });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Missing required field: name');
	});

	it('reports missing job', async () => {
		const result = await validateScenario(makeScenario({ job: '' }), { checkFixtures: false });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Missing required field: job');
	});

	it('reports empty steps', async () => {
		const result = await validateScenario(makeScenario({ steps: [] }), { checkFixtures: false });
		expect(result.valid).toBe(false);
		expect(result.errors).toContain('Scenario must have at least one step');
	});

	it('reports missing step command', async () => {
		const result = await validateScenario(
			makeScenario({
				steps: [{ command: '', input: {}, expect: { success: true } }],
			}),
			{ checkFixtures: false }
		);
		expect(result.errors.some((e) => e.includes("Missing required field 'command'"))).toBe(true);
	});

	it('warns about missing expect', async () => {
		const result = await validateScenario(
			makeScenario({
				steps: [{ command: 'test-cmd' } as Step],
			}),
			{ checkFixtures: false }
		);
		expect(result.warnings.some((w) => w.includes("Missing 'expect'"))).toBe(true);
	});

	it('reports forward step references', async () => {
		const result = await validateScenario(
			makeScenario({
				steps: [
					{
						command: 'cmd-one',
						input: { ref: '${{ steps[1].data.id }}' },
						expect: { success: true },
					},
					{ command: 'cmd-two', input: {}, expect: { success: true } },
				],
			}),
			{ checkFixtures: false }
		);
		expect(result.errors.some((e) => e.includes('Invalid reference'))).toBe(true);
	});

	it('returns metadata', async () => {
		const result = await validateScenario(makeScenario(), { checkFixtures: false });
		expect(result.metadata.name).toBe('Test Scenario');
		expect(result.metadata.job).toBe('test-job');
		expect(result.metadata.stepCount).toBe(1);
		expect(result.metadata.hasFixture).toBe(false);
		expect(result.metadata.tags).toEqual(['test']);
	});
});
