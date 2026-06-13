import { Server as SocketServer } from "socket.io";
import type { Server as HTTPServer } from "http";

let io: SocketServer | null = null;

export const initSocket = (httpServer: HTTPServer) => {
  io = new SocketServer(httpServer, {
    cors: {
      origin: "*",
      methods: ["GET", "POST", "PATCH"],
    },
  });

  io.on("connection", (socket) => {
    console.log(`🔌 [Socket.io] Client connected: ${socket.id}`);

    socket.on("join-session", (sessionId: string) => {
      socket.join(sessionId);
      console.log(`📥 [Socket.io] Socket ${socket.id} joined support session: ${sessionId}`);
    });

    socket.on("leave-session", (sessionId: string) => {
      socket.leave(sessionId);
      console.log(`📤 [Socket.io] Socket ${socket.id} left support session: ${sessionId}`);
    });

    socket.on("disconnect", () => {
      console.log(`🔌 [Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io is not initialized yet.");
  }
  return io;
};

export const broadcastQueueUpdate = (sessionId: string, queue: any[]) => {
  if (io) {
    io.to(sessionId).emit("queue-updated", queue);
    console.log(`📢 [Socket.io] Broadcasted queue update for session: ${sessionId}`);
  }
};

export const broadcastStudentCalled = (sessionId: string, ticket: any) => {
  if (io) {
    io.to(sessionId).emit("student-called", ticket);
    console.log(`📢 [Socket.io] Broadcasted student call in session: ${sessionId}`);
  }
};
