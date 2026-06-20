import { Router } from "express";
import type { Response } from "express";
import { prisma } from "../db.js";
import { requireAuth, requireRole } from "../middleware/auth.middleware.js";
import type { AuthRequest } from "../middleware/auth.middleware.js";
import stripe from "../stripe.js";

const router: Router = Router();

const MONTHS_LIST = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

router.get(
  "/tuition/my",
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

      const payments = await prisma.tuitionPayment.findMany({
        where: { studentId: student.id }
      });

      const tuitionLogs = MONTHS_LIST.map(month => {
        const record = payments.find(p => p.month.toLowerCase() === month.toLowerCase());
        if (record) {
          return {
            month,
            status: record.status,
            amount: record.amount,
            paymentMethod: record.paymentMethod,
            paymentDate: record.paymentDate
          };
        }
        return {
          month,
          status: "UNPAID",
          amount: 1500,
          paymentMethod: null,
          paymentDate: null
        };
      });

      return res.status(200).json({ tuitionLogs });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/tuition/checkout",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { month, amount } = req.body;

      if (!month) {
        return res.status(400).json({ message: "Month is required" });
      }

      const student = await prisma.student.findUnique({
        where: { userId: req.user.id },
        include: { user: true }
      });

      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: {
                name: `Tuition Fee - ${month}`,
                description: `Monthly tuition fee payment for student: ${student.user.name}`
              },
              unit_amount: Math.round(amount * 100)
            },
            quantity: 1
          }
        ],
        metadata: {
          studentId: student.id,
          month,
          amount: String(amount)
        },
        success_url: `${frontendUrl}/dashboard/student?payment=success&month=${month}`,
        cancel_url: `${frontendUrl}/dashboard/student?payment=cancel`
      });

      return res.status(200).json({ sessionId: session.id, checkoutUrl: session.url });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/enroll/checkout",
  requireAuth,
  requireRole(["STUDENT"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { classId, amount } = req.body;

      if (!classId) {
        return res.status(400).json({ message: "classId is required" });
      }
      if (!amount) {
        return res.status(400).json({ message: "Amount is required" });
      }

      const student = await prisma.student.findUnique({
        where: { userId: req.user.id },
        include: { user: true, enrollments: true }
      });

      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      // Check if already enrolled
      const isAlreadyEnrolled = student.enrollments.some(e => e.classId === classId);
      if (isAlreadyEnrolled) {
        return res.status(400).json({ message: `Already enrolled in ${classId}` });
      }

      const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        mode: "payment",
        line_items: [
          {
            price_data: {
              currency: "bdt",
              product_data: {
                name: `Enrollment - ${classId}`,
                description: `Enrollment fee for ${classId} - Student: ${student.user.name}`
              },
              unit_amount: Math.round(amount * 100)
            },
            quantity: 1
          }
        ],
        metadata: {
          type: "enrollment",
          studentId: student.id,
          classId,
          amount: String(amount)
        },
        success_url: `${frontendUrl}/dashboard/student?enrollment=success&classId=${classId}`,
        cancel_url: `${frontendUrl}/dashboard/student?enrollment=cancel`
      });

      return res.status(200).json({ sessionId: session.id, checkoutUrl: session.url });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/enrollments/my",
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

      const enrollments = await prisma.enrollment.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: "desc" }
      });

      return res.status(200).json({ enrollments });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/salary/my",
  requireAuth,
  requireRole(["TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const teacher = await prisma.teacher.findUnique({
        where: { userId: req.user.id }
      });

      if (!teacher) {
        return res.status(404).json({ message: "Teacher profile not found" });
      }

      const salaries = await prisma.teacherSalary.findMany({
        where: { teacherId: teacher.id },
        orderBy: { createdAt: "desc" }
      });

      const salaryLogs = MONTHS_LIST.map(month => {
        const record = salaries.find(s => s.month.toLowerCase() === month.toLowerCase());
        if (record) {
          return {
            month,
            status: record.status,
            amount: record.amount,
            paymentDate: record.paymentDate
          };
        }
        return {
          month,
          status: "PENDING",
          amount: 25000,
          paymentDate: null
        };
      });

      return res.status(200).json({ salaryLogs });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/tuition/manual",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { studentId, month, amount, status } = req.body;

      if (!studentId || !month || !amount || !status) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const student = await prisma.student.findUnique({ where: { id: studentId } });
      if (!student) {
        return res.status(404).json({ message: "Student profile not found" });
      }

      const existing = await prisma.tuitionPayment.findFirst({
        where: { studentId, month }
      });

      let record;
      if (existing) {
        record = await prisma.tuitionPayment.update({
          where: { id: existing.id },
          data: {
            status,
            amount,
            paymentMethod: "CASH",
            paymentDate: status === "PAID" ? new Date() : null
          }
        });
      } else {
        record = await prisma.tuitionPayment.create({
          data: {
            studentId,
            month,
            amount,
            status,
            paymentMethod: "CASH",
            paymentDate: status === "PAID" ? new Date() : null
          }
        });
      }

      return res.status(200).json({ message: "Payment recorded successfully", record });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/salary/pay",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const { teacherId, month, amount, status } = req.body;

      if (!teacherId || !month || !amount || !status) {
        return res.status(400).json({ message: "All fields are required" });
      }

      const teacher = await prisma.teacher.findUnique({ where: { id: teacherId } });
      if (!teacher) {
        return res.status(404).json({ message: "Teacher profile not found" });
      }

      const existing = await prisma.teacherSalary.findFirst({
        where: { teacherId, month }
      });

      let record;
      if (existing) {
        record = await prisma.teacherSalary.update({
          where: { id: existing.id },
          data: {
            status,
            amount,
            paymentDate: status === "PAID" ? new Date() : null
          }
        });
      } else {
        record = await prisma.teacherSalary.create({
          data: {
            teacherId,
            month,
            amount,
            status,
            paymentDate: status === "PAID" ? new Date() : null
          }
        });
      }

      return res.status(200).json({ message: "Salary payout recorded successfully", record });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/students",
  requireAuth,
  requireRole(["ADMIN", "TEACHER"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const students = await prisma.student.findMany({
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      });
      return res.status(200).json({ students });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/teachers",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const teachers = await prisma.teacher.findMany({
        include: {
          user: {
            select: {
              name: true,
              email: true
            }
          }
        }
      });
      return res.status(200).json({ teachers });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/tuition/all",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const payments = await prisma.tuitionPayment.findMany({
        include: {
          student: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" }
      });
      return res.status(200).json({ payments });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.get(
  "/salary/all",
  requireAuth,
  requireRole(["ADMIN"]),
  async (req: AuthRequest, res: Response): Promise<any> => {
    try {
      const salaries = await prisma.teacherSalary.findMany({
        include: {
          teacher: {
            include: {
              user: {
                select: {
                  name: true,
                  email: true
                }
              }
            }
          }
        },
        orderBy: { createdAt: "desc" }
      });
      return res.status(200).json({ salaries });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ message: "Internal server error" });
    }
  }
);

