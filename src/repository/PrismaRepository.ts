import { PrismaClient } from "@prisma/client";
import type { IEventRepository } from "./EventRepository";
import { DatabaseError, EventNotFoundError } from "../lib/errors";
import { Ok, Err } from "../lib/result";
import type { CreateEventData, IEvent, IRSVP } from "../types/EventTypes";

const include = { attendees: true } as const;

function toIEvent(raw: any): IEvent {
    return {
        id: raw.id,
        title: raw.title,
        description: raw.description,
        location: raw.location,
        category: raw.category,
        capacity: raw.capacity,
        status: raw.status,
        startDatetime: raw.startDatetime,
        endDatetime: raw.endDatetime,
        organizerId: raw.organizerId,
        attendees: raw.attendees.map(toIRSVP),
        createdAt: raw.createdAt,
        updatedAt: raw.updatedAt,
    };
}

function toIRSVP(raw: any): IRSVP {
    return {
        id: raw.id,
        eventId: raw.eventId,
        userId: raw.userId,
        rsvpStatus: raw.rsvpStatus,
        createdAt: raw.createdAt,
    };
}

class PrismaRepository implements IEventRepository {
    private client: PrismaClient;

    constructor(client: PrismaClient) {
        this.client = client;
    }

    async getAllEvents() {
        try {
            const events = await this.client.event.findMany({ include });
            return Ok(events.map(toIEvent));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async getEventById(id: number) {
        try {
            const event = await this.client.event.findUnique({ where: { id }, include });
            if (!event) return Err(EventNotFoundError(`Event ${id} not found`));
            return Ok(toIEvent(event));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async createEvent(data: CreateEventData) {
        try {
            const event = await this.client.event.create({
                data: {
                    title: data.title,
                    description: data.description,
                    location: data.location,
                    category: data.category,
                    capacity: data.capacity,
                    status: data.status,
                    startDatetime: data.startDatetime,
                    endDatetime: data.endDatetime,
                    organizerId: data.organizerId,
                },
                include,
            });
            return Ok(toIEvent(event));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    async updateEvent(id: number, data: Partial<IEvent>) {
        try {
            const { attendees, id: _id, createdAt, ...fields } = data;
            const event = await this.client.event.update({
                where: { id },
                data: fields,
                include,
            });
            return Ok(toIEvent(event));
        } catch (e: any) {
            if (e?.code === "P2025") return Err(EventNotFoundError(`Event ${id} not found`));
            return Err(DatabaseError(String(e)));
        }
    }

    async deleteEvent(id: number) {
        try {
            await this.client.event.delete({ where: { id } });
            return Ok(undefined);
        } catch (e: any) {
            if (e?.code === "P2025") return Err(EventNotFoundError(`Event ${id} not found`));
            return Err(DatabaseError(String(e)));
        }
    }

    async findUserRsvp(id: number, userId: string) {
        try {
            const rsvp = await this.client.rSVP.findFirst({
                where: { eventId: id, userId },
            });
            return Ok(rsvp ? toIRSVP(rsvp) : null);
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }
}

export { PrismaRepository };
