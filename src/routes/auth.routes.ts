import express from "express";
import { prisma } from "../db.js";
import redis from "../redis.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { sendOTPEmail } from "../utils/mailer.js";

const router: express.Router = express.Router();

router.post("/signup", async (req, res) => {
  try {
    const { password, name } = req.body;
    const email = req.body.email.toLowerCase();

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

    const pendingData = {
      email,
      hashedPassword,
      name,
      role: "UNASSIGNED",
    };

    await redis.set(`pending_signup:${email}`, JSON.stringify(pendingData), "EX", 600);

    await sendOTPEmail(email, otp).catch(console.error);

    return res.status(200).json({
      message: "An OTP has send to your mail. Please verify."
    });
  } catch (error: any) {
    console.error("Signup error:", error);
    return res.status(500).json({
      message: "Signup process failed.",
      error: error.message || error
    });
  }
});

router.post("/otp/verify", async (req, res) => {
  try {
    const { otp } = req.body;
    const email = req.body.email.toLowerCase();

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

      const newUser = await prisma.user.create({
        data: {
          name: pendingData.name,
          email: pendingData.email,
          password: pendingData.hashedPassword,
          role: pendingData.role,
          emailVerified: true,
        },
      });

      await redis.del(`pending_signup:${email}`);

      const token = jwt.sign(
        {
          id: newUser.id,
          email: newUser.email,
          role: newUser.role,
          enrolledClassIds: []
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
          role: newUser.role,
          enrolledClassIds: []
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

      let enrolledClassIds: string[] = [];
      if (updatedUser.role === "STUDENT") {
        const student = await prisma.student.findUnique({
          where: { userId: updatedUser.id },
          include: { enrollments: true }
        });
        if (student) {
          enrolledClassIds = student.enrollments.map(e => e.classId);
        }
      }

      const token = jwt.sign(
        {
          id: updatedUser.id,
          email: updatedUser.email,
          role: updatedUser.role,
          enrolledClassIds
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
          role: updatedUser.role,
          enrolledClassIds
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
    const { password } = req.body;
    const email = req.body.email.toLowerCase();

    const user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({
        message: "Invalid email or password."
      });
    }

    if (!user.emailVerified) {
      const otp = Math.floor(100000 + Math.random() * 900000).toString();

      await redis.set(`otp:${email}`, otp, "EX", 300);

      await sendOTPEmail(email, otp).catch(console.error);

      return res.status(403).json({
        message: "Your email is not verified. An OTP has been sent to your email, please verify.",
        emailVerified: false,
      });
    }

    let enrolledClassIds: string[] = [];
    if (user.role === "STUDENT") {
      const student = await prisma.student.findUnique({
        where: { userId: user.id },
        include: { enrollments: true }
      });
      if (student) {
        enrolledClassIds = student.enrollments.map(e => e.classId);
      }
    }

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        enrolledClassIds
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
        role: user.role,
        enrolledClassIds
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
            class: "Pending", // Admin will add manually
            roll: "Pending",  // Admin will add manually
            department: "Pending", // Admin will add manually
            schoolName: profileData.schoolName, // Institution Name
            phone: "Pending", // Admin will add manually
            email: usr.email,
            role: "STUDENT",
          },
        });
      } else if (role === "TEACHER") {
        await tx.teacher.create({
          data: {
            userId: usr.id,
            teacherId: `TCH-${Math.floor(1000 + Math.random() * 9000)}`, // Auto generate
            department: profileData.department,
            qualification: "Pending", // Admin will add manually
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
        role: updatedUser.role,
        enrolledClassIds: []
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
        role: updatedUser.role,
        enrolledClassIds: []
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