import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from "../src/generated/client/index.js";
import bcrypt from "bcrypt";
import dotenv from "dotenv";

dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Cleaning up database...");

  // Delete in correct order to handle foreign keys
  await prisma.tuitionPayment.deleteMany({});
  await prisma.teacherSalary.deleteMany({});
  await prisma.attendance.deleteMany({});
  await prisma.result.deleteMany({});
  await prisma.oneToOneBooking.deleteMany({});
  await prisma.availabilitySlot.deleteMany({});
  await prisma.supportSession.deleteMany({});
  await prisma.classroomMember.deleteMany({});
  await prisma.classroom.deleteMany({});
  await prisma.student.deleteMany({});
  await prisma.teacher.deleteMany({});
  await prisma.guardian.deleteMany({});
  await prisma.satisfactionRating.deleteMany({});
  await prisma.session.deleteMany({});
  await prisma.account.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.exam.deleteMany({});

  console.log("🌱 Database cleaned.");

  const hashedPassword = await bcrypt.hash("password123", 10);

  // 1. Create Admin User
  const adminUser = await prisma.user.create({
    data: {
      name: "Admin User",
      email: "admin@ems.com",
      password: hashedPassword,
      role: "ADMIN",
      emailVerified: true,
      status: "ACTIVE"
    }
  });
  console.log("👤 Seeded Admin User: admin@ems.com");

  // 2. Create Teachers
  const teacherData = [
    { name: "John Doe", email: "john@ems.com", subject: "Bangla", rating: 4.8, salary: 50000, teacherId: "T001" },
    { name: "Sarah Smith", email: "sarah@ems.com", subject: "English", rating: 4.6, salary: 45000, teacherId: "T002" },
    { name: "Fahim Rahman", email: "fahim@ems.com", subject: "Math", rating: 4.9, salary: 55000, teacherId: "T003" },
    { name: "Karim Islam", email: "karim@ems.com", subject: "Science", rating: 4.2, salary: 40000, teacherId: "T004" }
  ];

  const seededTeachers = [];
  for (const t of teacherData) {
    const user = await prisma.user.create({
      data: {
        name: t.name,
        email: t.email,
        password: hashedPassword,
        role: "TEACHER",
        emailVerified: true,
        status: "ACTIVE"
      }
    });

    const teacher = await prisma.teacher.create({
      data: {
        userId: user.id,
        teacherId: t.teacherId,
        department: t.subject,
        qualification: "BSc / MSc in Education",
        subject: t.subject,
        rating: t.rating,
        salary: t.salary,
        role: "TEACHER"
      }
    });
    seededTeachers.push({ ...teacher, user });
    console.log(`👤 Seeded Teacher: ${t.email}`);
  }

  // 3. Create Students
  const studentData = [
    { name: "Riya Ratri", email: "riya@ems.com", class: "08", roll: "101", phone: "01711111111", year: "2026", status: "ACTIVE" },
    { name: "Hasan Mahmud", email: "hasan@ems.com", class: "08", roll: "102", phone: "01822222222", year: "2026", status: "ACTIVE" },
    { name: "Rahim Ali", email: "rahim@ems.com", class: "08", roll: "103", phone: "01933333333", year: "2026", status: "INACTIVE" },
    { name: "Sultana Kamal", email: "sultana@ems.com", class: "09", roll: "201", phone: "01544444444", year: "2026", status: "ACTIVE" },
    { name: "Nabil Ahmed", email: "nabil@ems.com", class: "10", roll: "301", phone: "01655555555", year: "2026", status: "SUSPENDED" }
  ];

  const seededStudents = [];
  for (const s of studentData) {
    const user = await prisma.user.create({
      data: {
        name: s.name,
        email: s.email,
        password: hashedPassword,
        role: "STUDENT",
        emailVerified: true,
        status: s.status
      }
    });

    const student = await prisma.student.create({
      data: {
        userId: user.id,
        class: s.class,
        roll: s.roll,
        department: "General",
        schoolName: "RAS Academic School",
        email: s.email,
        phone: s.phone,
        year: s.year,
        role: "STUDENT"
      }
    });
    seededStudents.push({ ...student, user });
    console.log(`👤 Seeded Student: ${s.email}`);
  }

  // 4. Create Classrooms
  const class8Fahim = await prisma.classroom.create({
    data: {
      title: "Class 8 Math Hub",
      classroomCode: "M8MATH",
      teacherId: seededTeachers[2].id // Fahim (Math)
    }
  });

  const class8John = await prisma.classroom.create({
    data: {
      title: "Class 8 Bangla Lecture",
      classroomCode: "B8LANG",
      teacherId: seededTeachers[0].id // John Doe (Bangla)
    }
  });

  // Enroll Riya, Hasan, Rahim in both classrooms
  const classroom8Ids = [class8Fahim.id, class8John.id];
  for (const classId of classroom8Ids) {
    for (let i = 0; i < 3; i++) {
      await prisma.classroomMember.create({
        data: {
          classroomId: classId,
          studentId: seededStudents[i].id
        }
      });
    }
  }
  console.log("🏫 Seeded Classrooms and enrolled students.");

  // 5. Seed Attendance Logs
  // Riya (90% attendance in Math: 9 Present, 1 Absent)
  // Hasan (80% attendance in Math: 8 Present, 2 Absent)
  // Rahim (70% attendance in Math: 7 Present, 3 Absent)
  const mathClassroomId = class8Fahim.id;
  const attendanceFractions = [
    { studentId: seededStudents[0].id, presentDays: 9, absentDays: 1 }, // Riya (90%)
    { studentId: seededStudents[1].id, presentDays: 8, absentDays: 2 }, // Hasan (80%)
    { studentId: seededStudents[2].id, presentDays: 7, absentDays: 3 }  // Rahim (70%)
  ];

  for (const fraction of attendanceFractions) {
    const baseDate = new Date();
    // Seed Present records
    for (let i = 0; i < fraction.presentDays; i++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() - i);
      await prisma.attendance.create({
        data: {
          studentId: fraction.studentId,
          classroomId: mathClassroomId,
          date,
          status: "PRESENT"
        }
      });
    }
    // Seed Absent records
    for (let j = 0; j < fraction.absentDays; j++) {
      const date = new Date(baseDate);
      date.setDate(baseDate.getDate() - (fraction.presentDays + j));
      await prisma.attendance.create({
        data: {
          studentId: fraction.studentId,
          classroomId: mathClassroomId,
          date,
          status: "ABSENT"
        }
      });
    }
  }
  console.log("📅 Seeded Attendance Logs to match wireframe ratios.");

  // 6. Support Sessions
  const supportSessionsData = [
    { teacherId: seededTeachers[2].id, date: new Date(), time: "10:00 AM", subject: "Math", duration: 45, status: "SCHEDULED", totalJoinStudent: 20 },
    { teacherId: seededTeachers[0].id, date: new Date(Date.now() - 86400000), time: "11:30 AM", subject: "Bangla", duration: 60, status: "COMPLETED", totalJoinStudent: 25 },
    { teacherId: seededTeachers[1].id, date: new Date(Date.now() - 172800000), time: "02:00 PM", subject: "English", duration: 45, status: "CANCELLED", totalJoinStudent: 15 },
    { teacherId: seededTeachers[2].id, date: new Date(Date.now() - 259200000), time: "04:00 PM", subject: "Math", duration: 45, status: "COMPLETED", totalJoinStudent: 30 }
  ];

  for (const session of supportSessionsData) {
    await prisma.supportSession.create({
      data: {
        teacherId: session.teacherId,
        date: session.date,
        time: session.time,
        meetLink: "https://meet.google.com/abc-defg-hij",
        subject: session.subject,
        status: session.status,
        duration: session.duration,
        totalJoinStudent: session.totalJoinStudent
      }
    });
  }
  console.log("💻 Seeded Support Sessions.");

  // 7. Exams & Results
  const exam = await prisma.exam.create({
    data: {
      name: "Midterm Exam 2026",
      examDate: new Date()
    }
  });

  const resultsData = [
    { studentId: seededStudents[0].id, examId: exam.id, subject: "Math", writtenMark: 75, mcqMark: 20, result: "PASS" as const },
    { studentId: seededStudents[1].id, examId: exam.id, subject: "Math", writtenMark: 65, mcqMark: 18, result: "PASS" as const },
    { studentId: seededStudents[2].id, examId: exam.id, subject: "Math", writtenMark: 20, mcqMark: 5, result: "FAIL" as const }, // Fail
    { studentId: seededStudents[3].id, examId: exam.id, subject: "Math", writtenMark: 80, mcqMark: 20, result: "PASS" as const }
  ];

  for (const res of resultsData) {
    await prisma.result.create({
      data: {
        studentId: res.studentId,
        examId: res.examId,
        subject: res.subject,
        writtenMark: res.writtenMark,
        mcqMark: res.mcqMark,
        totalMark: res.writtenMark + res.mcqMark,
        result: res.result
      }
    });
  }
  console.log("📝 Seeded Exams and Results (75% Pass success rate).");

  // 8. Tuition Payments (Finance)
  const tuitionPayments = [
    { studentId: seededStudents[0].id, month: "January", amount: 1500, status: "PAID" as const, paymentMethod: "ONLINE" as const },
    { studentId: seededStudents[1].id, month: "January", amount: 1500, status: "PAID" as const, paymentMethod: "CASH" as const },
    { studentId: seededStudents[2].id, month: "January", amount: 1500, status: "UNPAID" as const, paymentMethod: null },
    { studentId: seededStudents[3].id, month: "January", amount: 1500, status: "PENDING" as const, paymentMethod: null },
    { studentId: seededStudents[0].id, month: "February", amount: 1500, status: "REFUNDED" as const, paymentMethod: "ONLINE" as const, paymentDate: new Date() },
    { studentId: seededStudents[1].id, month: "February", amount: 1500, status: "PAID" as const, paymentMethod: "ONLINE" as const, paymentDate: new Date() }
  ];

  for (const payment of tuitionPayments) {
    await prisma.tuitionPayment.create({
      data: {
        studentId: payment.studentId,
        month: payment.month,
        amount: payment.amount,
        status: payment.status,
        paymentMethod: payment.paymentMethod,
        paymentDate: payment.status === "PAID" || payment.status === "REFUNDED" ? new Date() : null
      }
    });
  }
  console.log("💰 Seeded Tuition Payments (with online, cash, and refunded statuses).");

  // 9. Teacher Salaries
  const teacherSalaries = [
    { teacherId: seededTeachers[0].id, month: "January", amount: 50000, status: "PAID" as const },
    { teacherId: seededTeachers[1].id, month: "January", amount: 45000, status: "PAID" as const },
    { teacherId: seededTeachers[2].id, month: "January", amount: 55000, status: "PENDING" as const },
    { teacherId: seededTeachers[0].id, month: "February", amount: 50000, status: "UNPAID" as const }
  ];

  for (const sal of teacherSalaries) {
    await prisma.teacherSalary.create({
      data: {
        teacherId: sal.teacherId,
        month: sal.month,
        amount: sal.amount,
        status: sal.status === "UNPAID" ? "PENDING" : sal.status, // UNPAID maps to PENDING in TeacherSalary
        paymentDate: sal.status === "PAID" ? new Date() : null
      }
    });
  }
  console.log("💵 Seeded Teacher Salaries (showing paid, pending, and due balances).");

  // 10. Satisfaction Ratings
  const satisfactionData = [
    { class: "08", subject: "Bangla", studentRate: 4.8, guardianRate: 4.7, avgRate: 4.75 },
    { class: "08", subject: "English", studentRate: 4.6, guardianRate: 4.5, avgRate: 4.55 },
    { class: "08", subject: "Math", studentRate: 4.9, guardianRate: 4.8, avgRate: 4.85 },
    { class: "09", subject: "Bangla", studentRate: 4.5, guardianRate: 4.4, avgRate: 4.45 },
    { class: "09", subject: "Math", studentRate: 4.7, guardianRate: 4.6, avgRate: 4.65 }
  ];

  for (const sat of satisfactionData) {
    await prisma.satisfactionRating.create({
      data: {
        class: sat.class,
        subject: sat.subject,
        studentRate: sat.studentRate,
        guardianRate: sat.guardianRate,
        avgRate: sat.avgRate
      }
    });
  }
  console.log("😊 Seeded Satisfaction Analytics data.");

  console.log("🚀 Database seeding completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
