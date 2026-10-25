export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (message: string, details?: unknown) => new ApiError(400, 'VALIDATION_FAILED', message, details);
export const unauthorized = (message = 'Please sign in to continue.') => new ApiError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission for this action.', code = 'FORBIDDEN') => new ApiError(403, code, message);
export const notFound = (what = 'Resource') => new ApiError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, code = 'CONFLICT', details?: unknown) => new ApiError(409, code, message, details);
