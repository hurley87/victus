import { z } from 'zod';

// Define schemas based on action type
const baseSchema = z.object({
  text: z.string(),
  action: z.enum(['CHAT', 'CREATE', 'TRADE']),
  reply: z.string(),
});

const chatSchema = baseSchema.extend({
  action: z.literal('CHAT'),
});

const createSchema = baseSchema.extend({
  action: z.literal('CREATE'),
  name: z.string(),
  symbol: z.string(),
  description: z.string(),
});

const tradeSchema = baseSchema.extend({
  action: z.literal('TRADE'),
  tokenAddress: z.string(),
  size: z.string(),
  direction: z.enum(['BUY', 'SELL']),
});

// Combined schema with discriminated union
export const commodusResponseSchema = z.discriminatedUnion('action', [
  chatSchema,
  createSchema,
  tradeSchema,
]);

export type CommodusResponse = z.infer<typeof commodusResponseSchema>;
