export class AppError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export const isAppError = (value: unknown): value is AppError => {
  return value instanceof AppError;
};