router.post(
  "/webhook",
  async (req: any, res: Response): Promise<any> => {
    const sig = req.headers["stripe-signature"];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
      if (!sig || !endpointSecret) {
        throw new Error("Missing Stripe signature or webhook secret");
      }
      event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err: any) {
      console.error(`⚠️ Webhook signature verification failed:`, err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === "checkout.session.completed") {
      const session = event.data.object as any;
      const metadata = session.metadata;

      if (metadata && metadata.studentId) {
        const studentId = metadata.studentId;
        const amount = parseFloat(metadata.amount);
        const transactionId = session.payment_intent || session.id;
        const invoiceNumber = `INV-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

        if (metadata.type === "enrollment" || metadata.classId) {
          const classId = metadata.classId;
          console.log(`🎓 Verified enrollment payment for student: ${studentId}, classId: ${classId}, amount: ${amount}`);

          try {
            // Check if already exists to avoid duplicate webhook processing
            const existing = await prisma.enrollment.findUnique({
              where: {
                studentId_classId: {
                  studentId,
                  classId
                }
              }
            });

            if (!existing) {
              const count = await prisma.enrollment.count({
                where: { classId }
              });
              const rollNum = String(count + 1).padStart(4, "0");
              const cleanClassId = classId.replace(/[^a-zA-Z0-9]/g, "");
              const classRoll = `R-${cleanClassId}-${rollNum}`;
              const badge = `${classId}_badge`;

              await prisma.enrollment.create({
                data: {
                  studentId,
                  classId,
                  classRoll,
                  badge,
                  transactionId,
                  invoiceNumber,
                  amountPaid: amount,
                  status: "ACTIVE"
                }
              });
              console.log(`✅ Enrollment record created for student ${studentId} in class ${classId}.`);
            } else {
              console.log(`⚠️ Enrollment already exists for student ${studentId} in class ${classId}.`);
            }
          } catch (error) {
            console.error("❌ Failed to create enrollment record:", error);
          }
        } else if (metadata.month) {
          const month = metadata.month;
          console.log(`💰 Verified tuition payment for student: ${studentId}, month: ${month}, amount: ${amount}`);

          try {
            const existing = await prisma.tuitionPayment.findFirst({
              where: { studentId, month }
            });

            if (existing) {
              await prisma.tuitionPayment.update({
                where: { id: existing.id },
                data: {
                  status: "PAID",
                  amount,
                  paymentMethod: "ONLINE",
                  paymentDate: new Date()
                }
              });
            } else {
              await prisma.tuitionPayment.create({
                data: {
                  studentId,
                  month,
                  amount,
                  status: "PAID",
                  paymentMethod: "ONLINE",
                  paymentDate: new Date()
                }
              });
            }
            console.log(`✅ Tuition payment updated for student ${studentId}.`);
          } catch (error) {
            console.error("❌ Failed to update tuition payment record:", error);
          }
        }
      }
    }

    return res.status(200).json({ received: true });
  }
);

export default router;
