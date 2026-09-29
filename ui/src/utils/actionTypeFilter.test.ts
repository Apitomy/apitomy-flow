import { describe, it, expect } from 'vitest';
import { ACTION_TYPE_FILTER_THRESHOLD, filterActionTypeOptions } from './actionTypeFilter.ts';
import { type ActionTypeDescriptor } from '../types/spi.ts';

function types(count: number): ActionTypeDescriptor[] {
    return Array.from({ length: count }, (_, i) => ({ value: `type-${i}`, label: `Type ${i}` }));
}

describe('filterActionTypeOptions', () => {
    it('does not filter when the list has exactly the threshold count', () => {
        const actionTypes = types(ACTION_TYPE_FILTER_THRESHOLD);
        const result = filterActionTypeOptions(actionTypes, 'Type 1');
        expect(result.filterEnabled).toBe(false);
        expect(result.options).toEqual(actionTypes);
    });

    it('filters when the list exceeds the threshold count', () => {
        const actionTypes = types(ACTION_TYPE_FILTER_THRESHOLD + 1);
        const result = filterActionTypeOptions(actionTypes, 'Type 1');
        expect(result.filterEnabled).toBe(true);
        expect(result.options.map(at => at.value)).toEqual(['type-1']);
    });

    it('matches against label or value case-insensitively when filtering is enabled', () => {
        const actionTypes = [
            ...types(ACTION_TYPE_FILTER_THRESHOLD),
            { value: 'send-email', label: 'Send Email' },
        ];
        expect(filterActionTypeOptions(actionTypes, 'EMAIL').options).toEqual([
            { value: 'send-email', label: 'Send Email' },
        ]);
        expect(filterActionTypeOptions(actionTypes, 'send-').options).toEqual([
            { value: 'send-email', label: 'Send Email' },
        ]);
    });

    it('returns the full list when filtering is enabled but the filter text is empty', () => {
        const actionTypes = types(ACTION_TYPE_FILTER_THRESHOLD + 1);
        const result = filterActionTypeOptions(actionTypes, '');
        expect(result.filterEnabled).toBe(true);
        expect(result.options).toEqual(actionTypes);
    });

    it('returns an empty list when filtering is enabled and nothing matches', () => {
        const actionTypes = types(ACTION_TYPE_FILTER_THRESHOLD + 1);
        expect(filterActionTypeOptions(actionTypes, 'no-such-type').options).toEqual([]);
    });

    it('ignores the filter text below the threshold even when nothing would match', () => {
        const actionTypes = types(ACTION_TYPE_FILTER_THRESHOLD);
        const result = filterActionTypeOptions(actionTypes, 'no-such-type');
        expect(result.filterEnabled).toBe(false);
        expect(result.options).toEqual(actionTypes);
    });
});
