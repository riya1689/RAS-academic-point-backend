import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";

const router: Router = Router();

// Apply auth and admin role middlewares to all routes here
router.use(requireAuth);
router.use(requireRole(["ADMIN"]));

// 1. Get aggregate dashboard stats
router.get("/stats", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const totalStudents = await prisma.student.count();
    const totalTeachers = await prisma.teacher.count();
    const totalClassrooms = await prisma.classroom.count();
    const totalGuardians = await prisma.guardian.count();

    // Tuition revenue
    const tuitionPayments = await prisma.tuitionPayment.findMany({
      where: { status: "PAID" }
    });
    const totalRevenue = tuitionPayments.reduce((sum, p) => sum + p.amount, 0);

    const pendingPayments = await prisma.tuitionPayment.findMany({
      where: { status: "PENDING" }
    });
    const totalPending = pendingPayments.reduce((sum, p) => sum + p.amount, 0);

    // Teacher salaries disbursed
    const teacherSalaries = await prisma.teacherSalary.findMany({
      where: { status: "PAID" }
    });
    const totalSalariesPaid = teacherSalaries.reduce((sum, s) => sum + s.amount, 0);

    return res.status(200).json({
      stats: {
        totalStudents,
        totalTeachers,
        totalClassrooms,
        totalGuardians,
        totalRevenue,
        totalPending,
        totalSalariesPaid
      }
    });
  } catch (error: any) {
    console.error("Failed to get admin stats:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 2. Get all users (general list)
router.get("/users", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        emailVerified: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" }
    });
    return res.status(200).json({ users });
  } catch (error: any) {
    console.error("Failed to get users:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 3. Update user role manually
router.put("/users/:id/role", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ message: "Role is required" });
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: { role }
    });

    // Also update role in corresponding student/teacher/guardian records if they exist
    if (role === "STUDENT" || role === "TEACHER" || role === "GUARDIAN") {
      await prisma.student.updateMany({
        where: { userId: id },
        data: { role }
      });
      await prisma.teacher.updateMany({
        where: { userId: id },
        data: { role }
      });
      await prisma.guardian.updateMany({
        where: { userId: id },
        data: { role }
      });
    }

    return res.status(200).json({ message: "User role updated successfully", user: updatedUser });
  } catch (error: any) {
    console.error("Failed to update user role:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 4. Get all students with details
router.get("/students", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const students = await prisma.student.findMany({
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true
          }
        }
      },
      orderBy: { class: "asc" }
    });
    return res.status(200).json({ students });
  } catch (error: any) {
    console.error("Failed to get students list:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 5. Update student details
router.put("/students/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { name, email, role, class: className, roll, department, schoolName, phone } = req.body;

    const student = await prisma.student.findUnique({ where: { id: id as string } });
    if (!student) {
      return res.status(404).json({ message: "Student profile not found" });
    }

    // Check email uniqueness if it changed
    if (email && email !== student.email) {
      const emailConflict = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id: student.userId }
        }
      });
      if (emailConflict) {
        return res.status(400).json({ message: "Email is already taken by another user" });
      }
    }

    // Update User and Student in transaction
    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: student.userId },
        data: {
          name,
          email,
          role
        }
      });

      const updatedStudent = await tx.student.update({
        where: { id },
        data: {
          class: className,
          roll,
          department,
          schoolName,
          phone,
          email,
          role: role === "STUDENT" || role === "TEACHER" || role === "GUARDIAN" ? role : undefined
        }
      });

      return { user: updatedUser, student: updatedStudent };
    });

    return res.status(200).json({ message: "Student details updated successfully", data: result });
  } catch (error: any) {
    console.error("Failed to update student details:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 6. Delete student profile & user
router.delete("/students/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const student = await prisma.student.findUnique({ where: { id: id as string } });
    if (!student) {
      return res.status(404).json({ message: "Student profile not found" });
    }

    // Deleting user will cascade-delete Student due to Prisma onDelete: Cascade schema config
    await prisma.user.delete({
      where: { id: student.userId }
    });

    return res.status(200).json({ message: "Student profile deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete student:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 7. Get all teachers with details
router.get("/teachers", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const teachers = await prisma.teacher.findMany({
      include: {
        user: {
          select: {
            name: true,
            email: true,
            role: true
          }
        }
      }
    });
    return res.status(200).json({ teachers });
  } catch (error: any) {
    console.error("Failed to get teachers list:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 8. Update teacher details
router.put("/teachers/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { name, email, role, department, qualification, teacherId } = req.body;

    const teacher = await prisma.teacher.findUnique({
      where: { id: id as string },
      include: { user: true }
    });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher profile not found" });
    }

    // Check email conflict
    if (email && email !== teacher.user?.email) {
      const emailConflict = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id: teacher.userId }
        }
      });
      if (emailConflict) {
        return res.status(400).json({ message: "Email is already taken by another user" });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: teacher.userId },
        data: {
          name,
          email,
          role
        }
      });

      const updatedTeacher = await tx.teacher.update({
        where: { id },
        data: {
          department,
          qualification,
          teacherId,
          role: role === "STUDENT" || role === "TEACHER" || role === "GUARDIAN" ? role : undefined
        }
      });

      return { user: updatedUser, teacher: updatedTeacher };
    });

    return res.status(200).json({ message: "Teacher details updated successfully", data: result });
  } catch (error: any) {
    console.error("Failed to update teacher details:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 9. Delete teacher profile & user
router.delete("/teachers/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const teacher = await prisma.teacher.findUnique({ where: { id: id as string } });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher profile not found" });
    }

    await prisma.user.delete({
      where: { id: teacher.userId }
    });

    return res.status(200).json({ message: "Teacher profile deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete teacher:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 10. Get all classrooms
router.get("/classrooms", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classrooms = await prisma.classroom.findMany({
      include: {
        teacher: {
          include: {
            user: {
              select: { name: true, email: true }
            }
          }
        },
        _count: {
          select: { members: true }
        }
      },
      orderBy: { createdAt: "desc" }
    });
    return res.status(200).json({ classrooms });
  } catch (error: any) {
    console.error("Failed to get classrooms:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 11. Create a classroom
router.post("/classrooms", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { title, teacherId } = req.body;

    if (!title || !teacherId) {
      return res.status(400).json({ message: "Classroom title and teacher assignment are required" });
    }

    // Verify teacher exists
    const teacherExists = await prisma.teacher.findUnique({ where: { id: teacherId } });
    if (!teacherExists) {
      return res.status(404).json({ message: "Assigned teacher profile not found" });
    }

    const classroomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const classroom = await prisma.classroom.create({
      data: {
        title,
        classroomCode,
        teacherId
      },
      include: {
        teacher: {
          include: {
            user: {
              select: { name: true, email: true }
            }
          }
        },
        _count: {
          select: { members: true }
        }
      }
    });

    return res.status(201).json({ message: "Classroom created successfully", classroom });
  } catch (error: any) {
    console.error("Failed to create classroom:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 12. Update classroom
router.put("/classrooms/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { title, teacherId } = req.body;

    if (!title || !teacherId) {
      return res.status(400).json({ message: "Title and Teacher are required" });
    }

    const teacherExists = await prisma.teacher.findUnique({ where: { id: teacherId } });
    if (!teacherExists) {
      return res.status(404).json({ message: "Assigned teacher profile not found" });
    }

    const classroom = await prisma.classroom.update({
      where: { id },
      data: {
        title,
        teacherId
      },
      include: {
        teacher: {
          include: {
            user: {
              select: { name: true, email: true }
            }
          }
        },
        _count: {
          select: { members: true }
        }
      }
    });

    return res.status(200).json({ message: "Classroom updated successfully", classroom });
  } catch (error: any) {
    console.error("Failed to update classroom:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 13. Delete classroom
router.delete("/classrooms/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    await prisma.classroom.delete({
      where: { id: id as string }
    });
    return res.status(200).json({ message: "Classroom deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete classroom:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 14. Get classroom members
router.get("/classrooms/:classroomId/members", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classroomId = req.params.classroomId as string;
    const members = await prisma.classroomMember.findMany({
      where: { classroomId },
      include: {
        student: {
          include: {
            user: {
              select: { name: true, email: true }
            }
          }
        }
      }
    });
    return res.status(200).json({ members });
  } catch (error: any) {
    console.error("Failed to get classroom members:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 15. Enroll student in a classroom
router.post("/classrooms/:classroomId/members", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classroomId = req.params.classroomId as string;
    const { studentId } = req.body;

    if (!studentId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    const studentExists = await prisma.student.findUnique({ where: { id: studentId } });
    if (!studentExists) {
      return res.status(404).json({ message: "Student not found" });
    }

    const existing = await prisma.classroomMember.findUnique({
      where: {
        classroomId_studentId: {
          classroomId,
          studentId
        }
      }
    });

    if (existing) {
      return res.status(400).json({ message: "Student is already in this classroom" });
    }

    const member = await prisma.classroomMember.create({
      data: {
        classroomId,
        studentId
      },
      include: {
        student: {
          include: {
            user: {
              select: { name: true, email: true }
            }
          }
        }
      }
    });

    return res.status(201).json({ message: "Student enrolled successfully", member });
  } catch (error: any) {
    console.error("Failed to enroll student:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 16. Remove student from classroom
router.delete("/classrooms/:classroomId/members/:studentId", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classroomId = req.params.classroomId as string;
    const studentId = req.params.studentId as string;

    const existing = await prisma.classroomMember.findUnique({
      where: {
        classroomId_studentId: {
          classroomId,
          studentId
        }
      }
    });

    if (!existing) {
      return res.status(404).json({ message: "Enrollment record not found" });
    }

    await prisma.classroomMember.delete({
      where: {
        classroomId_studentId: {
          classroomId,
          studentId
        }
      }
    });

    return res.status(200).json({ message: "Student removed from classroom successfully" });
  } catch (error: any) {
    console.error("Failed to remove student:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

export default router;
