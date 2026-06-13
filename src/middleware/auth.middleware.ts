import type { Request, Response, NextFunction } from "express";
import { auth } from "../auth.js";
import jwt from "jsonwebtoken";

export interface AuthRequest extends Request {
  user?: typeof auth.$Infer.Session.user;
  session?: typeof auth.$Infer.Session.session;
}

export const requireAuth = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (session) {
      req.user = session.user;
      req.session = session.session;
      return next();
    }

    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.split(" ")[1];

      const decoded = jwt.verify(
        token,
        process.env.JWT_SECRET || "default_jwt_secret_key_123"
      ) as any;

      req.user = {
        id: decoded.id,
        email: decoded.email,
        role: decoded.role,
        name: decoded.name || "",
        emailVerified: true,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      return next();
    }

    return res.status(401).json({
      message: "Please login first (Unauthorized)"
    });
  } catch (error) {
    return res.status(401).json({
      message: "Invalid token or session expired. Please login again.",
      error
    });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Please login first (Unauthorized)"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "Permission denied (Forbidden Access)"
      });
    }

    next();
  };
};