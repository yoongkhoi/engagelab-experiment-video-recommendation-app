export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export type ProviderErrorKind =
  | 'configuration'
  | 'authentication'
  | 'validation'
  | 'network'
  | 'timeout'
  | 'provider';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly kind: ProviderErrorKind,
    readonly status?: number,
    readonly providerCode?: number,
    readonly providerBody?: unknown,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}
