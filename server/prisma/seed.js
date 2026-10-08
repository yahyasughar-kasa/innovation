import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const teacherPassword = await bcrypt.hash("TeacherPass123!", 12);
  const studentPassword = await bcrypt.hash("StudentPass123!", 12);

  const teacher = await prisma.user.upsert({
    where: { email: "teacher@example.com" },
    update: {},
    create: { name: "Demo Teacher", email: "teacher@example.com", passwordHash: teacherPassword, role: "TEACHER" }
  });

  const student = await prisma.user.upsert({
    where: { email: "student@example.com" },
    update: {},
    create: { name: "Demo Student", email: "student@example.com", passwordHash: studentPassword, role: "STUDENT" }
  });

  const classroom = await prisma.classroom.create({
    data: {
      name: "Demo Classroom",
      latitude: 0.3476,
      longitude: 32.5825,
      radiusM: 30,
      teacherId: teacher.id
    }
  });

  await prisma.session.create({
    data: {
      title: "Demo Attendance Session",
      classroomId: classroom.id,
      startsAt: new Date(Date.now() - 30 * 60 * 1000),
      endsAt: new Date(Date.now() + 90 * 60 * 1000)
    }
  });

  console.log({ teacher: teacher.email, student: student.email, classroom: classroom.name });
}

main().finally(() => prisma.$disconnect());
