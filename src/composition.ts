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
import path from "node:path";
import { PrismaClient } from "@prisma/client/index";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { createPrismaRepository } from "./repository/PrismaRepository";


export function createComposedApp(mode: "memory" | "prisma", logger?: ILoggingService): IApp {
  const resolvedLogger = logger ?? CreateLoggingService();

  // TODO: should we rename createPrismaRepository to createPrismaEventRepository
  const eventRepo =
    mode === "prisma"
      ? createPrismaRepository(
          new PrismaClient({
            adapter: new PrismaBetterSqlite3({
              url: path.resolve(process.env.DATABASE_URL!.replace(/^file:/, ""))
            }),
          }),
        )
      : createInMemoryEventRepository();

  const authUsers = CreateInMemoryUserRepository();
  const passwordHasher = CreatePasswordHasher();
  const authService = CreateAuthService(authUsers, passwordHasher);
  const adminUserService = CreateAdminUserService(authUsers, passwordHasher);
  const authController = CreateAuthController(authService, adminUserService, resolvedLogger);
  const eventService = createEventService(eventRepo, resolvedLogger);
  const eventController = createEventController(eventService, resolvedLogger);

  return CreateApp(eventController, authController, resolvedLogger, eventService);
}
