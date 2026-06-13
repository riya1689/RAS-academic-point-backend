import express  from 'express';
import type { Application, Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { prisma } from './db.js';

dotenv.config();

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(express.json());
app.use(cors());
app.all("/api/auth/*wildcard", toNodeHandler(auth));

let dbStatus = "Not Connected";
let authStatus = "Not Connected";

async function startServer() {
  try {
    await prisma.$connect();
    dbStatus = "Connected";
    console.log(" Database Connected");

    authStatus = "Connected";
    console.log(" Better Auth Connected");
  } catch (error) {
    console.log(" Database Connection Failed");
    console.error(error);
  }
}

  app.get("/", (req: Request, res: Response) => {
    res.json({
      app: "RAS Academic Point API",
      server: "Running",
      database: dbStatus,
      betterAuth: authStatus,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

startServer();
