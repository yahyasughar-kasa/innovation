# GPS Attendance

A classroom attendance system with student/teacher authentication and server-side GPS geofencing.

## Stack

- React + Vite frontend
- Node.js + Express API
- PostgreSQL + Prisma
- bcrypt password hashing
- JWT stored in an HttpOnly, SameSite cookie
- Haversine distance calculation performed on the server

## Features

- Student and teacher accounts
- Teacher classroom management
- Configurable classroom latitude, longitude and radius
- Attendance sessions with start/end times
- Student GPS attendance check
- Server-side geofence enforcement
- Duplicate-attendance prevention
- Teacher attendance dashboard

## Local setup

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
2. Start PostgreSQL.
3. Run `npm install`.
4. Run `npm run db:generate`.
5. Run `npm run db:migrate`.
6. Run `npm run db:seed`.
7. Run `npm run dev`.

The API runs on port 4000 and the Vite client on port 5173.

### Demo accounts

After seeding:

- Teacher: `teacher@example.com` / `TeacherPass123!`
- Student: `student@example.com` / `StudentPass123!`

Change these passwords before using the application beyond local development.

## GPS security model

The browser obtains a location using `navigator.geolocation`. The browser submits latitude, longitude and accuracy to the API, but **the API is authoritative**. The API loads the classroom coordinates from PostgreSQL and calculates the distance using the Haversine formula. Attendance is accepted only when the measured distance is at or below the classroom radius.

GPS coordinates can be spoofed by a compromised device/browser, so this is a geofence control rather than proof of physical presence. For higher-assurance deployments, combine it with QR rotation, device attestation, Wi-Fi/BLE proximity or institutional SSO.

## Production requirements

Use HTTPS, a managed PostgreSQL database, a high-entropy JWT secret, secure cookie settings, backups, monitoring and appropriate privacy/retention policies.
