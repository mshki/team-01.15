import { PrismaClient } from "@prisma/client";
import { Err, Ok, type Result } from "../lib/result";
import { UnexpectedDependencyError, type AuthError } from "./errors";
import type { IUserSink } from "./UserSink";

/**
 * Mirrors newly created auth users into the Prisma `User` table so that
 * Prisma-backed foreign keys (e.g. `RSVP.userId → User.id`,
 * `Event.organizerId → User.id`) can resolve.
 *
 * Uses `upsert` rather than `create` so it is idempotent: re-syncing an
 * existing user is a no-op. This makes it safe to seed demo users on every
 * boot without worrying about duplicates, and safe to retry after partial
 * failures.
 *
 * Only persists the columns the Prisma `User` model actually has today
 * (`id`, `email`). The richer auth fields (`displayName`, `role`,
 * `passwordHash`) stay in the auth-side repository — Prisma doesn't need
 * them to satisfy FKs.
 */
export class PrismaUserSink implements IUserSink {
  constructor(private readonly client: PrismaClient) {}

  async syncUser(user: {
    id: string;
    email: string;
    displayName: string;
    role: string;
  }): Promise<Result<void, AuthError>> {
    try {
      await this.client.user.upsert({
        where: { id: user.id },
        create: { id: user.id, email: user.email },
        update: { email: user.email },
      });
      return Ok(undefined);
    } catch (e) {
      return Err(
        UnexpectedDependencyError(
          `Unable to mirror user ${user.id} into Prisma: ${String(e)}`,
        ),
      );
    }
  }
}
