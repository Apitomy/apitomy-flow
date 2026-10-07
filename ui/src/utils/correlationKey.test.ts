import { describe, expect, it } from 'vitest';
import { withCorrelationKeyField } from './correlationKey.ts';

describe('withCorrelationKeyField', () => {
  it('adds a correlation key when a field is set', () => {
    expect(withCorrelationKeyField({ eventType: 'x' }, 'subscriptionKey', 'context.id')).toEqual({
      eventType: 'x',
      correlationKey: { subscriptionKey: 'context.id' },
    });
  });

  it('updates one field and preserves the other', () => {
    const config = { correlationKey: { subscriptionKey: 'context.id', eventKey: 'event.id' } };
    expect(withCorrelationKeyField(config, 'eventKey', 'event.data.id').correlationKey).toEqual({
      subscriptionKey: 'context.id', eventKey: 'event.data.id',
    });
  });

  it('removes the key when both fields become empty', () => {
    const config = { eventType: 'x', correlationKey: { subscriptionKey: 'context.id', eventKey: '' } };
    expect(withCorrelationKeyField(config, 'subscriptionKey', '')).toEqual({ eventType: 'x' });
  });
});
