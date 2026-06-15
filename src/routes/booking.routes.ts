import { Router } from "express";
import type { Response, RequestHandler } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import { google } from "googleapis";
import { sendBookingConfirmation, sendWaitlistUpgrade } from "../utils/mailer.js";

const router: Router = Router();

// --- GOOGLE OAUTH FOR CALENDAR ---

// It's a getter to instantiate the client dynamically if env vars load later
const getOAuth2Client = () => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALENDAR_REDIRECT_URI || `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'}/bookings/auth/google/callback`
  );
};

router.get(
  "/auth/google",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const teacher = await prisma.teacher.findUnique({
        where: { userId: authReq.user.id },
      });
      if (!teacher) {
        res.status(404).json({ message: "Teacher not found" });
        return;
      }

      const oauth2Client = getOAuth2Client();
      const url = oauth2Client.generateAuthUrl({
        access_type: "offline",
        prompt: "consent", // Force refresh token generation
        scope: ["https://www.googleapis.com/auth/calendar.events"],
        state: teacher.id, // Pass teacherId in state to identify in callback
      });

      res.status(200).json({ url });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

router.get(
  "/auth/google/callback",
  async (req: any, res: Response): Promise<void> => {
    try {
      const code = req.query.code as string;
      const teacherId = req.query.state as string; // Extracted from state

      if (!code || !teacherId) {
        res.status(400).send("Missing code or state");
        return;
      }

      const oauth2Client = getOAuth2Client();
      const { tokens } = await oauth2Client.getToken(code);

      await prisma.teacherGoogleAuth.upsert({
        where: { teacherId },
        create: {
          teacherId,
          accessToken: tokens.access_token!,
          refreshToken: tokens.refresh_token ?? null,
          expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
        update: {
          accessToken: tokens.access_token!,
          ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
          expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        },
      });

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      res.redirect(`${frontendUrl}/dashboard/teacher?calendar_linked=true`);
      return;
    } catch (error) {
      console.error("Google Auth Callback Error:", error);
      res.status(500).send("Failed to link Google Calendar");
      return;
    }
  }
);

// --- SLOTS MANAGEMENT ---

router.post(
  "/slots",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { slots } = authReq.body; // Array of { slotStart, slotEnd }
      
      const teacher = await prisma.teacher.findUnique({
        where: { userId: authReq.user.id },
      });
      if (!teacher) {
        res.status(404).json({ message: "Teacher not found" });
        return;
      }

      const data = slots.map((s: any) => ({
        teacherId: teacher.id,
        slotStart: new Date(s.slotStart),
        slotEnd: new Date(s.slotEnd),
      }));

      await prisma.availabilitySlot.createMany({
        data,
      });

      res.status(201).json({ message: "Slots created successfully" });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

router.get(
  "/slots/my",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const teacher = await prisma.teacher.findUnique({
        where: { userId: authReq.user.id },
      });
      if (!teacher) {
        res.status(404).json({ message: "Teacher not found" });
        return;
      }

      const slots = await prisma.availabilitySlot.findMany({
        where: { teacherId: teacher.id },
        orderBy: { slotStart: "asc" },
        include: {
          booking: {
            include: { student: { include: { user: true } } }
          },
          _count: {
            select: { waitlist: true }
          }
        }
      });

      res.status(200).json({ slots });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

router.get(
  "/slots",
  requireAuth,
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const date = authReq.query.date as string;
      const teacherId = authReq.query.teacherId as string;

      let where: any = {};
      if (teacherId) where.teacherId = teacherId;
      
      if (date) {
        const startDate = new Date(date);
        startDate.setUTCHours(0,0,0,0);
        const endDate = new Date(date);
        endDate.setUTCHours(23,59,59,999);
        
        where.slotStart = {
          gte: startDate,
          lte: endDate,
        };
      } else {
        // Default to future slots only
        where.slotStart = { gte: new Date() };
      }

      const slots = await prisma.availabilitySlot.findMany({
        where,
        include: {
          teacher: { include: { user: true } },
          _count: { select: { waitlist: true } }
        },
        orderBy: { slotStart: "asc" },
      });

      res.status(200).json({ slots });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

// --- BOOKING & WAITLIST ---

router.get(
  "/my",
  requireAuth,
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      if (authReq.user.role === "STUDENT") {
        const student = await prisma.student.findUnique({ where: { userId: authReq.user.id }});
        if (!student) {
          res.status(404).json({ message: "Student not found" });
          return;
        }

        const bookings = await prisma.oneToOneBooking.findMany({
          where: { studentId: student.id },
          include: {
            slot: { include: { teacher: { include: { user: true } } } }
          },
          orderBy: { slot: { slotStart: "asc" } }
        });

        const waitlists = await prisma.waitlistEntry.findMany({
          where: { studentId: student.id },
          include: {
            slot: { include: { teacher: { include: { user: true } } } }
          },
          orderBy: { joinedAt: "asc" }
        });

        res.status(200).json({ bookings, waitlists });
        return;
      } else if (authReq.user.role === "TEACHER") {
        const teacher = await prisma.teacher.findUnique({ where: { userId: authReq.user.id }});
        if (!teacher) {
          res.status(404).json({ message: "Teacher not found" });
          return;
        }

        const bookings = await prisma.oneToOneBooking.findMany({
          where: { slot: { teacherId: teacher.id } },
          include: {
            student: { include: { user: true } },
            slot: true
          },
          orderBy: { slot: { slotStart: "asc" } }
        });
        res.status(200).json({ bookings });
        return;
      }
      res.status(403).json({ message: "Forbidden" });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

router.post(
  "/",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { slotId, description } = authReq.body;

      const student = await prisma.student.findUnique({
        where: { userId: authReq.user.id },
        include: { user: true }
      });
      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }

      const slot = await prisma.availabilitySlot.findUnique({
        where: { id: slotId },
        include: { teacher: { include: { user: true, googleAuth: true } } }
      });

      if (!slot) {
        res.status(404).json({ message: "Slot not found" });
        return;
      }
      if (slot.isBooked) {
        res.status(400).json({ message: "Oops, someone just grabbed this slot! Would you like to join the waitlist?" });
        return;
      }

      // Atomicity: The database will reject this if slotId is already in OneToOneBooking thanks to @unique constraint
      let booking;
      try {
        booking = await prisma.oneToOneBooking.create({
          data: {
            studentId: student.id,
            slotId: slot.id,
            description,
          }
        });
        
        await prisma.availabilitySlot.update({
          where: { id: slot.id },
          data: { isBooked: true }
        });
      } catch (err: any) {
        if (err.code === "P2002") { // Prisma Unique Constraint Violation
           res.status(400).json({ message: "Oops, someone just grabbed this slot! Would you like to join the waitlist?" });
           return;
        }
        throw err;
      }

      // Check Google Auth & Create Meet Link
      let meetLink = "Link will be provided by teacher";
      if (slot.teacher.googleAuth) {
        try {
          const oauth2Client = getOAuth2Client();
          oauth2Client.setCredentials({
            access_token: slot.teacher.googleAuth.accessToken,
            refresh_token: slot.teacher.googleAuth.refreshToken,
          });

          const calendar = google.calendar({ version: "v3", auth: oauth2Client });
          const event = await calendar.events.insert({
            calendarId: "primary",
            conferenceDataVersion: 1,
            requestBody: {
              summary: `1-to-1 Session with ${student.user.name}`,
              description: description || "Support session",
              start: { dateTime: slot.slotStart.toISOString() },
              end: { dateTime: slot.slotEnd.toISOString() },
              attendees: [{ email: student.user.email }],
              conferenceData: {
                createRequest: {
                  requestId: booking.id, // Random unique string
                  conferenceSolutionKey: { type: "hangoutsMeet" }
                }
              }
            }
          });

          if (event.data.hangoutLink) {
            meetLink = event.data.hangoutLink;
            await prisma.oneToOneBooking.update({
              where: { id: booking.id },
              data: { meetLink }
            });
          }
        } catch (calendarErr) {
          console.error("Failed to create Google Calendar Event:", calendarErr);
          // Don't throw, we still secured the booking.
        }
      }

      // Send Email
      await sendBookingConfirmation(
        student.user.email,
        slot.slotStart.toLocaleDateString(),
        slot.slotStart.toLocaleTimeString(),
        slot.teacher.user.name,
        meetLink
      );

      res.status(201).json({ message: "Booking confirmed!", booking });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

router.post(
  "/waitlist",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const { slotId } = authReq.body;
      const student = await prisma.student.findUnique({ where: { userId: authReq.user.id } });
      if (!student) {
        res.status(404).json({ message: "Student not found" });
        return;
      }

      const existingWaitlist = await prisma.waitlistEntry.findFirst({
        where: { studentId: student.id, slotId }
      });
      if (existingWaitlist) {
         res.status(400).json({ message: "You are already on the waitlist for this slot." });
         return;
      }

      await prisma.waitlistEntry.create({
        data: {
          studentId: student.id,
          slotId
        }
      });

      res.status(201).json({ message: "Successfully joined waitlist!" });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

router.put(
  "/:id/cancel",
  requireAuth,
  async (req: any, res: Response): Promise<void> => {
    try {
      const authReq = req as AuthRequest;
      const bookingId = authReq.params.id as string;
      
      const booking = await prisma.oneToOneBooking.findUnique({
        where: { id: bookingId },
        include: { slot: true }
      });

      if (!booking) {
        res.status(404).json({ message: "Booking not found" });
        return;
      }

      // Verify ownership
      if (authReq.user.role === "STUDENT") {
        const student = await prisma.student.findUnique({ where: { userId: authReq.user.id }});
        if (!student || booking.studentId !== student.id) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }
      } else if (authReq.user.role === "TEACHER") {
        const teacher = await prisma.teacher.findUnique({ where: { userId: authReq.user.id }});
        if (!teacher || booking.slot.teacherId !== teacher.id) {
          res.status(403).json({ message: "Forbidden" });
          return;
        }
      }

      // Update status
      await prisma.oneToOneBooking.update({
        where: { id: bookingId },
        data: { status: "CANCELLED" }
      });
      
      // Waitlist check (O(1) logic)
      const oldestWaitlist = await prisma.waitlistEntry.findFirst({
        where: { slotId: booking.slotId },
        orderBy: { joinedAt: "asc" },
        include: { student: { include: { user: true } } }
      });

      if (oldestWaitlist) {
        // Automatically upgrade the first person
        await prisma.oneToOneBooking.create({
          data: {
            studentId: oldestWaitlist.studentId,
            slotId: booking.slotId,
            description: "Auto-upgraded from waitlist",
          }
        });
        
        await prisma.waitlistEntry.delete({
          where: { id: oldestWaitlist.id }
        });

        // The slot stays booked, just by a new person.
        
        // Notify the new student
        const slotDetails = await prisma.availabilitySlot.findUnique({
          where: { id: booking.slotId },
          include: { teacher: { include: { user: true } } }
        });

        if (slotDetails) {
           await sendWaitlistUpgrade(
             oldestWaitlist.student.user.email,
             slotDetails.slotStart.toLocaleDateString(),
             slotDetails.slotStart.toLocaleTimeString(),
             slotDetails.teacher.user.name
           );
        }
      } else {
        // No one on waitlist, release the slot
        await prisma.availabilitySlot.update({
          where: { id: booking.slotId },
          data: { isBooked: false }
        });
      }

      res.status(200).json({ message: "Booking cancelled successfully" });
      return;
    } catch (error) {
      console.error(error);
      res.status(500).json({ message: "Internal server error" });
      return;
    }
  }
);

export default router;