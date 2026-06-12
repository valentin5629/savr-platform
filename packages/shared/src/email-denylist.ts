import disposableDomains from 'disposable-email-domains/index.json' assert { type: 'json' };

const DISPOSABLE_SET: ReadonlySet<string> = new Set(
  disposableDomains as string[],
);

export function isDisposableEmail(domain: string): boolean {
  return DISPOSABLE_SET.has(domain.toLowerCase());
}
