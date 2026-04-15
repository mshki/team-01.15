import { IEventAttendee, RSVPStatus } from "../types/EventTypes";
import { Ok, Err, Result } from "../lib/result";
import { EventError, EventNotFoundError, DatabaseError } from "../lib/errors";

// ── In-memory store ──────────────────────────────────────────────────────────
// Keyed by eventId, each entry is an ordered array of attendees (insertion order
// determines waitlist priority — earliest createdAt = first promoted).
const rsvpStore = new Map<number, IEventAttendee[]>();

export interface IRSVPRepository {
    getAttendeesByEvent(eventId: number): Promise<Result<IEventAttendee[], EventError>>;
    getAttendee(eventId: number, userId: string): Promise<Result<IEventAttendee | null, EventError>>;
    upsertAttendee(attendee: IEventAttendee): Promise<Result<IEventAttendee, EventError>>;
    cancelAttendee(eventId: number, userId: string): Promise<Result<IEventAttendee, EventError>>;
    promoteNextWaitlisted(eventId: number): Promise<Result<IEventAttendee | null, EventError>>;
    getQueuePosition(eventId: number, userId: string): Promise<Result<number | null, EventError>>;
}

class RSVPRepository implements IRSVPRepository {

    // Returns all attendees for an event (any status)
    async getAttendeesByEvent(eventId: number): Promise<Result<IEventAttendee[], EventError>> {
        try {
            const attendees = rsvpStore.get(eventId) ?? [];
            return Ok([...attendees]);
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    // Returns a single attendee or null if not found
    async getAttendee(eventId: number, userId: string): Promise<Result<IEventAttendee | null, EventError>> {
        try {
            const attendees = rsvpStore.get(eventId) ?? [];
            const found = attendees.find(a => a.userId === userId) ?? null;
            return Ok(found);
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    // Insert or update an attendee record
    async upsertAttendee(attendee: IEventAttendee): Promise<Result<IEventAttendee, EventError>> {
        try {
            const attendees = rsvpStore.get(attendee.event_id) ?? [];
            const idx = attendees.findIndex(a => a.userId === attendee.userId);
            if (idx === -1) {
                attendees.push(attendee);
            } else {
                attendees[idx] = attendee;
            }
            rsvpStore.set(attendee.event_id, attendees);
            return Ok({ ...attendee });
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    // Set an attendee's status to 'NO' (cancelled)
    async cancelAttendee(eventId: number, userId: string): Promise<Result<IEventAttendee, EventError>> {
        try {
            const attendees = rsvpStore.get(eventId) ?? [];
            const idx = attendees.findIndex(a => a.userId === userId);
            if (idx === -1) return Err(EventNotFoundError(`RSVP not found for user ${userId}`));
            attendees[idx] = { ...attendees[idx], rsvpStatus: 'NO' };
            rsvpStore.set(eventId, attendees);
            return Ok({ ...attendees[idx] });
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    // Atomically promotes the earliest WAITLIST attendee to YES.
    // Returns the promoted attendee, or null if waitlist is empty.
    async promoteNextWaitlisted(eventId: number): Promise<Result<IEventAttendee | null, EventError>> {
        try {
            const attendees = rsvpStore.get(eventId) ?? [];

            // Sort waitlisted by createdAt ascending — earliest is first in line
            const waitlisted = attendees
                .filter(a => a.rsvpStatus === 'WAITLIST')
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            if (waitlisted.length === 0) return Ok(null);

            const next = waitlisted[0];
            const idx = attendees.findIndex(a => a.userId === next.userId);
            attendees[idx] = { ...attendees[idx], rsvpStatus: 'YES' };
            rsvpStore.set(eventId, attendees);

            return Ok({ ...attendees[idx] });
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }

    // Returns 1-based queue position for a waitlisted user, or null if not waitlisted
    async getQueuePosition(eventId: number, userId: string): Promise<Result<number | null, EventError>> {
        try {
            const attendees = rsvpStore.get(eventId) ?? [];
            const waitlisted = attendees
                .filter(a => a.rsvpStatus === 'WAITLIST')
                .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            const pos = waitlisted.findIndex(a => a.userId === userId);
            return Ok(pos === -1 ? null : pos + 1);
        } catch (e) {
            return Err(DatabaseError(String(e)));
        }
    }
}

export function createRSVPRepository(): IRSVPRepository {
    return new RSVPRepository();
}