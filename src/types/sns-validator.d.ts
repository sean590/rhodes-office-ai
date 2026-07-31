declare module "sns-validator" {
  export default class MessageValidator {
    constructor(encoding?: string, options?: unknown);
    validate(
      message: unknown,
      callback: (err: Error | null, message?: unknown) => void,
    ): void;
  }
}
