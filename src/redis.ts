import { Redis } from "ioredis";

const redis = new Redis({
  host: process.env.REDIS_HOST || "localhost",
  port: Number(process.env.REDIS_PORT) || 6379,
});

redis.on("connect", () => {
  console.log("🟢 Redis Connected Successfully");
});

redis.on("error", (err) => {
  console.error("🔴 Redis Connection Error:", err);
});

export default redis;