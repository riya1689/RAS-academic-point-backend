import express from "express";
import { prisma } from "../db.js";
import redis from "../redis.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendOTPEmail } from "../utils/mailer.js";

const router: express.Router = express.Router();

router.post("/signup/student", async (req, res) => {
  try {
    const { email, password, name, class: className, roll, department, schoolName, phone } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { student: true, teacher: true, guardian: true }
    });

    if (existingUser) {
      const isOrphaned = !existingUser.student && !existingUser.teacher && !existingUser.guardian;
      if (isOrphaned) {
        await prisma.user.delete({ where: { id: existingUser.id } });
      } else {
        return res.status(400).json({ message: "Email already exists" });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await redis.set(`otp:${email}`, otp, "EX", 300);

    const studentData = {
      email,
      hashedPassword,
      name,
      role: "STUDENT",
      className,
      roll,
      department,
      schoolName,
      phone
    };

    await redis.set(`pending_signup:${email}`, JSON.stringify(studentData), "EX", 600);

    sendOTPEmail(email, otp).catch(console.error);

    return res.status(200).json({
      message: "An OTP has send to your mail. Please verify."
    });
  } catch (error: any) {
    console.error("Student signup error:", error);
    return res.status(500).json({
      message: "Student signup process failed.",
      error: error.message || error
    });
  }
});

router.post("/signup/teacher", async (req, res) => {
  try {
    const { email, password, name, teacherId, department, qualification } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { student: true, teacher: true, guardian: true }
    });

    if (existingUser) {
      const isOrphaned = !existingUser.student && !existingUser.teacher && !existingUser.guardian;
      if (isOrphaned) {
        await prisma.user.delete({ where: { id: existingUser.id } });
      } else {
        return res.status(400).json({ message: "Email already exists" });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await redis.set(`otp:${email}`, otp, "EX", 300);

    const finalTeacherId = teacherId || `TCH-${Math.floor(1000 + Math.random() * 9000)}`;

    const teacherData = {
      email,
      hashedPassword,
      name,
      role: "TEACHER",
      teacherId: finalTeacherId,
      department,
      qualification
    };

    await redis.set(`pending_signup:${email}`, JSON.stringify(teacherData), "EX", 600);

    sendOTPEmail(email, otp).catch(console.error);

    return res.status(200).json({
      message: "An OTP has send to your mail. Please verify."
    });
  } catch (error: any) {
    console.error("Teacher signup error:", error);
    return res.status(500).json({
      message: "Teacher signup process failed.",
      error: error.message || error
    });
  }
});

