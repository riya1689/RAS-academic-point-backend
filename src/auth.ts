import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./db.js";
import redis from "./redis.js";
import { sendOTPEmail } from "./utils/mailer.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    },
  },
  user: {
    additionalFields: {
      role: {
        type: "string",
        required: true,
        defaultValue: "UNASSIGNED"
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

              await sendOTPEmail(user.email, otp);
            }
          }
        },
      },
    },
  },
});