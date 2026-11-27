# API Documentation

## Health
- GET /api/health
- Returns service status.

## Authentication
- POST /api/login
- Body: { "username": "admin", "password": "password123" }

## Dashboard
- GET /api/dashboard
- Returns summary counts for students, teachers, and pending fees.

## Students
- GET /api/students
- POST /api/students
- Body includes student_code, full_name, class_name, section, parent_name, parent_phone.

## Attendance
- GET /api/attendance
- POST /api/attendance
- Body includes student_id, status, marked_by.

## Notifications
- GET /api/notifications
