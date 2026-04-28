import { CreateAdminUserService } from "./auth/AdminUserService";
import { CreateAuthController } from "./auth/AuthController";
import { CreateAuthService } from "./auth/AuthService";
import { CreateInMemoryUserRepository } from "./auth/InMemoryUserRepository";
import { CreatePasswordHasher } from "./auth/PasswordHasher";
import { CreateApp } from "./app";
import type { IApp } from "./contracts";
import { CreateLoggingService } from "./service/LoggingService";
import type { ILoggingService } from "./service/LoggingService";
import { createInMemoryEventRepository } from "./repository/InMemoryEventRepository";
import { createEventController } from "./controllers/EventController";
import { createEventService } from "./service/EventService";
import type { IEventRepository } from "./repository/EventRepository";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createPrismaRepository } from "./repository/PrismaRepository";


export function createComposedApp(logger?: ILoggingService, repoOverride?: IEventRepository): IApp {
  const resolvedLogger = logger ?? CreateLoggingService();

  let eventRepo: IEventRepository = repoOverride ?? createInMemoryEventRepository();

  if (!repoOverride && process.env.REPO_MODE === "prisma") {
    const rawUrl = process.env.DATABASE_URL!;
    const dbPath = path.resolve(rawUrl.replace(/^file:/, ""));
    const adapter = new PrismaBetterSqlite3({ url: dbPath });
    const prisma = new PrismaClient({ adapter });
    eventRepo = createPrismaRepository(prisma);
  }

  const authUsers = CreateInMemoryUserRepository();
  const passwordHasher = CreatePasswordHasher();
  const authService = CreateAuthService(authUsers, passwordHasher);
  const adminUserService = CreateAdminUserService(authUsers, passwordHasher);
  const authController = CreateAuthController(authService, adminUserService, resolvedLogger);
  const eventService = createEventService(eventRepo, resolvedLogger);
  const eventController = createEventController(eventService, resolvedLogger);

  return CreateApp(eventController, authController, resolvedLogger, eventService);
}
