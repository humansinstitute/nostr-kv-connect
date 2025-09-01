export interface Config {
  redis: {
    url: string;
    namespace: string;
  };
  nostr: {
    relays: string[];
    serverNsec: string;
    encryptionPref: 'nip44' | 'nip04';
  };
  limits: {
    mps: number; // max requests per minute
    bps: number; // max bytes per minute
    maxKey: number; // max key length
    maxVal: number; // max value size
    mgetMax: number; // max items in mget
  };
  logLevel: string;
}

export interface KVRequest {
  method: string;
  params: Record<string, any>;
  id: string;
}

export interface KVResponse {
  result: any | null;
  error: { code: string; message: string } | null;
  id: string;
}

export interface ClientConnection {
  pubkey: string;
  namespace: string;
  allowedMethods: string[];
  limits: {
    mps: number;
    bps: number;
    maxKey: number;
    maxVal: number;
    mgetMax: number;
  };
  rateLimitState?: {
    requests: number[];
    bytes: { timestamp: number; bytes: number; }[];
  };
}

export const ErrorCodes = {
  UNAUTHORIZED: 'UNAUTHORIZED',
  RESTRICTED: 'RESTRICTED',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  INVALID_KEY: 'INVALID_KEY',
  INVALID_VALUE: 'INVALID_VALUE',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  INTERNAL: 'INTERNAL'
} as const;