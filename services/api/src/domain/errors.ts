export class DomainError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export function notFound(resource: string, id: string): DomainError {
  return new DomainError(404, "not_found", `${resource} '${id}' was not found`);
}

export function conflict(code: string, message: string, details?: Record<string, unknown>): DomainError {
  return new DomainError(409, code, message, details);
}
