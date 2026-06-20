import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import bcrypt from "bcrypt";

const router: Router = Router();

let supportSessionTarget = 300;

// Apply auth and admin role middlewares to all routes here
router.use(requireAuth);
router.use(requireRole(["ADMIN"]));

// 1. Get aggregate dashboard stats (Overview)
router.get("/stats", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    // Basic counts
    const totalStudents = await prisma.student.count();
    const totalTeachers = await prisma.teacher.count();
    const totalSupportSessions = await prisma.supportSession.count();
    const totalClassrooms = await prisma.classroom.count();

    // Active vs Total
    const activeStudents = await prisma.student.count({
      where: { user: { status: "ACTIVE" } }
    });
    const activeTeachers = await prisma.teacher.count({
      where: { user: { status: "ACTIVE" } }
    });

    // Finance Revenue (PAID Tuition)
    const tuitionPaid = await prisma.tuitionPayment.findMany({
      where: { status: "PAID" }
    });
    const totalRevenue = tuitionPaid.reduce((sum, p) => sum + p.amount, 0);

    // Due Salary (PENDING Teacher Salaries)
    const pendingSalaries = await prisma.teacherSalary.findMany({
      where: { status: "PENDING" }
    });
    const dueSalary = pendingSalaries.reduce((sum, s) => sum + s.amount, 0);

    // Dynamic Attendance Rate Chart (by class)
    const classrooms = await prisma.classroom.findMany({
      include: {
        _count: { select: { members: true } },
        attendance: true
      }
    });

    const attendanceRateChart = classrooms.map(c => {
      const totalAttendanceLogs = c.attendance.length;
      const presentLogs = c.attendance.filter(a => a.status === "PRESENT").length;
      const rate = totalAttendanceLogs > 0 ? Math.round((presentLogs / totalAttendanceLogs) * 100) : 0;
      return {
        classroom: c.title,
        code: c.classroomCode,
        rate
      };
    });

    // Result Success Chart (Pass vs Fail ratio overall)
    const passCount = await prisma.result.count({ where: { result: "PASS" } });
    const failCount = await prisma.result.count({ where: { result: "FAIL" } });

    // Recent activities logs (dynamic from DB entries)
    const recentActivities: string[] = [];

    // Recently joined students
    const recentStudents = await prisma.student.findMany({
      include: { user: true },
      orderBy: { user: { createdAt: "desc" } },
      take: 2
    });
    recentStudents.forEach(s => {
      recentActivities.push(`Student ${s.user.name} joined this school (Class ${s.class})`);
    });

    // Recently paid salaries
    const recentSalaries = await prisma.teacherSalary.findMany({
      where: { status: "PAID" },
      include: { teacher: { include: { user: true } } },
      orderBy: { paymentDate: "desc" },
      take: 2
    });
    recentSalaries.forEach(s => {
      recentActivities.push(`Teacher salary of ${s.amount} BDT paid to ${s.teacher.user.name} for ${s.month}`);
    });

    // Recently taken support sessions
    const recentSessions = await prisma.supportSession.findMany({
      where: { status: "COMPLETED" },
      include: { teacher: { include: { user: true } } },
      orderBy: { date: "desc" },
      take: 2
    });
    recentSessions.forEach(s => {
      recentActivities.push(`${s.subject} support session completed by ${s.teacher.user.name} (${s.totalJoinStudent} students joined)`);
    });

    return res.status(200).json({
      stats: {
        totalStudents,
        totalTeachers,
        totalSupportSessions,
        totalRevenue,
        dueSalary,
        activeStudents,
        activeTeachers,
        totalClassrooms
      },
      charts: {
        attendanceRateChart,
        resultSuccessChart: {
          pass: passCount,
          fail: failCount
        }
      },
      recentActivities
    });
  } catch (error: any) {
    console.error("Failed to get admin stats:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 2. Add a Student manually
router.post("/students", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { name, email, password, phone, class: className, roll, department, schoolName, year } = req.body;

    if (!name || !email || !password || !phone || !className || !roll) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newStudent = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: "STUDENT",
          emailVerified: true,
          status: "ACTIVE"
        }
      });

      const student = await tx.student.create({
        data: {
          userId: user.id,
          class: className,
          roll,
          department: department || "General",
          schoolName: schoolName || "RAS Academic School",
          email,
          phone,
          year: year || "2026",
          role: "STUDENT"
        }
      });

      return { user, student };
    });

    return res.status(201).json({ message: "Student created successfully", data: newStudent });
  } catch (error: any) {
    console.error("Failed to create student:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 3. Get all students with details & dynamic attendance
router.get("/students", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const students = await prisma.student.findMany({
      include: {
        user: true,
        attendance: true
      },
      orderBy: { roll: "asc" }
    });

    // Compute dynamic attendance rate for each student
    const result = students.map(student => {
      const totalLogs = student.attendance.length;
      const presentLogs = student.attendance.filter(a => a.status === "PRESENT").length;
      const attendanceRate = totalLogs > 0 ? Math.round((presentLogs / totalLogs) * 100) : 0;

      return {
        id: student.id,
        userId: student.userId,
        class: student.class,
        roll: student.roll,
        department: student.department,
        schoolName: student.schoolName,
        phone: student.phone,
        email: student.email,
        year: student.year,
        role: student.role,
        attendanceRate: `${attendanceRate}%`,
        user: {
          name: student.user.name,
          email: student.user.email,
          role: student.user.role,
          status: student.user.status,
          createdAt: student.user.createdAt
        }
      };
    });

    return res.status(200).json({ students: result });
  } catch (error: any) {
    console.error("Failed to get students list:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 4. Update student profile and user settings (including status)
router.put("/students/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { name, email, role, status, class: className, roll, department, schoolName, phone, year } = req.body;

    const student = await prisma.student.findUnique({ where: { id } });
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
    const updateResult = await prisma.$transaction(async (tx) => {
      const updatedUser = await tx.user.update({
        where: { id: student.userId },
        data: {
          name,
          email,
          role,
          status
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
          year,
          role: role === "STUDENT" || role === "TEACHER" || role === "GUARDIAN" ? role : undefined
        }
      });

      return { user: updatedUser, student: updatedStudent };
    });

    return res.status(200).json({ message: "Student details updated successfully", data: updateResult });
  } catch (error: any) {
    console.error("Failed to update student details:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 5. Delete Student (User + Student cascade)
router.delete("/students/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const student = await prisma.student.findUnique({ where: { id } });
    if (!student) {
      return res.status(404).json({ message: "Student profile not found" });
    }

    await prisma.user.delete({
      where: { id: student.userId }
    });

    return res.status(200).json({ message: "Student profile and user account deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete student:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 6. Add a Teacher manually
router.post("/teachers", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { name, email, password, teacherId, department, qualification, subject, salary } = req.body;

    if (!name || !email || !password || !teacherId || !department || !salary) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newTeacher = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role: "TEACHER",
          emailVerified: true,
          status: "ACTIVE"
        }
      });

      const teacher = await tx.teacher.create({
        data: {
          userId: user.id,
          teacherId,
          department,
          qualification: qualification || "BSc / MSc",
          subject: subject || department,
          rating: 4.5,
          salary: Number(salary),
          role: "TEACHER"
        }
      });

      return { user, teacher };
    });

    return res.status(201).json({ message: "Teacher created successfully", data: newTeacher });
  } catch (error: any) {
    console.error("Failed to create teacher:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 7. Get all teachers with dynamic Due Salaries
router.get("/teachers", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const teachers = await prisma.teacher.findMany({
      include: {
        user: true,
        salaries: {
          where: { status: "PENDING" }
        }
      },
      orderBy: { teacherId: "asc" }
    });

    const result = teachers.map(teacher => {
      const dueSalary = teacher.salaries.reduce((sum, s) => sum + s.amount, 0);

      return {
        id: teacher.id,
        userId: teacher.userId,
        teacherId: teacher.teacherId,
        department: teacher.department,
        qualification: teacher.qualification,
        subject: teacher.subject,
        rating: teacher.rating,
        salary: teacher.salary,
        role: teacher.role,
        dueSalary,
        user: {
          name: teacher.user.name,
          email: teacher.user.email,
          role: teacher.user.role,
          status: teacher.user.status,
          createdAt: teacher.user.createdAt
        }
      };
    });

    return res.status(200).json({ teachers: result });
  } catch (error: any) {
    console.error("Failed to get teachers list:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 8. Update teacher profile
router.put("/teachers/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { name, email, role, status, department, qualification, subject, salary, rating } = req.body;

    const teacher = await prisma.teacher.findUnique({
      where: { id },
      include: { user: true }
    });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher profile not found" });
    }

    // Check email conflict
    if (email && email !== teacher.user.email) {
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

    const updateResult = await prisma.$transaction(async (tx) => {
      const userData: any = {};
      if (name !== undefined) userData.name = name;
      if (email !== undefined) userData.email = email;
      if (role !== undefined) userData.role = role;
      if (status !== undefined) userData.status = status;

      const updatedUser = await tx.user.update({
        where: { id: teacher.userId },
        data: userData
      });

      const teacherData: any = {};
      if (department !== undefined) teacherData.department = department;
      if (qualification !== undefined) teacherData.qualification = qualification;
      if (subject !== undefined) teacherData.subject = subject;
      if (salary !== undefined) teacherData.salary = Number(salary);
      if (rating !== undefined) teacherData.rating = Number(rating);
      if (role === "STUDENT" || role === "TEACHER" || role === "GUARDIAN") {
        teacherData.role = role;
      }

      const updatedTeacher = await tx.teacher.update({
        where: { id },
        data: teacherData
      });

      return { user: updatedUser, teacher: updatedTeacher };
    });

    return res.status(200).json({ message: "Teacher details updated successfully", data: updateResult });
  } catch (error: any) {
    console.error("Failed to update teacher details:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 9. Delete Teacher
router.delete("/teachers/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const teacher = await prisma.teacher.findUnique({ where: { id } });
    if (!teacher) {
      return res.status(404).json({ message: "Teacher profile not found" });
    }

    await prisma.user.delete({
      where: { id: teacher.userId }
    });

    return res.status(200).json({ message: "Teacher profile and user account deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete teacher:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 10. Get all support sessions (Regular Support)
router.get("/support-sessions", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const sessions = await prisma.supportSession.findMany({
      include: {
        teacher: {
          include: {
            user: { select: { name: true, email: true } }
          }
        }
      },
      orderBy: { date: "desc" }
    });

    // Compute status counts
    const pendingCount = await prisma.supportSession.count({ where: { status: "SCHEDULED" } });
    const completedCount = await prisma.supportSession.count({ where: { status: "COMPLETED" } });

    // Count today's sessions
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);
    const todayCount = await prisma.supportSession.count({
      where: {
        date: {
          gte: startOfToday,
          lte: endOfToday
        }
      }
    });

    return res.status(200).json({
      sessions,
      stats: {
        pending: pendingCount,
        completed: completedCount,
        today: todayCount,
        target: supportSessionTarget
      }
    });
  } catch (error: any) {
    console.error("Failed to get support sessions:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 10a. Update support session target
router.put("/support-sessions/target", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { target } = req.body;
    if (target === undefined || isNaN(Number(target))) {
      return res.status(400).json({ message: "Invalid target value" });
    }
    supportSessionTarget = Number(target);
    return res.status(200).json({ message: "Target updated successfully", target: supportSessionTarget });
  } catch (error: any) {
    console.error("Failed to update support session target:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 11. Create a support session
router.post("/support-sessions", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { teacherId, date, time, subject, duration, totalJoinStudent } = req.body;

    if (!teacherId || !date || !time || !subject) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    const newSession = await prisma.supportSession.create({
      data: {
        teacherId,
        date: new Date(date),
        time,
        meetLink: "https://meet.google.com/abc-defg-hij",
        subject,
        duration: duration ? Number(duration) : 45,
        totalJoinStudent: totalJoinStudent ? Number(totalJoinStudent) : 0,
        status: "SCHEDULED"
      },
      include: {
        teacher: {
          include: { user: { select: { name: true } } }
        }
      }
    });

    return res.status(201).json({ message: "Support session scheduled successfully", session: newSession });
  } catch (error: any) {
    console.error("Failed to create support session:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 12. Cancel a support session
router.put("/support-sessions/:id/cancel", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    const session = await prisma.supportSession.findUnique({ where: { id } });
    if (!session) {
      return res.status(404).json({ message: "Support session not found" });
    }

    const updated = await prisma.supportSession.update({
      where: { id },
      data: { status: "CANCELLED" }
    });

    return res.status(200).json({ message: "Support session cancelled successfully", session: updated });
  } catch (error: any) {
    console.error("Failed to cancel support session:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 13. Get 1-to-1 support sessions bookings
router.get("/bookings", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const bookings = await prisma.oneToOneBooking.findMany({
      include: {
        student: {
          include: { user: { select: { name: true, email: true } } }
        },
        slot: {
          include: {
            teacher: {
              include: { user: { select: { name: true, email: true } } }
            }
          }
        }
      },
      orderBy: { slot: { slotStart: "desc" } }
    });

    return res.status(200).json({ bookings });
  } catch (error: any) {
    console.error("Failed to get 1-to-1 bookings:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 14. Cancel a 1-to-1 booking
router.put("/bookings/:id/cancel", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;

    const booking = await prisma.oneToOneBooking.findUnique({ where: { id } });
    if (!booking) {
      return res.status(404).json({ message: "Booking record not found" });
    }

    const result = await prisma.$transaction(async (tx) => {
      // Update booking status
      const updatedBooking = await tx.oneToOneBooking.update({
        where: { id },
        data: { status: "CANCELLED" }
      });

      // Free availability slot
      await tx.availabilitySlot.update({
        where: { id: booking.slotId },
        data: { isBooked: false }
      });

      return updatedBooking;
    });

    return res.status(200).json({ message: "Booking cancelled successfully", booking: result });
  } catch (error: any) {
    console.error("Failed to cancel booking:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 15. Revenue & Finance stats and details
router.get("/revenue/finance", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const tuitionPayments = await prisma.tuitionPayment.findMany({});
    const salaries = await prisma.teacherSalary.findMany({});
    const courseEnrollments = await prisma.enrollment.findMany({
      include: {
        student: {
          include: { user: { select: { name: true, email: true } } }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    // Calculations
    const monthlyRev = tuitionPayments.filter(p => p.status === "PAID").reduce((sum, p) => sum + p.amount, 0);
    const enrollmentRev = courseEnrollments.reduce((sum, e) => sum + e.amountPaid, 0);
    const refunds = tuitionPayments.filter(p => p.status === "REFUNDED").reduce((sum, p) => sum + p.amount, 0);
    const salariesPaid = salaries.filter(s => s.status === "PAID").reduce((sum, s) => sum + s.amount, 0);

    const netProfit = (monthlyRev + enrollmentRev) - refunds - salariesPaid;

    // Monthly breakdown for growth chart (Tuition payments over time)
    // We group by month (e.g. January, February)
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const growthChart = months.map(month => {
      const total = tuitionPayments
        .filter(p => p.status === "PAID" && p.month.toLowerCase() === month.toLowerCase())
        .reduce((sum, p) => sum + p.amount, 0);
      return {
        month,
        revenue: total
      };
    });

    return res.status(200).json({
      finance: {
        monthlyRev: monthlyRev + enrollmentRev,
        refunds,
        netProfit,
        extraCurriculum: enrollmentRev // Repurposing extraCurriculum to show total Enrollment Revenue
      },
      growthChart,
      courseEnrollments // Returning the actual enrollment records
    });
  } catch (error: any) {
    console.error("Failed to get finance details:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 16. Satisfaction rating list by class
router.get("/satisfaction", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { class: className } = req.query;

    const whereClause: any = {};
    if (className && className !== "ALL") {
      whereClause.class = String(className);
    }

    const satisfaction = await prisma.satisfactionRating.findMany({
      where: whereClause,
      orderBy: { avgRate: "desc" }
    });

    // Return trend data
    const trend = satisfaction.map(s => ({
      subject: s.subject,
      rating: s.avgRate
    }));

    return res.status(200).json({ satisfaction, trend });
  } catch (error: any) {
    console.error("Failed to get satisfaction analytics:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 17. Get Exam attendance/participation statistics (Dynamic: total student of this class vs attend how much)
router.get("/exams/attendance-stats", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const exams = await prisma.exam.findMany({
      include: {
        results: {
          include: {
            student: true
          }
        }
      },
      orderBy: { examDate: "desc" }
    });

    // We calculate class-wise attendance data for each exam
    // A participation record will show Exam Name, Class, Total Students in that Class, Attended count.
    const resultStats: any[] = [];

    // Get student count by class
    const studentsByClass = await prisma.student.groupBy({
      by: ["class"],
      _count: { id: true }
    });

    const studentCountsMap: Record<string, number> = {};
    studentsByClass.forEach(s => {
      studentCountsMap[s.class] = s._count.id;
    });

    for (const exam of exams) {
      // Group results by student's class
      const classAttendance: Record<string, number> = {};

      exam.results.forEach(res => {
        const studentClass = res.student.class;
        classAttendance[studentClass] = (classAttendance[studentClass] || 0) + 1;
      });

      // Assemble output stats
      Object.keys(classAttendance).forEach(cls => {
        const totalClassStudents = studentCountsMap[cls] || 0;
        resultStats.push({
          examId: exam.id,
          examName: exam.name,
          class: cls,
          totalStudents: totalClassStudents,
          attended: classAttendance[cls]
        });
      });

      // If an exam has no results yet, show statistics for default Class 8
      if (exam.results.length === 0) {
        resultStats.push({
          examId: exam.id,
          examName: exam.name,
          class: "08",
          totalStudents: studentCountsMap["08"] || 0,
          attended: 0
        });
      }
    }

    return res.status(200).json({ stats: resultStats });
  } catch (error: any) {
    console.error("Failed to get exam stats:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 18. General User List with Edit & Suspend capability
router.get("/users", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "desc" }
    });
    return res.status(200).json({ users });
  } catch (error: any) {
    console.error("Failed to get users:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 18a. Create a user manually
router.post("/users", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { name, email, password, role, status } = req.body;
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Required fields are missing" });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name,
          email,
          password: hashedPassword,
          role,
          emailVerified: true,
          status: status || "ACTIVE"
        }
      });

      if (role === "STUDENT") {
        await tx.student.create({
          data: {
            userId: user.id,
            class: "08",
            roll: Math.floor(100 + Math.random() * 900).toString(),
            department: "General",
            schoolName: "RAS Academic School",
            email,
            phone: "01700000000",
            role: "STUDENT"
          }
        });
      } else if (role === "TEACHER") {
        await tx.teacher.create({
          data: {
            userId: user.id,
            teacherId: "T" + Math.floor(100 + Math.random() * 900).toString(),
            department: "General",
            qualification: "N/A",
            subject: "General",
            salary: 40000,
            role: "TEACHER"
          }
        });
      } else if (role === "GUARDIAN") {
        const student = await tx.student.findFirst();
        if (student) {
          await tx.guardian.create({
            data: {
              userId: user.id,
              studentId: student.id,
              role: "GUARDIAN"
            }
          });
        }
      }

      return user;
    });

    return res.status(201).json({ message: "User created successfully", user: newUser });
  } catch (error: any) {
    console.error("Failed to create user:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 18b. Delete a user manually
router.delete("/users/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    await prisma.user.delete({
      where: { id }
    });

    return res.status(200).json({ message: "User account deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete user:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 19. Update generic User info & Suspend
router.put("/users/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const { name, email, role, status } = req.body;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check email conflict
    if (email && email !== user.email) {
      const conflict = await prisma.user.findFirst({
        where: {
          email,
          NOT: { id }
        }
      });
      if (conflict) {
        return res.status(400).json({ message: "Email is already in use by another user" });
      }
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data: {
        name,
        email,
        role,
        status
      }
    });

    // Sync child roles if they exist
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

    return res.status(200).json({ message: "User updated successfully", user: updatedUser });
  } catch (error: any) {
    console.error("Failed to update user:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 20. Update generic user role manually
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

// 21. Get all classrooms for admin dashboard
router.get("/classrooms", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classrooms = await prisma.classroom.findMany({
      include: {
        teacher: {
          include: {
            user: { select: { name: true, email: true } }
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

// 22. Create classroom
router.post("/classrooms", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const { title, teacherId } = req.body;
    if (!title || !teacherId) {
      return res.status(400).json({ message: "Title and Teacher ID are required" });
    }

    const classroomCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    const classroom = await prisma.classroom.create({
      data: {
        title,
        classroomCode,
        teacherId
      }
    });

    return res.status(201).json({ message: "Classroom created successfully", classroom });
  } catch (error: any) {
    console.error("Failed to create classroom:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 23. Delete classroom
router.delete("/classrooms/:id", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const id = req.params.id as string;
    const classroom = await prisma.classroom.findUnique({ where: { id } });
    if (!classroom) {
      return res.status(404).json({ message: "Classroom not found" });
    }

    // Delete members first
    await prisma.classroomMember.deleteMany({
      where: { classroomId: id }
    });

    // Delete classroom
    await prisma.classroom.delete({
      where: { id }
    });

    return res.status(200).json({ message: "Classroom deleted successfully" });
  } catch (error: any) {
    console.error("Failed to delete classroom:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 24. Get members of a classroom
router.get("/classrooms/:classroomId/members", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classroomId = req.params.classroomId as string;
    const members = await prisma.classroomMember.findMany({
      where: { classroomId },
      include: {
        student: {
          include: {
            user: { select: { name: true, email: true } }
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

// 25. Enroll student in classroom
router.post("/classrooms/:classroomId/members", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classroomId = req.params.classroomId as string;
    const { studentId } = req.body;
    if (!studentId) {
      return res.status(400).json({ message: "Student ID is required" });
    }

    const existingMember = await prisma.classroomMember.findFirst({
      where: { classroomId, studentId }
    });

    if (existingMember) {
      return res.status(400).json({ message: "Student is already in this classroom" });
    }

    const member = await prisma.classroomMember.create({
      data: {
        classroomId,
        studentId
      }
    });

    return res.status(201).json({ message: "Student enrolled successfully", member });
  } catch (error: any) {
    console.error("Failed to enroll student:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

// 26. Remove student from classroom
router.delete("/classrooms/:classroomId/members/:studentId", async (req: AuthRequest, res: Response): Promise<any> => {
  try {
    const classroomId = req.params.classroomId as string;
    const studentId = req.params.studentId as string;

    const existingMember = await prisma.classroomMember.findFirst({
      where: { classroomId, studentId }
    });

    if (!existingMember) {
      return res.status(404).json({ message: "Enrollment record not found" });
    }

    await prisma.classroomMember.deleteMany({
      where: { classroomId, studentId }
    });

    return res.status(200).json({ message: "Student removed from classroom successfully" });
  } catch (error: any) {
    console.error("Failed to remove student from classroom:", error);
    return res.status(500).json({ message: "Internal server error", error: error.message });
  }
});

export default router;
