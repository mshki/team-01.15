import { PrismaClient } from "@prisma/client";
import type { Event, EventDesc, EventAttendee } from "@prisma/client";
import { DatabaseError, EventNotFoundError } from "../lib/errors";
import { EventError } from "../lib/errors";
import { Ok, Err, Result } from "../lib/result";
import { IEvent, } from "../types/EventTypes";

export interface IEventRepository {
    getAllEvents(): Promise<Result<IEvent[], EventError>>;
    getEventById(id: number): Promise<Result<IEvent, EventError>>;
    createEvent(event: IEvent): Promise<Result<IEvent, EventError>>;
    updateEvent(id: number, event: Partial<IEvent>): Promise<Result<IEvent, EventError>>;
    deleteEvent(id: number): Promise<Result<void, EventError>>;
}
