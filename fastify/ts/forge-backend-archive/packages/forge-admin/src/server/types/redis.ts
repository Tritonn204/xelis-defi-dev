import { ensureRedis } from "@forge-backend/shared/adapters/redis";

export type Redisish = Awaited<ReturnType<typeof ensureRedis>>;