router.post("/signup/guardian", async (req, res) => {
  try {
    const { email, password, name, studentId } = req.body;

    const existingUser = await prisma.user.findUnique({
      where: { email },
      include: { student: true, teacher: true, guardian: true }
    });

    if (existingUser) {
      const isOrphaned = !existingUser.student && !existingUser.teacher && !existingUser.guardian;
      if (isOrphaned) {
        await prisma.user.delete({ where: { id: existingUser.id } });
      } else {
        return res.status(400).json({ message: "Email already exists" });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    await redis.set(`otp:${email}`, otp, "EX", 300);

    const guardianData = {
      email,
      hashedPassword,
      name,
      role: "GUARDIAN",
      studentId
    };

    await redis.set(`pending_signup:${email}`, JSON.stringify(guardianData), "EX", 600);

    sendOTPEmail(email, otp).catch(console.error);

    return res.status(200).json({
      message: "An OTP has send to your mail. Please verify."
    });
  } catch (error: any) {
    console.error("Guardian signup error:", error);
    return res.status(500).json({
      message: "Guardian signup process failed.",
      error: error.message || error
    });
  }
});

router.post("/otp/verify", async (req, res) => {
  try {
    const { email, otp } = req.body;

    const cachedOtp = await redis.get(`otp:${email}`);

    if (!cachedOtp || cachedOtp !== otp) {
      return res.status(400).json({
        message: "Invalid OTP or OTP has expired."
      });
    }

    await redis.del(`otp:${email}`);

    const pendingSignupString = await redis.get(`pending_signup:${email}`);

    if (pendingSignupString) {
      const pendingData = JSON.parse(pendingSignupString);

      const newUser = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            name: pendingData.name,
            email: pendingData.email,
            password: pendingData.hashedPassword,
            role: pendingData.role,
            emailVerified: true,
          },
        });

        if (pendingData.role === "STUDENT") {
          await tx.student.create({
            data: {
              userId: user.id,
              class: pendingData.className,
              roll: pendingData.roll,
              department: pendingData.department,
              schoolName: pendingData.schoolName,
              phone: pendingData.phone,
              email: pendingData.email,
              role: "STUDENT",
            },
          });
        } else if (pendingData.role === "TEACHER") {
          await tx.teacher.create({
            data: {
              userId: user.id,
              teacherId: pendingData.teacherId,
              department: pendingData.department,
              qualification: pendingData.qualification,
              role: "TEACHER",
            },
          });
        } else if (pendingData.role === "GUARDIAN") {
          await tx.guardian.create({
            data: {
              userId: user.id,
              studentId: pendingData.studentId,
              role: "GUARDIAN",
            },
          });
        }

        return user;
      });

      await redis.del(`pending_signup:${email}`);

      const token = jwt.sign(
        {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role
        },
        process.env.JWT_SECRET || "default_jwt_secret_key_123",
        { expiresIn: "7d" }
      );

      return res.status(201).json({
        message: "Registration and OTP verification successful!",
        token,
        user: {
          id: newUser.id,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role
        },
      });
    } else {
      const user = await prisma.user.findUnique({
        where: { email }
      });

      if (!user) {
        return res.status(404).json({
          message: "User not found."
        });
      }

      const updatedUser = await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true },
      });

      const token = jwt.sign(
        {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role
        },
        process.env.JWT_SECRET || "default_jwt_secret_key_123",
        { expiresIn: "7d" }
      );

      return res.status(200).json({
        message: "Google account activated successfully!",
        token,
        user: {
          id: updatedUser.id,
          name: updatedUser.name,
          email: updatedUser.email,
          role: updatedUser.role
        },
      });
    }
  } catch (error: any) {
    console.error("OTP verification error:", error);
    return res.status(500).json({
      message: "OTP verification process failed.",
      error: error.message || error
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({
        message: "Invalid email or password."
      });
    }

    if (!user.emailVerified) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      await redis.set(`otp:${email}`, otp, "EX", 300);

      sendOTPEmail(email, otp).catch(console.error);

      return res.status(403).json({
        message: "Your email is not verified. An OTP has been sent to your email, please verify.",
        emailVerified: false,
      });
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role
      },
      process.env.JWT_SECRET || "default_jwt_secret_key_123",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Login successful!",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Login process failed.",
      error
    });
  }
});

router.post("/complete-profile", async (req, res) => {
  try {
    const { userId, role, profileData } = req.body;

    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({
        message: "User not found."
      });
    }

    const updatedUser = await prisma.$transaction(async (tx) => {
      const usr = await tx.user.update({
        where: { id: userId },
        data: { role },
      });

      if (role === "STUDENT") {
        await tx.student.create({
          data: {
            userId: usr.id,
            class: profileData.className,
            roll: profileData.roll,
            department: profileData.department,
            schoolName: profileData.schoolName,
            phone: profileData.phone,
            email: usr.email,
            role: "STUDENT",
          },
        });
      } else if (role === "TEACHER") {
        await tx.teacher.create({
          data: {
            userId: usr.id,
            teacherId: profileData.teacherId,
            department: profileData.department,
            qualification: profileData.qualification,
            role: "TEACHER",
          },
        });
      } else if (role === "GUARDIAN") {
        await tx.guardian.create({
          data: {
            userId: usr.id,
            studentId: profileData.studentId,
            role: "GUARDIAN",
          },
        });
      }

      return usr;
    });

    const token = jwt.sign(
      {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role
      },
      process.env.JWT_SECRET || "default_jwt_secret_key_123",
      { expiresIn: "7d" }
    );

    return res.status(200).json({
      message: "Profile completion successful!",
      token,
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role
      },
    });
  } catch (error) {
    return res.status(500).json({
      message: "Profile completion process failed.",
      error
    });
  }
});

export default router;