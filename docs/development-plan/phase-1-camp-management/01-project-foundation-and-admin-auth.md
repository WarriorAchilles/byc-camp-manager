# Step 1.01 - Project Foundation and Admin Auth

## Things for a Human to Complete

- Confirm the exact backend framework if the repo does not already establish one. The spec allows Node.js with Express or similar.
- Choose the authentication style for admin API access: session cookies or JWT.
- Provide local, staging, and production environment values for PostgreSQL connection strings, auth secrets, and allowed origins.
- Decide the first deployment target on AWS, or leave deployment wiring as environment-agnostic until infrastructure is chosen.
- Provide the initial super admin email address and a secure temporary password process.

## Goal

Create the application foundation required by every later step: React SPA, Node.js API, PostgreSQL access, admin authentication, role-based authorization, and basic deployment/environment structure.

## Agent Implementation Tasks

- Establish the project structure for frontend, backend, shared types if used, migrations, tests, and environment configuration.
- Add PostgreSQL connection management and migration tooling.
- Implement admin users with email/password authentication, password hashing, active/deactivated status, and role values `super_admin` and `camp_admin`.
- Add protected API middleware for admin routes.
- Add authorization helpers so only super admins can manage settings and users.
- Build admin login/logout UI and a minimal authenticated admin shell.
- Add super admin user management for creating admins, deactivating admins, and resetting passwords.
- Add seed or setup tooling for the first super admin without exposing secrets in source control.

## Acceptance Criteria

- An admin can log in, stay authenticated across page refreshes, and log out.
- Protected API routes reject unauthenticated requests.
- Camp admins and super admins are distinguishable in both API and UI code.
- Super admins can create, deactivate, and reset passwords for other admin users.
- No public self-service admin registration or public forgot-password flow exists.
- Local setup documentation explains required environment variables without committing secret values.

## Master Spec References

- [2. Technical Architecture](../../specs.md#2-technical-architecture) - stack, REST API, PostgreSQL, AWS hosting, and protected admin routes.
- [3. User Roles & Authentication](../../specs.md#3-user-roles--authentication) - super admin and camp admin roles, email/password auth, password resets, and no public admin signup.
- [Admin User](../../specs.md#admin-user) - admin user data model.
