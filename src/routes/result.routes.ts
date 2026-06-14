import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";

const router: Router = Router();

// 1. Get all exams
router.get(
  "/exams",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const exams = await prisma.exam.findMany({
        orderBy: { examDate: "desc" }
      });
      return res.status(200).json({ exams });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 2. Create exam (Admin & Teacher)
router.post(
  "/exams",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { name, examDate } = req.body;

      if (!name || !examDate) {
        return res.status(400).json({ message: "Exam name and date are required" });
      }

      const exam = await prisma.exam.create({
        data: {
          name,
          examDate: new Date(examDate)
        }
      });

      return res.status(201).json({ message: "Exam created successfully", exam });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 3. Record/upload student result (Admin & Teacher)
router.post(
  "/results",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { 
        studentId, 
        examId, 
        subject, 
        writtenMark, 
        mcqMark, 
        practicalMark, 
        writtenPassMark, 
        mcqPassMark, 
        practicalPassMark 
      } = req.body;

      if (!studentId || !examId || !subject || writtenMark === undefined || mcqMark === undefined) {
        return res.status(400).json({ message: "Required fields are missing" });
      }

      // Check student & exam existence
      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      const exam = await prisma.exam.findUnique({ where: { id: examId } });
      if (!exam) {
        return res.status(404).json({ message: "Exam not found" });
      }

      const wMark = Number(writtenMark);
      const mMark = Number(mcqMark);
      const pMark = practicalMark !== undefined && practicalMark !== null ? Number(practicalMark) : null;

      const wPass = writtenPassMark !== undefined ? Number(writtenPassMark) : 40;
      const mPass = mcqPassMark !== undefined ? Number(mcqPassMark) : 15;
      const pPass = practicalPassMark !== undefined && practicalPassMark !== null ? Number(practicalPassMark) : 0;

      const totalMark = wMark + mMark + (pMark || 0);

      const isPass = wMark >= wPass && mMark >= mPass && (pMark === null || pMark >= pPass);
      const finalResult = isPass ? "PASS" : "FAIL";

      // Upsert result record
      const existing = await prisma.result.findFirst({
        where: { studentId, examId, subject }
      });

      let record;
      if (existing) {
        record = await prisma.result.update({
          where: { id: existing.id },
          data: {
            writtenMark: wMark,
            mcqMark: mMark,
            practicalMark: pMark,
            totalMark,
            writtenPassMark: wPass,
            mcqPassMark: mPass,
            practicalPassMark: pPass,
            result: finalResult
          }
        });
      } else {
        record = await prisma.result.create({
          data: {
            studentId,
            examId,
            subject,
            writtenMark: wMark,
            mcqMark: mMark,
            practicalMark: pMark,
            totalMark,
            writtenPassMark: wPass,
            mcqPassMark: mPass,
            practicalPassMark: pPass,
            result: finalResult
          }
        });
      }

      return res.status(200).json({ message: "Result recorded successfully", record });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 4. Get logged-in student's results
router.get(
  "/results/my",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const student = await prisma.student.findUnique({
        where: { userId: req.user.id }
      });

      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      const { examId } = req.query;

      const whereClause: any = { studentId: student.id };
      if (examId) {
        whereClause.examId = String(examId);
      }

      const results = await prisma.result.findMany({
        where: whereClause,
        include: {
          exam: true
        },
        orderBy: { subject: "asc" }
      });

      return res.status(200).json({ results });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 5. Get a specific student's results (Admin, Teacher, Guardian)
router.get(
  "/results/student/:studentId",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const studentId = String(req.params["studentId"]);
      const { examId } = req.query;

      // Validate student lookup authorization for Guardians
      if (req.user.role === "GUARDIAN") {
        const guardian = await prisma.guardian.findUnique({
          where: { userId: req.user.id }
        });
        if (!guardian || guardian.studentId !== studentId) {
          return res.status(403).json({ message: "Forbidden Access - Not your ward" });
        }
      }

      const whereClause: any = { studentId };
      if (examId) {
        whereClause.examId = String(examId);
      }

      const results = await prisma.result.findMany({
        where: whereClause,
        include: {
          exam: true
        },
        orderBy: { subject: "asc" }
      });

      return res.status(200).json({ results });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 6. Get leaderboard
router.get(
  "/leaderboard",
  requireAuth,
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { examId, class: className, schoolName } = req.query;

      if (!examId) {
        return res.status(400).json({ message: "examId is required for rankings" });
      }

      const whereClause: any = {
        results: {
          some: {
            examId: String(examId)
          }
        }
      };

      if (className) {
        whereClause.class = String(className);
      }

      if (schoolName) {
        whereClause.schoolName = { contains: String(schoolName), mode: "insensitive" };
      }

      // Fetch all students within filters
      const students: any[] = await prisma.student.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              name: true
            }
          },
          results: {
            where: {
              examId: String(examId)
            }
          }
        }
      });

      // Map scores and sum them up
      const leaderboardData = students.map((s: any) => {
        const totalScore = s.results.reduce((sum: number, r: any) => sum + r.totalMark, 0);
        return {
          studentId: s.id,
          name: s.user?.name || "Academic Student",
          class: s.class,
          roll: s.roll,
          schoolName: s.schoolName,
          totalScore
        };
      });

      // Sort descending
      leaderboardData.sort((a, b) => b.totalScore - a.totalScore);

      // Append rank
      const rankedLeaderboard = leaderboardData.map((item, index) => ({
        rank: index + 1,
        ...item
      }));

      return res.status(200).json({ leaderboard: rankedLeaderboard });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 7. Update Exam (Admin & Teacher)
router.put(
  "/exams/:id",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const id = req.params.id as string;
      const { name, examDate } = req.body;

      if (!name || !examDate) {
        return res.status(400).json({ message: "Exam name and date are required" });
      }

      const exam = await prisma.exam.update({
        where: { id },
        data: {
          name,
          examDate: new Date(examDate)
        }
      });

      return res.status(200).json({ message: "Exam updated successfully", exam });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 8. Update result/mark (Admin & Teacher)
router.put(
  "/results/:id",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const id = req.params.id as string;
      const { 
        writtenMark, 
        mcqMark, 
        practicalMark, 
        writtenPassMark, 
        mcqPassMark, 
        practicalPassMark 
      } = req.body;

      if (writtenMark === undefined || mcqMark === undefined) {
        return res.status(400).json({ message: "Written and MCQ marks are required" });
      }

      const wMark = Number(writtenMark);
      const mMark = Number(mcqMark);
      const pMark = practicalMark !== undefined && practicalMark !== null ? Number(practicalMark) : null;

      const wPass = writtenPassMark !== undefined ? Number(writtenPassMark) : 40;
      const mPass = mcqPassMark !== undefined ? Number(mcqPassMark) : 15;
      const pPass = practicalPassMark !== undefined && practicalPassMark !== null ? Number(practicalPassMark) : 0;

      const totalMark = wMark + mMark + (pMark || 0);

      const isPass = wMark >= wPass && mMark >= mPass && (pMark === null || pMark >= pPass);
      const finalResult = isPass ? "PASS" : "FAIL";

      const record = await prisma.result.update({
        where: { id },
        data: {
          writtenMark: wMark,
          mcqMark: mMark,
          practicalMark: pMark,
          totalMark,
          writtenPassMark: wPass,
          mcqPassMark: mPass,
          practicalPassMark: pPass,
          result: finalResult
        }
      });

      return res.status(200).json({ message: "Result updated successfully", record });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

// 9. Delete result/mark (Admin & Teacher)
router.delete(
  "/results/:id",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const id = req.params.id as string;

      await prisma.result.delete({
        where: { id }
      });

      return res.status(200).json({ message: "Result deleted successfully" });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

export default router;
