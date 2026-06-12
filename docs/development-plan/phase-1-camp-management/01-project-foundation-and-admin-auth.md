# Step 01: Project Foundation and Admin Authentication

## Human Tasks Required

- [ ] Provide the initial super admin username and any required bootstrap secret values before deploying outside local development.
- [ ] Confirm whether production admin sessions should use JWTs or server-managed sessions if stakeholders have a preference.

## Spec References

- `docs/specs.md` - "1. Overview"
- `docs/specs.md` - "2. Technical Architecture"
- `docs/specs.md` - "Stack"
- `docs/specs.md` - "Key Technical Considerations"
- `docs/specs.md` - "3. User Roles & Authentication"
- `docs/specs.md` - "Roles"
- `docs/specs.md` - "Authentication"
- `docs/specs.md` - "Admin User"

## Goal

Create the runnable application foundation for the protected admin system, including database connectivity, admin authentication, role-based access, and a responsive admin shell that later camp-management steps can build on.

## Agent Tasks

- [ ] Inspect the repository and scaffold missing frontend, backend, database, test, lint, and build tooling using the stack in the spec.
- [ ] Add environment configuration examples for database connection, auth secrets, and local development ports without committing real secrets.
- [ ] Create the admin user data model with username, password hash, role, creator reference, and active status.
- [ ] Implement secure password hashing and authentication endpoints for login, logout, and current-user lookup.
- [ ] Add auth middleware that protects admin API routes and distinguishes `super_admin` from `camp_admin`.
- [ ] Build a responsive admin layout with navigation placeholders for camp configuration, people, imports, dorms, check-in, and reports.
- [ ] Implement super-admin user management for creating admins, deactivating admins, and resetting passwords.
- [ ] Add seed or bootstrap behavior for the first super admin that is safe for local development and explicit for production.
- [ ] Add tests for authentication success, failed login, inactive accounts, role authorization, and protected-route access.

## Verification

- [ ] Run dependency installation successfully.
- [ ] Run database migrations or schema generation successfully.
- [ ] Run the repository lint command.
- [ ] Run the repository typecheck command.
- [ ] Run the repository test command and confirm auth and authorization tests pass.
- [ ] Run the repository build command.
- [ ] Manually verify a super admin can sign in, create a camp admin, deactivate that admin, and block the deactivated account from signing in.

## Completion Criteria

- [ ] A developer can start the app locally and reach a protected admin interface.
- [ ] Admin routes reject unauthenticated users.
- [ ] Role checks prevent camp admins from performing super-admin-only user management.
- [ ] No secrets are committed to source control.
