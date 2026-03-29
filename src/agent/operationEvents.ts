import type { EventStreamLike } from '../types';

interface OperationEventDetails {
  priority?: number;
  tags?: string[];
  text: string;
}

interface OperationDescriptor<TArgs extends unknown[], TResult> {
  action: string;
  failure(args: TArgs, error: unknown): OperationEventDetails;
  start(args: TArgs): OperationEventDetails;
  success(args: TArgs, result: TResult): OperationEventDetails;
}

function serializeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function pushOperationEvent(
  events: EventStreamLike,
  type: 'action:start' | 'action:success' | 'action:failure',
  action: string,
  details: OperationEventDetails,
  extraPayload: Record<string, unknown> = {},
): void {
  events.push(type, {
    action,
    ...extraPayload,
    priority: details.priority ?? null,
    tags: details.tags ?? [],
    text: details.text,
  });
}

export function instrumentAsyncOperation<TArgs extends unknown[], TResult>(
  events: EventStreamLike,
  descriptor: OperationDescriptor<TArgs, TResult>,
  operation: (...args: TArgs) => Promise<TResult>,
): (...args: TArgs) => Promise<TResult> {
  return async (...args: TArgs): Promise<TResult> => {
    pushOperationEvent(events, 'action:start', descriptor.action, descriptor.start(args));

    try {
      const result = await operation(...args);

      pushOperationEvent(
        events,
        'action:success',
        descriptor.action,
        descriptor.success(args, result),
      );

      return result;
    } catch (error: unknown) {
      pushOperationEvent(
        events,
        'action:failure',
        descriptor.action,
        descriptor.failure(args, error),
        {
          error: serializeError(error),
        },
      );

      throw error;
    }
  };
}
