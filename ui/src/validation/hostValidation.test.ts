import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createDebouncedValidator } from './hostValidation.ts';
import { type Workflow } from '../types/workflow.ts';
import { type ValidationProblem } from '../types/validation.ts';

const wf = (id: string): Workflow => ({ id, name: id, nodes: [], edges: [] });
const problem = (code: string): ValidationProblem => ({ severity: 'warning', code, message: code });

describe('createDebouncedValidator', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('applies a synchronous validator result after the delay', async () => {
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: () => [problem('A')] });
    v.run(wf('w'), onResult);
    expect(onResult).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith([problem('A')]);
  });

  it('applies an async validator result', async () => {
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: async () => [problem('B')] });
    v.run(wf('w'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledWith([problem('B')]);
  });

  it('coalesces rapid runs into a single validator invocation', async () => {
    const validate = vi.fn(() => [problem('C')]);
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate });
    v.run(wf('1'), onResult);
    v.run(wf('2'), onResult);
    v.run(wf('3'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(validate).toHaveBeenCalledTimes(1);
    expect(validate).toHaveBeenCalledWith(wf('3'));
    expect(onResult).toHaveBeenCalledTimes(1);
  });

  it('drops stale (out-of-order) async results', async () => {
    const resolvers: ((p: ValidationProblem[]) => void)[] = [];
    const validate = vi.fn(() => new Promise<ValidationProblem[]>((res) => resolvers.push(res)));
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate });

    v.run(wf('a'), onResult);
    await vi.advanceTimersByTimeAsync(300); // fires -> token 1, promise[0] pending
    v.run(wf('b'), onResult);
    await vi.advanceTimersByTimeAsync(300); // fires -> token 2, promise[1] pending

    resolvers[0]([problem('STALE')]);       // token 1 result — must be dropped
    resolvers[1]([problem('FRESH')]);       // token 2 result — must be applied
    await Promise.resolve();

    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith([problem('FRESH')]);
  });

  it('yields [] and warns when the validator throws', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: () => { throw new Error('boom'); } });
    v.run(wf('w'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledWith([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('yields [] and warns when the async validator rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate: async () => { throw new Error('boom'); } });
    v.run(wf('w'), onResult);
    await vi.advanceTimersByTimeAsync(300);
    expect(onResult).toHaveBeenCalledWith([]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('cancel() prevents a pending invocation from applying', async () => {
    const validate = vi.fn(() => [problem('X')]);
    const onResult = vi.fn();
    const v = createDebouncedValidator({ validate });
    v.run(wf('w'), onResult);
    v.cancel();
    await vi.advanceTimersByTimeAsync(300);
    expect(validate).not.toHaveBeenCalled();
    expect(onResult).not.toHaveBeenCalled();
  });
});
