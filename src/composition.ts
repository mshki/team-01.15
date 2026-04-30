import { CreateAdminUserService } from "./auth/AdminUserService";
import { CreateAuthController } from "./auth/AuthController";
import { CreateAuthService } from "./auth/AuthService";
import { CreateInMemoryUserRepository } from "./auth/InMemoryUserRepository";
import { CreatePasswordHasher } from "./auth/PasswordHasher";
import { NoopUserSink, type IUserSink } from "./auth/UserSink";
import { PrismaUserSink } from "./auth/PrismaUserSink";
import { CreateApp } from "./app";
import type { IApp } from "./contracts";
import { CreateLoggingService } from "./service/LoggingService";
import type { ILoggingService } from "./service/LoggingService";
import { createInMemoryEventRepository } from "./repository/InMemoryEventRepository";
import { createEventController } from "./controllers/EventController";
import { createEventService } from "./service/EventService";
import type { IEventRepository } from "./repository/EventRepository";
import path from "node:path";
import { PrismaClient } from "@prisma/client/index";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createPrismaRepository } from "./repository/PrismaRepository";


export function createComposedApp(mode: "memory" | "prisma" | "test_prisma", logger?: ILoggingService): IApp {
  const resolvedLogger = logger ?? CreateLoggingService();

  // TODO: should we rename createPrismaRepository to createPrismaEventRepository
  const dbUrl =
    mode === "test_prisma"
      ? process.env.TEST_DB_URL!.replace(/^file:/, "")
      : process.env.DATABASE_URL!.replace(/^file:/, "");

  // Build the Prisma client once (in Prisma modes) so the events repository
  // and the user sink share the same connection.
  const prismaClient =
    mode === "memory"
      ? null
      : new PrismaClient({
          adapter: new PrismaBetterSqlite3({
            url: path.resolve(dbUrl),
          }),
        });

  const eventRepo: IEventRepository =
    prismaClient === null
      ? createInMemoryEventRepository()
      : createPrismaRepository(prismaClient);

  // In memory mode there is no second store to mirror users into; in Prisma
  // modes we mirror new users so RSVP/Event FKs resolve.
  const userSink: IUserSink =
    prismaClient === null ? new NoopUserSink() : new PrismaUserSink(prismaClient);

  const authUsers = CreateInMemoryUserRepository();
  const passwordHasher = CreatePasswordHasher();
  const authService = CreateAuthService(authUsers, passwordHasher);
  const adminUserService = CreateAdminUserService(authUsers, passwordHasher, userSink);
  const authController = CreateAuthController(authService, adminUserService, resolvedLogger);
  const eventService = createEventService(eventRepo, resolvedLogger);
  const eventController = createEventController(eventService, resolvedLogger);

  return CreateApp(eventController, authController, resolvedLogger, eventService);
}
