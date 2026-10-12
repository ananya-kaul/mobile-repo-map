/**
 * A user-facing failure from the `ask` command: the message is already written for a
 * person at a terminal, so callers can print `error.message` without a stack trace.
 */
export class AiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'AiError';
  }
}
