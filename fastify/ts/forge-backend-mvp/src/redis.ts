// TODO: flesh this out for load-balanced webserver support

// import Redis from 'ioredis';
// const redis = new Redis(process.env.REDIS_URL);

// async function rget<T>(k: string): Promise<T|undefined> {
//   const s = await redis.get(k);
//   return s ? JSON.parse(s) as T : undefined;
// }
// async function rset(k: string, v: any, ttlMs = 15000) {
//   const s = JSON.stringify(v);
//   await redis.set(k, s, 'PX', ttlMs);
// }
