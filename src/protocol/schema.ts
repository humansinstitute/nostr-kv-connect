import { z } from 'zod';

// Base request/response schemas
export const baseRequestSchema = z.object({
  method: z.string(),
  params: z.record(z.any()),
  id: z.string()
});

export const baseResponseSchema = z.object({
  result: z.any().nullable(),
  error: z.object({
    code: z.string(),
    message: z.string()
  }).nullable(),
  id: z.string()
});

// Method-specific parameter schemas
export const getInfoParamsSchema = z.object({});

export const getParamsSchema = z.object({
  key: z.string()
});

export const setParamsSchema = z.object({
  key: z.string(),
  value: z.string(), // base64 encoded
  ttl: z.number().positive().optional()
});

export const delParamsSchema = z.object({
  key: z.string()
});

export const existsParamsSchema = z.object({
  key: z.string()
});

export const mgetParamsSchema = z.object({
  keys: z.array(z.string()).min(1)
});

export const expireParamsSchema = z.object({
  key: z.string(),
  ttl: z.number().positive()
});

export const ttlParamsSchema = z.object({
  key: z.string()
});

// Result schemas
export const getInfoResultSchema = z.object({
  methods: z.array(z.string()),
  ns: z.string(),
  limits: z.object({
    mps: z.number(),
    bps: z.number(),
    maxkey: z.number(),
    maxval: z.number(),
    mget_max: z.number()
  }),
  encryption: z.object({
    nip44: z.boolean(),
    nip04: z.boolean()
  })
});

export const getResultSchema = z.object({
  value: z.string().nullable() // base64 encoded or null if not found
});

export const setResultSchema = z.object({
  ok: z.boolean()
});

export const delResultSchema = z.object({
  deleted: z.number()
});

export const existsResultSchema = z.object({
  exists: z.boolean()
});

export const mgetResultSchema = z.object({
  values: z.array(z.string().nullable()) // array of base64 values or nulls
});

export const expireResultSchema = z.object({
  ok: z.boolean()
});

export const ttlResultSchema = z.object({
  ttl: z.number() // -2 if key doesn't exist, -1 if no TTL
});

// Method registry
export const methodSchemas = {
  get_info: {
    params: getInfoParamsSchema,
    result: getInfoResultSchema
  },
  get: {
    params: getParamsSchema,
    result: getResultSchema
  },
  set: {
    params: setParamsSchema,
    result: setResultSchema
  },
  del: {
    params: delParamsSchema,
    result: delResultSchema
  },
  exists: {
    params: existsParamsSchema,
    result: existsResultSchema
  },
  mget: {
    params: mgetParamsSchema,
    result: mgetResultSchema
  },
  expire: {
    params: expireParamsSchema,
    result: expireResultSchema
  },
  ttl: {
    params: ttlParamsSchema,
    result: ttlResultSchema
  }
};