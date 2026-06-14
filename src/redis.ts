import { Redis } from "ioredis";

const redisUrl = process.env.REDIS_URL;

const redis = redisUrl 
  ? new Redis(redisUrl)
  : new Redis({
      host: process.env.REDIS_HOST || "localhost",
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
    });

redis.on("connect", () => {
  console.log("🟢 Redis Connected Successfully");
});

redis.on("error", (err) => {
  console.error("🔴 Redis Connection Error:", err);
});

export default redis;