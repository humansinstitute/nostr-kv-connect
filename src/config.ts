import dotenv from 'dotenv';
import { Config } from './types.js';

dotenv.config();

export function loadConfig(): Config {
  const config: Config = {
    redis: {
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      namespace: process.env.REDIS_NAMESPACE || 'default:'
    },
    nostr: {
      relays: (process.env.RELAYS || 'wss://relay.damus.io,wss://relay.nostr.band,wss://nostr.mineracks.com').split(','),
      serverNsec: process.env.SERVER_NSEC || '',
      encryptionPref: (process.env.ENCRYPTION_PREF || 'nip44') as 'nip44' | 'nip04'
    },
    limits: {
      mps: parseInt(process.env.LIMITS_MPS || '60'),
      bps: parseInt(process.env.LIMITS_BPS || '1048576'),
      maxKey: parseInt(process.env.LIMITS_MAXKEY || '256'),
      maxVal: parseInt(process.env.LIMITS_MAXVAL || '65536'),
      mgetMax: parseInt(process.env.LIMITS_MGET_MAX || '16')
    },
    logLevel: process.env.LOG_LEVEL || 'info'
  };

  // Validate required config
  if (!config.nostr.serverNsec) {
    throw new Error('SERVER_NSEC is required');
  }

  if (!config.redis.namespace.endsWith(':')) {
    config.redis.namespace += ':';
  }

  return config;
}