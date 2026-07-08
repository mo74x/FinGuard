# FinGuard

A backend API for financial identity verification, built with NestJS, PostgreSQL, Redis, and Prisma. The system handles the full lifecycle of identity verification cases, from applicant registration and document upload through reviewer assessment to final disposition, with built-in audit logging, encrypted document storage, and automated data retention.

---

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Authentication and Authorization](#authentication-and-authorization)
- [Document Security](#document-security)
- [Verification Case State Machine](#verification-case-state-machine)
- [Audit Logging](#audit-logging)
- [Data Retention and Compliance](#data-retention-and-compliance)
- [Idempotency](#idempotency)
- [Environment Variables](#environment-variables)
- [Getting Started](#getting-started)
- [Running Tests](#running-tests)
- [Scripts Reference](#scripts-reference)

---

## Architecture Overview

FinGuard is structured as a modular NestJS application with clear separation of concerns:

```
Client Request
    |
    v
[NestJS HTTP Layer]
    |-- Helmet (security headers)
    |-- ValidationPipe (input validation via class-validator)
    |-- DomainExceptionFilter (structured error responses)
    |
    v
[Guards: JwtAuthGuard -> RolesGuard -> CaseOwnershipGuard]
    |
    v
[Controllers] --> [Services] --> [Prisma ORM] --> [PostgreSQL]
                      |
                      +--> [Redis] (refresh tokens, idempotency keys)
                      |
                      +--> [BullMQ] (background retention jobs)
                      |
                      +--> [Local Encrypted Storage] (document blobs)
```

All API responses follow a consistent envelope format:

```json
{
  "data": { ... },
  "error": null
}
```

On error:

```json
{
  "data": null,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable description"
  }
}
```

---

## Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Framework | NestJS 11 | Application framework |
| Language | TypeScript 5 | Type safety |
| Database | PostgreSQL 15 | Primary data store |
| ORM | Prisma 7 | Database access and migrations |
| Cache / Session | Redis 7 | Refresh tokens, idempotency keys, BullMQ transport |
| Authentication | Passport + JWT | Stateless authentication |
| Password Hashing | bcrypt | Secure password storage |
| Document Encryption | AES-256-GCM | Encryption at rest for uploaded documents |
| Background Jobs | BullMQ | Scheduled data retention processing |
| Input Validation | class-validator + class-transformer | Request DTO validation |
| Config Validation | Zod | Startup environment variable validation |
| Security Headers | Helmet | HTTP security hardening |
| Containerization | Docker Compose | Local PostgreSQL and Redis provisioning |

---

## Project Structure

```
src/
  main.ts                           Application entrypoint
  app.module.ts                     Root module
  app.controller.ts                 Health/root controller
  app.service.ts                    Root service

  config/
    env.validation.ts               Zod schema for environment variables

  prisma/
    prisma.module.ts                Prisma module registration
    prisma.service.ts               PrismaClient wrapper with lifecycle hooks

  redis/
    redis.module.ts                 Global Redis provider (ioredis)

  auth/
    auth.controller.ts              Registration, login, refresh, logout endpoints
    auth.service.ts                 JWT generation, refresh token rotation, credential validation
    dto/
      auth.dto.ts                   RegisterApplicantDto, LoginDto, RefreshTokenDto
    strategies/
      jwt.strategy.ts               Passport JWT strategy
    utils/
      hash.util.ts                  bcrypt hashing utility

  verification-cases/
    verification-cases.controller.ts  Status transition endpoint
    verification-cases.service.ts     Transactional state transitions with pessimistic locking
    verification-cases.module.ts      Module wiring
    verification-state-machine.service.ts  Pure domain state machine with transition graph
    dto/
      transition-status.dto.ts      TransitionStatusDto with validation decorators
    exceptions/
      invalid-state-transition.exception.ts  Domain exception for illegal transitions

  documents/
    documents.controller.ts         Upload, signed URL generation, and document viewing
    documents.service.ts            Encryption, storage, signed URL generation, decryption
    utils/
      crypto.util.ts                AES-256-GCM encryption, HMAC signing, key derivation

  audit/
    audit.module.ts                 Audit module registration
    audit.service.ts                Transaction-scoped audit log writes, log retrieval

  retention/
    retention.module.ts             BullMQ queue registration and module wiring
    retention.processor.ts          Background worker that anonymizes expired rejected cases
    retention.scheduler.ts          Cron schedule registration (daily at 02:00)

  common/
    guards/
      jwt-auth.guard.ts             Passport JWT authentication guard
      roles.guard.ts                Role-based access control guard
      case-ownership.guard.ts       Verifies applicant owns the requested case
    decorators/
      current-user.decorator.ts     Extracts authenticated user from request
      roles.decorator.ts            Sets required roles metadata on route handlers
    interceptors/
      idempotency.interceptor.ts    Redis-backed idempotency key handling
    filters/
      domain-exception.filter.ts    Maps DomainException to 422 responses
    exceptions/
      domain.exception.ts           Abstract base class for domain-level errors

prisma/
  schema.prisma                     Database schema definition
  migrations/                       Prisma migration history

docker-compose.yml                  PostgreSQL 15 and Redis 7 containers
```

---

## Database Schema

### Models

**Applicant** -- End users who submit identity verification cases.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| email | String | Unique |
| passwordHash | String | bcrypt hash |
| fullName | String | |
| dateOfBirth | DateTime | |
| createdAt | DateTime | Auto-set |
| updatedAt | DateTime | Auto-updated |

**Reviewer** -- Internal staff who review submitted cases.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| email | String | Unique |
| passwordHash | String | bcrypt hash |
| role | Role | REVIEWER or ADMIN |
| createdAt | DateTime | Auto-set |
| updatedAt | DateTime | Auto-updated |

**VerificationCase** -- A single identity verification request.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| applicantId | String | Foreign key to Applicant |
| reviewerId | String (nullable) | Foreign key to Reviewer |
| status | CaseStatus | Defaults to DRAFT |
| rejectionReason | String (nullable) | Set when status is REJECTED |
| createdAt | DateTime | Auto-set |
| updatedAt | DateTime | Auto-updated |

**Document** -- An encrypted file attached to a verification case.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| caseId | String | Foreign key to VerificationCase |
| type | DocumentType | ID_CARD, PASSPORT, or PROOF_OF_ADDRESS |
| encryptedStoragePath | String | Relative path to encrypted blob on disk |
| uploadedAt | DateTime | Auto-set |
| verifiedAt | DateTime (nullable) | |

**AuditLog** -- Immutable record of every significant system action.

| Column | Type | Notes |
|---|---|---|
| id | UUID | Primary key |
| entityType | String | e.g. "VerificationCase" |
| entityId | String | ID of the affected entity |
| action | String | e.g. "STATUS_CHANGED", "COMPLIANCE_ANONYMIZATION" |
| actorId | String (nullable) | ID of the user who performed the action |
| actorRole | ActorRole | APPLICANT, REVIEWER, ADMIN, or SYSTEM |
| previousState | JSON (nullable) | Snapshot before the change |
| newState | JSON (nullable) | Snapshot after the change |
| ipAddress | String (nullable) | Client IP address |
| createdAt | DateTime | Auto-set |

### Enums

| Enum | Values |
|---|---|
| Role | REVIEWER, ADMIN |
| ActorRole | APPLICANT, REVIEWER, ADMIN, SYSTEM |
| CaseStatus | DRAFT, SUBMITTED, UNDER_REVIEW, ADDITIONAL_INFO_REQUIRED, VERIFIED, REJECTED |
| DocumentType | ID_CARD, PASSPORT, PROOF_OF_ADDRESS |

---

## API Reference

### Authentication

All auth endpoints are under the `/auth` prefix.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/applicant/register` | None | Register a new applicant. Body: `{ email, password, fullName, dateOfBirth }` |
| POST | `/auth/applicant/login` | None | Login as an applicant. Body: `{ email, password }` |
| POST | `/auth/reviewer/login` | None | Login as a reviewer. Body: `{ email, password }` |
| POST | `/auth/refresh` | None | Rotate refresh token. Body: `{ refreshToken }` |
| POST | `/auth/logout` | JWT | Invalidate refresh token. Deletes the token from Redis. |

Successful login and registration responses return:

```json
{
  "data": {
    "accessToken": "eyJhbG...",
    "refreshToken": "eyJhbG..."
  },
  "error": null
}
```

### Verification Cases

All case endpoints are under the `/verification-cases` prefix.

| Method | Path | Auth | Guards | Description |
|---|---|---|---|---|
| PATCH | `/verification-cases/:id/status` | JWT | CaseOwnershipGuard | Transition a case to a new status. Supports Idempotency-Key header. Body: `{ targetStatus, actorId, actorRole, rejectionReason? }` |

### Documents

Document endpoints are nested under the verification cases path.

| Method | Path | Auth | Guards | Description |
|---|---|---|---|---|
| POST | `/verification-cases/:id/documents` | JWT | RolesGuard (APPLICANT), CaseOwnershipGuard | Upload an encrypted document. Multipart form: `file` (binary) + `type` (enum). |
| GET | `/verification-cases/:id/documents/:documentId/signed-url` | JWT | CaseOwnershipGuard | Generate a short-lived (5 min) signed URL for document retrieval. |
| GET | `/verification-cases/documents/view?id=...&expires=...&sig=...` | Signed URL | None (HMAC-verified) | Retrieve and decrypt a document. Protected by HMAC signature and expiration, not by JWT. |

---

## Authentication and Authorization

### JWT Token Architecture

The system uses a dual-token strategy:

- **Access Token**: Short-lived (15 minutes). Signed with `JWT_ACCESS_SECRET`. Sent as a Bearer token in the `Authorization` header. Contains the user ID, email, and role in the payload.
- **Refresh Token**: Long-lived (7 days). Signed with `JWT_REFRESH_SECRET`. Stored as a bcrypt hash in Redis with a 7-day TTL. Rotated on every use (the old token is invalidated and a new one is issued).

### Guard Chain

Guards execute in the order they are listed in `@UseGuards()`:

1. **JwtAuthGuard** -- Validates the access token via Passport. Attaches the decoded payload to `req.user`.
2. **RolesGuard** -- Reads the `@Roles()` decorator metadata and checks that `req.user.role` matches one of the allowed roles. Returns 403 if not.
3. **CaseOwnershipGuard** -- Extracts the case ID from route params (`:id` or `:caseId`), queries the database for the case, and verifies that the authenticated applicant is the owner. Reviewers and Admins bypass this check automatically.

### Identity Spaces

The system maintains two separate identity tables:

- **Applicant**: External users who create and manage verification cases. Their role is always `APPLICANT` and is not stored in the database (it is inferred).
- **Reviewer**: Internal staff with either `REVIEWER` or `ADMIN` role, stored in the `role` column of the Reviewer table.

---

## Document Security

### Encryption at Rest

All uploaded documents are encrypted before being written to disk using AES-256-GCM:

1. A random 16-byte initialization vector (IV) is generated per file.
2. The file buffer is encrypted using AES-256-GCM with the `DOCUMENT_ENCRYPTION_KEY`.
3. The resulting blob is packed as: `[IV (16 bytes)] + [Auth Tag (16 bytes)] + [Ciphertext]`.
4. The packed blob is written to the `storage/` directory with a generated filename.
5. Only the relative storage key is stored in the database, never the encryption key.

### Signed URLs

Documents are never served directly. Instead:

1. An authenticated user requests a signed URL for a specific document.
2. The server generates a URL containing the document ID, an expiration timestamp (5 minutes), and an HMAC-SHA256 signature computed over `documentId:expiresAt` using the `JWT_ACCESS_SECRET`.
3. When the signed URL is accessed, the server validates the signature and expiration before decrypting and serving the file.
4. This endpoint is intentionally not protected by JWT. The HMAC signature is the authorization mechanism, allowing the URL to be shared with downstream systems if needed.

---

## Verification Case State Machine

Cases follow a strict state machine. Only the transitions defined below are permitted. Any illegal transition throws an `InvalidStateTransitionException` (HTTP 422).

```
DRAFT --> SUBMITTED --> UNDER_REVIEW --> VERIFIED (terminal)
                            |
                            +--> REJECTED (terminal)
                            |
                            +--> ADDITIONAL_INFO_REQUIRED --> SUBMITTED
```

### Transition Table

| From | Allowed Targets |
|---|---|
| DRAFT | SUBMITTED |
| SUBMITTED | UNDER_REVIEW |
| UNDER_REVIEW | VERIFIED, REJECTED, ADDITIONAL_INFO_REQUIRED |
| ADDITIONAL_INFO_REQUIRED | SUBMITTED |
| VERIFIED | (none -- terminal state) |
| REJECTED | (none -- terminal state) |

### Concurrency Safety

State transitions use PostgreSQL's `SELECT ... FOR UPDATE` (pessimistic row locking) inside a database transaction. This prevents race conditions when two requests attempt to transition the same case simultaneously. The second request will block until the first completes, then evaluate the transition against the updated state.

Self-transitions (e.g. attempting SUBMITTED -> SUBMITTED) are treated as idempotent no-ops. The case is returned without modification and no audit log is written.

---

## Audit Logging

Every state transition writes an immutable audit log entry within the same database transaction as the state change. This guarantees atomicity: if the audit write fails, the state change is rolled back.

Each audit log entry records:

- The entity type and ID that was modified
- The action performed (e.g. `STATUS_CHANGED`, `COMPLIANCE_ANONYMIZATION`)
- The actor who performed it (user ID and role)
- A JSON snapshot of the state before and after the change
- The client IP address
- A timestamp

Audit logs can be queried by entity type and entity ID for compliance review.

---

## Data Retention and Compliance

The system includes an automated retention policy for rejected verification cases, implemented as a BullMQ background job.

### How It Works

1. A cron job runs daily at 02:00 AM (configurable via BullMQ repeat pattern).
2. It queries for all cases with status `REJECTED` where the `updatedAt` timestamp is older than the configured retention period (`REJECTED_CASE_RETENTION_DAYS`, default 30 days).
3. For each eligible case, inside a database transaction:
   - The associated applicant record is anonymized (name set to `ANONYMIZED_USER`, email replaced, password hash scrubbed).
   - An audit log entry is created with action `COMPLIANCE_ANONYMIZATION` and actor role `SYSTEM`.
   - All encrypted document files on disk are deleted. The database record is preserved with the storage path set to `DELETED_BY_RETENTION_POLICY`.
4. If any individual case fails to process, the error is logged and the job continues with the remaining cases.

---

## Idempotency

The `PATCH /verification-cases/:id/status` endpoint supports idempotent retries via the `Idempotency-Key` HTTP header. This is implemented using a Redis-backed interceptor.

### Behavior

1. If no `Idempotency-Key` header is present, the request is processed normally.
2. If the key is present and a cached response exists in Redis, the cached response is returned immediately without executing the controller.
3. If the key is present but no cached response exists, the key is atomically claimed using `SETNX` (set if not exists). If `SETNX` returns 0, it means a concurrent request with the same key is currently being processed, and the server responds with HTTP 409 (Conflict).
4. On successful execution, the response body is cached in Redis with a 24-hour TTL, scoped to the user ID and request path.

---

## Environment Variables

All environment variables are validated at startup using Zod. The application will fail to start if any required variable is missing or invalid.

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | `development`, `production`, or `test` |
| `PORT` | No | `3000` | HTTP server port |
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string |
| `REDIS_HOST` | No | `localhost` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `JWT_ACCESS_SECRET` | Yes | -- | Secret for signing access tokens (minimum 16 characters) |
| `JWT_REFRESH_SECRET` | Yes | -- | Secret for signing refresh tokens (minimum 16 characters) |
| `DOCUMENT_ENCRYPTION_KEY` | Yes | -- | 64-character hex string (32 bytes) for AES-256-GCM |
| `REJECTED_CASE_RETENTION_DAYS` | No | `30` | Number of days before rejected cases are anonymized |

### Generating Secrets

```bash
# Generate a JWT secret (32 bytes, base64-encoded)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# Generate a document encryption key (32 bytes, hex-encoded, produces 64 hex characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Getting Started

### Prerequisites

- Node.js 20 or later
- Docker and Docker Compose (for PostgreSQL and Redis)
- npm

### Setup

1. Clone the repository:

```bash
git clone https://github.com/mo74x/FinGuard.git
cd FinGuard
```

2. Install dependencies:

```bash
npm install
```

3. Start the database and cache services:

```bash
docker compose up -d
```

This starts PostgreSQL on port 5432 and Redis on port 6379.

4. Create your `.env` file (see Environment Variables above):

```bash
cp .env.example .env
# Edit .env with your secrets
```

5. Run database migrations:

```bash
npx prisma migrate dev
```

6. Generate the Prisma client:

```bash
npx prisma generate
```

7. Start the development server:

```bash
npm run start:dev
```

The server will be available at `http://localhost:3000`.

---

## Running Tests

```bash
# Unit tests
npm run test

# Unit tests in watch mode
npm run test:watch

# End-to-end tests
npm run test:e2e

# Test coverage report
npm run test:cov
```

### Existing Test Coverage

- **VerificationStateMachineService**: Data-driven test matrix covering all 36 state combinations (6 states x 6 states). Validates every legal transition is permitted and every illegal transition throws `InvalidStateTransitionException`.
- **VerificationCasesService (integration)**: Tests transactional state transitions and concurrent request handling with pessimistic locking. Verifies that audit logs are written atomically with state changes.

---

## Scripts Reference

| Script | Command | Description |
|---|---|---|
| `start` | `npm run start` | Start the application |
| `start:dev` | `npm run start:dev` | Start in watch mode (auto-restart on changes) |
| `start:debug` | `npm run start:debug` | Start in debug mode with watch |
| `start:prod` | `npm run start:prod` | Start the production build |
| `build` | `npm run build` | Compile TypeScript to JavaScript |
| `lint` | `npm run lint` | Run ESLint with auto-fix |
| `format` | `npm run format` | Run Prettier on all source files |
| `test` | `npm run test` | Run unit tests |
| `test:watch` | `npm run test:watch` | Run tests in watch mode |
| `test:cov` | `npm run test:cov` | Run tests with coverage report |
| `test:e2e` | `npm run test:e2e` | Run end-to-end tests |

---

## License

This project is UNLICENSED.
