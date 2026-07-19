type D1Value = string | number | bigint | Uint8Array | null;

type D1Response = {
  success: boolean;
  error?: string;
  meta: { changes?: number; [key: string]: unknown };
};

type D1Result<T = Record<string, unknown>> = D1Response & {
  results: T[];
};

interface D1PreparedStatement {
  bind(...values: D1Value[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(columnName?: string): Promise<T | null>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  raw<T extends unknown[] = unknown[]>(): Promise<T[]>;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T extends readonly D1PreparedStatement[]>(statements: T): Promise<D1Result[]>;
  exec(query: string): Promise<D1Response>;
  dump(): Promise<ArrayBuffer>;
}

interface Fetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

declare module "cloudflare:workers" {
  export const env: {
    DB?: D1Database;
    [binding: string]: unknown;
  };
}
