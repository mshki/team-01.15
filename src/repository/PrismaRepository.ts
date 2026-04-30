import { PrismaClient, RSVPStatus } from "@prisma/client";
import type { IEventRepository } from "./EventRepository";
import { DatabaseError, EventNotFoundError, ValidationError } from "../lib/errors";
import type { EventError } from "../lib/errors";
import { Ok, Err } from "../lib/result";
import type { CreateEventData, IEvent, IRSVP } from "../types/EventTypes";

/**
 * Sentinel error thrown inside a $transaction callback to abort the
 * transaction with a typed EventError. Throwing inside the callback causes
 * Prisma to roll back any writes already issued in the same transaction,
 * which is exactly what we want for the cancel + promote pair.
 */
class AbortTx extends Error {
    constructor(public readonly eventError: EventError) {
        super(eventError.message);
    }
}

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
                where: { eventId: id, userId: userId },
            });
            return Ok(rsvp ? toIRSVP(rsvp) : null);
        } catch (e: any) {
            if (e?.code === "P2025") return Err(EventNotFoundError(`Event ${id} not found`));
            return Err(DatabaseError(String(e)));
        }
    }

    async saveRsvp(id: number, userId: string, status: RSVPStatus) {
        try {
            await this.client.rSVP.upsert({
                where: {
                    eventId_userId: {eventId: id, userId: userId}
                },
                update: { rsvpStatus: status },
                create: {
                    id: `rsvp_${id}_${userId}_${Date.now().toString(36)}`,
                    eventId: id,
                    userId,
                    rsvpStatus: status,
                },
            });
            return Ok(undefined);
          } catch (e) {
                return Err(DatabaseError(String(e)));
          }
    }

    /**
     * Pushes the search filter into the database instead of fetching every
     * event and filtering in JS at the service layer. The where-clause is
     * a single SQL query: status = PUBLISHED, endDatetime >= now, and an
     * OR across the four searchable fields when `query` is non-empty.
     *
     * `query` is expected to already be trimmed + lowercased by the
     * service. We pass it straight to `contains`, which Prisma compiles to
     * SQL `LIKE`. SQLite's `LIKE` is case-insensitive for ASCII by
     * default, which is what gets us the case-insensitivity for free —
     * Prisma's `mode: "insensitive"` filter is Postgres/Mongo only and
     * isn't available here.
     *
     * An empty query means "no text filter": just return every published
     * event whose endDatetime is in the future.
     */
    async searchEvents(query: string) {
        try {
            const now = new Date();
            const where: any = {
                status: "PUBLISHED",
                endDatetime: { gte: now },
            };
            if (query !== "") {
                where.OR = [
                    { title: { contains: query } },
                    { description: { contains: query } },
                    { location: { contains: query } },
                    { category: { contains: query } },
                ];
            }
            const events = await this.client.event.findMany({ where, include });
            return Ok(events.map(toIEvent));
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    /**
     * Atomically cancels a user's RSVP and promotes the earliest WAITLISTED
     * attendee if a seat opened up. Both writes happen inside one
     * `prisma.$transaction(...)`, so either both commit or both roll back.
     *
     * The transaction also re-reads the event at the end so the returned
     * snapshot reflects the post-write state without a second round trip.
     * If anything throws inside the callback (including our AbortTx), Prisma
     * rolls back every write issued in the same transaction.
     */
    async cancelRsvpWithPromotion(eventId: number, userId: string) {
        try {
            const updated = await this.client.$transaction(async (tx) => {
                // 1. Load the event with current attendees inside the transaction.
                //    Reading inside the tx (rather than relying on a prior fetch)
                //    keeps the decision about who to promote consistent with the
                //    state we actually write against.
                const event = await tx.event.findUnique({
                    where: { id: eventId },
                    include,
                });
                if (!event) {
                    throw new AbortTx(
                        EventNotFoundError(`Event ${eventId} not found`)
                    );
                }

                // 2. Find the user's RSVP. Refuse if missing or already cancelled.
                const existing = event.attendees.find((r) => r.userId === userId);
                if (!existing) {
                    throw new AbortTx(
                        ValidationError(
                            `No RSVP found for user ${userId} on event ${eventId}`
                        )
                    );
                }
                if (existing.rsvpStatus === "CANCELLED") {
                    throw new AbortTx(
                        ValidationError(
                            `RSVP for user ${userId} on event ${eventId} is already cancelled`
                        )
                    );
                }

                const wasGoing = existing.rsvpStatus === "GOING";

                // 3. Cancel the user's RSVP.
                await tx.rSVP.update({
                    where: { id: existing.id },
                    data: { rsvpStatus: "CANCELLED" },
                });

                // 4. Promote the earliest WAITLISTED RSVP if a seat opened up.
                //    Cancelling a WAITLISTED RSVP doesn't free a seat, so this
                //    branch is gated on the cancelled RSVP having been GOING.
                //    `event.capacity != null` covers both null and undefined.
                if (wasGoing && event.capacity != null) {
                    const goingCount = event.attendees.filter(
                        (r) => r.rsvpStatus === "GOING" && r.id !== existing.id
                    ).length;
                    if (goingCount < event.capacity) {
                        const earliestWaitlisted = event.attendees
                            .filter((r) => r.rsvpStatus === "WAITLISTED")
                            .sort(
                                (a, b) =>
                                    new Date(a.createdAt).getTime() -
                                    new Date(b.createdAt).getTime()
                            )[0];
                        if (earliestWaitlisted) {
                            await tx.rSVP.update({
                                where: { id: earliestWaitlisted.id },
                                data: { rsvpStatus: "GOING" },
                            });
                        }
                    }
                }

                // 5. Re-read the event so the returned snapshot reflects the
                //    new attendee statuses without a second round trip.
                const refreshed = await tx.event.findUnique({
                    where: { id: eventId },
                    include,
                });
                return refreshed!;
            });

            return Ok(toIEvent(updated));
        } catch (e) {
            if (e instanceof AbortTx) return Err(e.eventError);
            return Err(DatabaseError(String(e)));
        }
    }
    async filterPublishedEvents(timeframe: string, category: string | null) {
        try {
            const now = new Date();

            const where: any = {
                status: "PUBLISHED",
                endDatetime: { gte: now },
            };

            if (category && category.trim() !== "") {
                where.category = category.trim().toLowerCase();
            }

            if (timeframe === "week") {
                const endOfWeek = new Date(now);
                endOfWeek.setDate(now.getDate() + 7);
                where.startDatetime = { lte: endOfWeek };
            }

            if (timeframe === "weekend") {
                const day = now.getDay();
                const daysUntilSaturday = day === 6 ? 0 : (6 - day + 7) % 7;

                const saturday = new Date(now);
                saturday.setDate(now.getDate() + daysUntilSaturday);
                saturday.setHours(0, 0, 0, 0);

                const sundayEnd = new Date(saturday);
                sundayEnd.setDate(saturday.getDate() + 1);
                sundayEnd.setHours(23, 59, 59, 999);

                where.startDatetime = {
                    gte: saturday,
                    lte: sundayEnd,
                };
            }

        const events = await this.client.event.findMany({
            where,
            include,
        });

        return Ok(events.map(toIEvent));
    } catch (e) {
        return Err(DatabaseError(String(e)));
    }
}
}

export function createPrismaRepository(client: PrismaClient) {
    return new PrismaRepository(client);
}
