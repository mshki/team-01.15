import { PrismaClient } from "@prisma/client";
import type { Event, EventDesc, EventAttendee } from "@prisma/client";
import { DatabaseError, EventNotFoundError } from "../lib/errors";
import { EventError } from "../lib/errors";
import { Ok, Err, Result } from "../lib/result";
import { IEvent, IEventDesc, IEventAttendee } from "../types/EventTypes";

export interface IEventRepository {
    getAllEvents(): Promise<Result<IEvent[], EventError>>;
    getEventById(id: string): Promise<Result<IEvent, EventError>>;
    createEvent(event: IEvent): Promise<Result<IEvent, EventError>>;
    updateEvent(id: string, event: Partial<IEvent>): Promise<Result<IEvent, EventError>>;
    deleteEvent(id: string): Promise<Result<void, EventError>>;
}

type PrismaEventFull = Event & {
    attendees: EventAttendee[];
    eventDesc: EventDesc | null;
};

function mapToIEvent(e: PrismaEventFull): IEvent {
    const attendees: IEventAttendee[] = e.attendees.map(a => ({
        event_id: a.eventId,
        userId: a.userId,
        rsvpStatus: a.rsvp,
        createdAt: a.createdAt,
    }));

    const desc = e.eventDesc;
    const eventDesc: IEventDesc = desc
        ? {
              id: desc.id,
              eventId: desc.eventId,
              title: desc.title,
              desc: desc.desc,
              location: desc.location,
              category: desc.category,
              datetime: desc.datetime,
              organizerId: desc.organizer,
              capacity: desc.capacity,
              status: desc.status,
              createdAt: desc.createdAt,
              updatedAt: desc.updatedAt,
          }
        : ({} as IEventDesc);

    return { id: e.id, title: e.title, createdAt: e.createdAt, attendees, eventDesc };
}

const INCLUDE = { attendees: true, eventDesc: true } as const;

class EventRepository implements IEventRepository {
    private prisma: PrismaClient;

    constructor() {
        this.prisma = new PrismaClient();
    }

    async getAllEvents(): Promise<Result<IEvent[], EventError>> {
        try {
            const events = await this.prisma.event.findMany({ include: INCLUDE });
            return Ok(events.map(mapToIEvent));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async getEventById(id: string): Promise<Result<IEvent, EventError>> {
        try {
            const event = await this.prisma.event.findUnique({
                where: { id: parseInt(id) },
                include: INCLUDE,
            });
            if (!event) return Err(EventNotFoundError(`Event ${id} not found`));
            return Ok(mapToIEvent(event));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async createEvent(event: IEvent): Promise<Result<IEvent, EventError>> {
        try {
            const created = await this.prisma.event.create({
                data: {
                    title: event.title,
                    ...(event.eventDesc && {
                        eventDesc: {
                            create: {
                                title: event.eventDesc.title,
                                desc: event.eventDesc.desc,
                                location: event.eventDesc.location,
                                category: event.eventDesc.category,
                                datetime: event.eventDesc.datetime,
                                organizer: event.eventDesc.organizerId,
                                capacity: event.eventDesc.capacity,
                                status: event.eventDesc.status,
                            },
                        },
                    }),
                },
                include: INCLUDE,
            });
            return Ok(mapToIEvent(created));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async updateEvent(id: string, event: Partial<IEvent>): Promise<Result<IEvent, EventError>> {
        try {
            const numId = parseInt(id);
            const existing = await this.prisma.event.findUnique({ where: { id: numId } });
            if (!existing) return Err(EventNotFoundError(`Event ${id} not found`));

            const updated = await this.prisma.event.update({
                where: { id: numId },
                data: {
                    ...(event.title !== undefined && { title: event.title }),
                    ...(event.eventDesc && {
                        eventDesc: {
                            update: {
                                ...(event.eventDesc.title !== undefined && { title: event.eventDesc.title }),
                                ...(event.eventDesc.desc !== undefined && { desc: event.eventDesc.desc }),
                                ...(event.eventDesc.location !== undefined && { location: event.eventDesc.location }),
                                ...(event.eventDesc.category !== undefined && { category: event.eventDesc.category }),
                                ...(event.eventDesc.datetime !== undefined && { datetime: event.eventDesc.datetime }),
                                ...(event.eventDesc.organizerId !== undefined && { organizer: event.eventDesc.organizerId }),
                                ...(event.eventDesc.capacity !== undefined && { capacity: event.eventDesc.capacity }),
                                ...(event.eventDesc.status !== undefined && { status: event.eventDesc.status }),
                            },
                        },
                    }),
                },
                include: INCLUDE,
            });
            return Ok(mapToIEvent(updated));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async deleteEvent(id: string): Promise<Result<void, EventError>> {
        try {
            const numId = parseInt(id);
            const existing = await this.prisma.event.findUnique({ where: { id: numId } });
            if (!existing) return Err(EventNotFoundError(`Event ${id} not found`));
            await this.prisma.event.delete({ where: { id: numId } });
            return Ok(undefined);
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }
}

export function createRepository(): IEventRepository {
    return new EventRepository();
}
