import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db.js";
import redis from "./redis.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  session: {
    jwt: true,
  },
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "STUDENT"
      }
    }
  },
  databaseHooks: {
    account: {
      create: {
        after: async (account) => {
          if (account.providerId === "google") {
            await prisma.user.update({
              where: { id: account.userId },
              data: { emailVerified: false },
            });

            const user = await prisma.user.findUnique({
              where: { id: account.userId },
            });

            if (user && user.email) {
              const otp = Math.floor(100000 + Math.random() * 900000).toString();

              await redis.set(`otp:${user.email}`, otp, "EX", 300);

              console.log(`[Google Auth] OTP sent to ${user.email}: ${otp}`);
            }
          }
        },
      },
    },
  },
});