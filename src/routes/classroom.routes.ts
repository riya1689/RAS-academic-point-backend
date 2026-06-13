import { Router } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";

const router = Router();

router.post(
  "/",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: any, res: any) => {
    try {
      const { title } = req.body;

      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user.id },
      });

      if (!teacher) {
        return res.status(404).json({ message: "Teacher profile not found" });
      }

      const classroomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

      const classroom = await prisma.classroom.create({
        data: {
          title,
          classroomCode,
          teacherId: teacher.id,
        },
      });

      return res.status(201).json({ message: "Classroom created successfully", classroom });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/teacher",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: any, res: any) => {
    try {
      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
      
      const classrooms = await prisma.classroom.findMany({
        where: { teacherId: teacher?.id },
        include: { members: true },
      });
      return res.status(200).json({ classrooms });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/join",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: any, res: any) => {
    try {
      const { code } = req.body;

      if (!code) {
        return res.status(400).json({ message: "Classroom code is required" });
      }

      const classroom = await prisma.classroom.findUnique({
        where: { classroomCode: code.toUpperCase() }
      });

      if (!classroom) {
        return res.status(404).json({ message: "Invalid classroom code" });
      }

      const student = await prisma.student.findUnique({
        where: { userId: req.user.id },
      });

      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      const existingMember = await prisma.classroomMember.findUnique({
        where: {
          classroomId_studentId: { classroomId: classroom.id, studentId: student.id },
        },
      });

      if (existingMember) {
        return res.status(400).json({ message: "You are already a member of this classroom" });
      }

      await prisma.classroomMember.create({
        data: {
          classroomId: classroom.id,
          studentId: student.id,
        },
      });

      return res.status(200).json({ message: "Successfully joined the classroom" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/student",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: any, res: any) => {
    try {
      const student = await prisma.student.findUnique({ where: { userId: req.user.id } });
      
      const classroomMembers = await prisma.classroomMember.findMany({
        where: { studentId: student?.id },
        include: { 
          classroom: {
            include: { teacher: { include: { user: true } } }
          } 
        },
      });

      const classrooms = classroomMembers.map(member => member.classroom);
      
      return res.status(200).json({ classrooms });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/:classroomId/attendance",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: any, res: any) => {
    try {
      const { classroomId } = req.params;
      const { date, records } = req.body;

      const teacher = await prisma.teacher.findUnique({ where: { userId: req.user.id } });
      const classroom = await prisma.classroom.findFirst({
        where: { id: classroomId, teacherId: teacher?.id }
      });

      if (!classroom) {
        return res.status(403).json({ message: "Unauthorized or classroom not found" });
      }

      const attendanceDate = new Date(date);
      attendanceDate.setUTCHours(0, 0, 0, 0);

      const operations = records.map((record: any) => 
        prisma.attendance.upsert({
          where: {
            studentId_classroomId_date: {
              studentId: record.studentId,
              classroomId: classroomId,
              date: attendanceDate
            }
          },
          update: { status: record.status },
          create: {
            studentId: record.studentId,
            classroomId: classroomId,
            date: attendanceDate,
            status: record.status
          }
        })
      );

      await prisma.$transaction(operations);

      return res.status(200).json({ message: "Attendance submitted successfully" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/:classroomId/attendance/my",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: any, res: any) => {
    try {
      const { classroomId } = req.params;
      const student = await prisma.student.findUnique({ where: { userId: req.user.id } });

      const attendance = await prisma.attendance.findMany({
        where: { classroomId, studentId: student?.id },
        orderBy: { date: "desc" }
      });

      const presentCount = attendance.filter(a => a.status === "PRESENT").length;
      const absentCount = attendance.filter(a => a.status === "ABSENT").length;
      const totalDays = presentCount + absentCount;
      const percentage = totalDays > 0 ? ((presentCount / totalDays) * 100).toFixed(2) : 0;

      return res.status(200).json({ 
        attendance,
        stats: { totalDays, presentCount, absentCount, percentage }
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/guardian/list",
  requireAuth,
  requireRole(["GUARDIAN"]),
  async (req: any, res: any) => {
    try {
      const guardian = await prisma.guardian.findUnique({
        where: { userId: req.user.id },
        include: {
          student: {
            include: { user: true }
          }
        }
      });
      if (!guardian) {
        return res.status(404).json({ message: "Guardian profile not found" });
      }
      const classroomMembers = await prisma.classroomMember.findMany({
        where: { studentId: guardian.studentId },
        include: {
          classroom: {
            include: { teacher: { include: { user: true } } }
          }
        }
      });
      const classrooms = classroomMembers.map(member => member.classroom);
      return res.status(200).json({ student: guardian.student, classrooms });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/:classroomId",
  requireAuth,
  async (req: any, res: any) => {
    try {
      const { classroomId } = req.params;
      const classroom = await prisma.classroom.findUnique({
        where: { id: classroomId },
        include: {
          teacher: {
            include: { user: true }
          },
          members: {
            include: {
              student: {
                include: { user: true }
              }
            }
          }
        }
      });
      if (!classroom) {
        return res.status(404).json({ message: "Classroom not found" });
      }
      return res.status(200).json({ classroom });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/:classroomId/attendance/guardian",
  requireAuth,
  requireRole(["GUARDIAN"]),
  async (req: any, res: any) => {
    try {
      const { classroomId } = req.params;
      const guardian = await prisma.guardian.findUnique({
        where: { userId: req.user.id }
      });
      if (!guardian) {
        return res.status(404).json({ message: "Guardian profile not found" });
      }
      const attendance = await prisma.attendance.findMany({
        where: { classroomId, studentId: guardian.studentId },
        orderBy: { date: "desc" }
      });
      const presentCount = attendance.filter(a => a.status === "PRESENT").length;
      const absentCount = attendance.filter(a => a.status === "ABSENT").length;
      const totalDays = presentCount + absentCount;
      const percentage = totalDays > 0 ? ((presentCount / totalDays) * 100).toFixed(2) : 0;
      return res.status(200).json({
        attendance,
        stats: { totalDays, presentCount, absentCount, percentage }
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;