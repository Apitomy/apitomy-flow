import { type ReceiveEventConfig } from '../types/workflow.ts';

/** A correlation-key expression field editable in the Properties panel. */
export type CorrelationKeyField = 'subscriptionKey' | 'eventKey';

/**
 * Returns a copy of a receive-event config with one correlation-key expression updated. When both
 * expressions end up empty (and no host extensions remain), `correlationKey` is removed entirely so a
 * node without a key keeps its legacy shape.
 *
 * @param config the current receive-event config
 * @param field the expression to update
 * @param value the new expression text
 * @return the updated config
 */
export function withCorrelationKeyField(config: ReceiveEventConfig, field: CorrelationKeyField,
  value: string): ReceiveEventConfig {
  const current = config.correlationKey && typeof config.correlationKey === 'object' ? config.correlationKey : {};
  const next = { ...current, [field]: value };
  const rest = { ...config };
  delete rest.correlationKey;
  const empty = Object.entries(next).every(([key, entry]) =>
    (key === 'subscriptionKey' || key === 'eventKey') && (entry == null || entry === ''));
  return empty ? rest : { ...rest, correlationKey: next };
}
