import { Ok, type Result } from "../lib/result";
import type { AuthError } from "./errors";

/**
 * A downstream sink for newly created users.
 *
 * The auth layer keeps users in `IUserRepository` (currently in-memory). Other
 * subsystems — most notably the Prisma-backed events database — need a
 * matching `User` row so foreign keys (e.g. `RSVP.userId → User.id`) resolve.
 *
 * `IUserSink` is the seam: `AdminUserService` (and any future signup flow)
 * calls `syncUser` after a successful `createUser`, and the wired
 * implementation decides whether to mirror that user into Prisma, do nothing
 * (memory mode), or something else later.
 *
 * Implementations must be idempotent: re-syncing an existing user must not
 * fail. This keeps demo-user seeding and re-runs safe.
 */
export interface IUserSink {
  syncUser(user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  }): Promise<Result<void, AuthError>>;
}

/**
 * No-op sink used in `"memory"` composition mode where there is no second
 * store to keep in sync.
 */
export class NoopUserSink implements IUserSink {
  async syncUser(): Promise<Result<void, AuthError>> {
    return Ok(undefined);
  }
}
