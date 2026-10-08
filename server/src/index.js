import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";

const app = express();
const prisma = new PrismaClient();
const PORT = Number(process.env.PORT || 4000);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required");

app.use(cors({ origin: CLIENT_ORIGIN, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(cookieParser());

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true });

const registerSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().email().transform(v => v.toLowerCase()),
  password: z.string().min(8).max(128),
  role: z.enum(["STUDENT", "TEACHER"]).default("STUDENT")
});

const loginSchema = z.object({
  email: z.string().email().transform(v => v.toLowerCase()),
  password: z.string().min(1)
});

const classroomSchema = z.object({
  name: z.string().trim().min(2).max(100),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z.number().min(5).max(500)
});

const sessionSchema = z.object({
  classroomId: z.string().min(1),
  title: z.string().trim().min(2).max(120),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date()
});

const attendanceSchema = z.object({
  sessionId: z.string().min(1),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().min(0).max(10000).nullable().optional()
});

function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "8h" });
}

function setAuthCookie(res, token) {
  res.cookie("access_token", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/"
  });
}

function requireAuth(req, res, next) {
  try {
    const token = req.cookies.access_token;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session" });
  }
}

function requireRole(role) {
  return (req, res, next) => req.auth?.role === role
    ? next()
    : res.status(403).json({ error: "Forbidden" });
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid registration data" });

  const { name, email, password, role } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists) return res.status(409).json({ error: "Email is already registered" });

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.create({ data: { name, email, passwordHash, role } });
  setAuthCookie(res, signToken(user));
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post("/api/auth/login", authLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid credentials" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  setAuthCookie(res, signToken(user));
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("access_token", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" });
  res.status(204).end();
});

app.get("/api/auth/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth.sub },
    select: { id: true, name: true, email: true, role: true }
  });
  if (!user) return res.status(401).json({ error: "User not found" });
  res.json({ user });
});

app.get("/api/classrooms", requireAuth, async (req, res) => {
  const classrooms = await prisma.classroom.findMany({
    where: req.auth.role === "TEACHER" ? { teacherId: req.auth.sub } : undefined,
    include: { sessions: { orderBy: { startsAt: "desc" }, take: 20 } },
    orderBy: { createdAt: "desc" }
  });
  res.json({ classrooms });
});

app.post("/api/classrooms", requireAuth, requireRole("TEACHER"), async (req, res) => {
  const parsed = classroomSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid classroom data" });
  const classroom = await prisma.classroom.create({ data: { ...parsed.data, teacherId: req.auth.sub } });
  res.status(201).json({ classroom });
});

app.post("/api/sessions", requireAuth, requireRole("TEACHER"), async (req, res) => {
  const parsed = sessionSchema.safeParse(req.body);
  if (!parsed.success || parsed.data.endsAt <= parsed.data.startsAt) {
    return res.status(400).json({ error: "Invalid session data" });
  }
  const classroom = await prisma.classroom.findFirst({
    where: { id: parsed.data.classroomId, teacherId: req.auth.sub }
  });
  if (!classroom) return res.status(404).json({ error: "Classroom not found" });

  const session = await prisma.session.create({ data: parsed.data });
  res.status(201).json({ session });
});

app.get("/api/sessions/active", requireAuth, async (_req, res) => {
  const now = new Date();
  const sessions = await prisma.session.findMany({
    where: { startsAt: { lte: now }, endsAt: { gte: now } },
    include: { classroom: true },
    orderBy: { startsAt: "desc" }
  });
  res.json({ sessions });
});

app.post("/api/attendance", requireAuth, requireRole("STUDENT"), async (req, res) => {
  const parsed = attendanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid location data" });

  const now = new Date();
  const session = await prisma.session.findUnique({ where: { id: parsed.data.sessionId }, include: { classroom: true } });
  if (!session || now < session.startsAt || now > session.endsAt) {
    return res.status(400).json({ error: "This attendance session is not active" });
  }

  const distanceM = haversineMeters(
    parsed.data.latitude,
    parsed.data.longitude,
    session.classroom.latitude,
    session.classroom.longitude
  );

  if (distanceM > session.classroom.radiusM) {
    return res.status(403).json({
      error: "You are outside the classroom geofence",
      distanceM: Math.round(distanceM * 10) / 10,
      allowedRadiusM: session.classroom.radiusM
    });
  }

  try {
    const attendance = await prisma.attendance.create({
      data: {
        studentId: req.auth.sub,
        sessionId: session.id,
        latitude: parsed.data.latitude,
        longitude: parsed.data.longitude,
        accuracyM: parsed.data.accuracyM ?? null,
        distanceM
      }
    });
    res.status(201).json({ attendance: { id: attendance.id, recordedAt: attendance.recordedAt, distanceM } });
  } catch (error) {
    if (error.code === "P2002") return res.status(409).json({ error: "Attendance already recorded for this session" });
    throw error;
  }
});

app.get("/api/attendance/mine", requireAuth, requireRole("STUDENT"), async (req, res) => {
  const attendance = await prisma.attendance.findMany({
    where: { studentId: req.auth.sub },
    include: { session: { include: { classroom: true } } },
    orderBy: { recordedAt: "desc" },
    take: 50
  });
  res.json({ attendance });
});

app.get("/api/attendance/session/:sessionId", requireAuth, requireRole("TEACHER"), async (req, res) => {
  const session = await prisma.session.findFirst({
    where: { id: req.params.sessionId, classroom: { teacherId: req.auth.sub } }
  });
  if (!session) return res.status(404).json({ error: "Session not found" });

  const attendance = await prisma.attendance.findMany({
    where: { sessionId: session.id },
    include: { student: { select: { id: true, name: true, email: true } } },
    orderBy: { recordedAt: "asc" }
  });
  res.json({ attendance });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => console.log(`Attendance API listening on port ${PORT}`));
