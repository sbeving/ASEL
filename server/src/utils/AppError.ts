export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg: string, details?: unknown) =>
  new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Not permitted') =>
  new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') =>
  new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg: string) =>
  new AppError(409, 'CONFLICT', msg);
