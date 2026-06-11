import type { Request, Response, NextFunction } from "express";
import { auth } from "../auth.js";

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

    if (!session) {
      return res.status(401).json({ message: "Please login first (Unauthorized)" });
    }

    req.user = session.user;
    req.session = session.session;

    next();
  } catch (error) {
    res.status(500).json({ message: "Server Error (Auth Middleware Error)", error });
  }
};

export const requireRole = (allowedRoles: string[]) => {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ message: "Please login first (Unauthorized)" });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Unauthorized access (Forbidden)" });
    }

    next();
  };
};