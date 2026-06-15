import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db.js";
import redis from "../redis.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { broadcastQueueUpdate, broadcastStudentCalled } from "../socket.js";

const router: Router = Router();

router.post(
  "/",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { date, time, meetLink, startTime, endTime } = req.body;

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user.id },
      });

      if (!teacher) {
        return res.status(404).json({ message: "Teacher profile not found" });
      }

      const parsedDate = new Date(date);
      const parsedStart = startTime ? new Date(startTime) : new Date(parsedDate);
      const parsedEnd = endTime ? new Date(endTime) : new Date(parsedStart.getTime() + 2 * 60 * 60 * 1000); // default 2 hours

      const session = await prisma.supportSession.create({
        data: {
          teacherId: teacher.id,
          date: parsedDate,
          time,
          meetLink: meetLink || null,
          startTime: parsedStart,
          endTime: parsedEnd,
        },
      });

      await redis.del(`support:session:${session.id}:counter`);
      await redis.del(`support:session:${session.id}:queue`);

      return res.status(201).json({ message: "Support session created successfully", session });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/active",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const now = new Date();

      const sessions = await prisma.supportSession.findMany({
        where: {
          endTime: {
            gt: now, // End time is in the future
          },
        },
        include: {
          teacher: {
            include: { user: true },
          },
        },
        orderBy: {
          startTime: "asc",
        },
      });

      return res.status(200).json({ sessions });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

const getActiveQueue = async (sessionId: string) => {
  const studentIds = await redis.lrange(`support:session:${sessionId}:queue`, 0, -1);
  const queue = [];
  for (const studentId of studentIds) {
    const ticket = await redis.hgetall(`support:session:${sessionId}:ticket:${studentId}`);
    if (ticket && Object.keys(ticket).length > 0) {
      queue.push({
        studentId: ticket.studentId,
        name: ticket.name,
        roll: ticket.roll,
        problemDesc: ticket.problemDesc,
        serialNo: parseInt(ticket.serialNo || "0", 10),
        status: ticket.status,
      });
    }
  }
  return queue;
};

router.post(
  "/:sessionId/ticket",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const sessionId = String(req.params.sessionId);
      const { problemDesc } = req.body;

      if (!problemDesc) {
        return res.status(400).json({ message: "Problem description is required" });
      }

      if (!sessionId) {
        return res.status(400).json({ message: "Session ID is required" });
      }

      const student = await prisma.student.findUnique({
        where: { userId: req.user.id },
        include: { user: true },
      });

      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      const existingTicket = await redis.hgetall(`support:session:${sessionId}:ticket:${student.id}`);
      if (existingTicket && Object.keys(existingTicket).length > 0) {
        return res.status(400).json({
          message: "You have already submitted a ticket for this session.",
          serialNo: parseInt(existingTicket.serialNo || "0", 10),
        });
      }

      const serialNo = await redis.incr(`support:session:${sessionId}:counter`);

      const ticket = {
        studentId: student.id,
        name: student.user.name,
        roll: student.roll,
        problemDesc,
        serialNo: serialNo.toString(),
        status: "PENDING",
      };

      await redis.hset(`support:session:${sessionId}:ticket:${student.id}`, ticket);
      await redis.rpush(`support:session:${sessionId}:queue`, student.id);

      const queue = await getActiveQueue(sessionId);
      broadcastQueueUpdate(sessionId, queue);

      return res.status(201).json({
        message: "Ticket submitted successfully",
        serialNo,
        queue,
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/:sessionId/queue",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const sessionId = String(req.params.sessionId);
      if (!sessionId) {
        return res.status(400).json({ message: "Session ID is required" });
      }

      const queue = await getActiveQueue(sessionId);
      return res.status(200).json({ queue });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.patch(
  "/:sessionId/tickets/:studentId",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const sessionId = String(req.params.sessionId);
      const studentId = String(req.params.studentId);
      const { status } = req.body;

      if (!sessionId || !studentId) {
        return res.status(400).json({ message: "Session ID and Student ID are required" });
      }

      const ticketKey = `support:session:${sessionId}:ticket:${studentId}`;
      const ticket = await redis.hgetall(ticketKey);

      if (!ticket || Object.keys(ticket).length === 0) {
        return res.status(404).json({ message: "Ticket not found in queue" });
      }

      if (status === "ACTIVE") {
        await redis.hset(ticketKey, "status", "ACTIVE");
        const updatedTicket = { ...ticket, status: "ACTIVE" };

        const queue = await getActiveQueue(sessionId);
        broadcastQueueUpdate(sessionId, queue);
        broadcastStudentCalled(sessionId, updatedTicket);

        return res.status(200).json({ message: "Student called successfully", queue });
      } else if (status === "RESOLVED") {
        await redis.lrem(`support:session:${sessionId}:queue`, 0, studentId);
        await redis.del(ticketKey);

        const queue = await getActiveQueue(sessionId);
        broadcastQueueUpdate(sessionId, queue);

        return res.status(200).json({ message: "Ticket resolved successfully", queue });
      }

      return res.status(400).json({ message: "Invalid status update" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
