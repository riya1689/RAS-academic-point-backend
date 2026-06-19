import dotenv from 'dotenv';
dotenv.config();

import express  from 'express';
import type { Application, Request, Response } from 'express';
import cors from 'cors';
import { createServer } from "http";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { prisma } from './db.js';
import { initSocket } from "./socket.js";
import authRoutes from './routes/auth.routes.js';
import classroomRoutes from './routes/classroom.routes.js';
import supportRoutes from './routes/support.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import resultRoutes from './routes/result.routes.js';
import bookingRoutes from './routes/booking.routes.js';
import adminRoutes from './routes/admin.routes.js';

const app: Application = express();
const PORT = process.env.PORT || 5000;

app.use(express.json({
  verify: (req: any, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(cors({
  origin: ["http://localhost:3000", process.env.FRONTEND_URL || "https://ras-ems-frontend.vercel.app"],
  credentials: true
}));

app.use("/api/auth", authRoutes);
app.use("/api/classrooms", classroomRoutes);
app.use("/api/support-sessions", supportRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api", resultRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);

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

const httpServer = createServer(app);
initSocket(httpServer);

if (!process.env.VERCEL) {
  httpServer.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
}

startServer();

export default app;