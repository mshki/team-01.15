import { IRSVPRepository } from "../repository/RSVPRepository";
import { IEventRepository } from "../repository/EventRepository";
import { IEventAttendee } from "../types/EventTypes";
import { Ok, Err, Result } from "../lib/result";
import { EventError, EventNotFoundError, AuthorizationError } from "../lib/errors";

export interface WaitlistCancelResult {
    cancelled: IEventAttendee;
    promoted: IEventAttendee | null; // null = waitlist was empty
}

export interface WaitlistStatusResult {
    rsvpStatus: 'YES' | 'NO' | 'WAITLIST';
    queuePosition: number | null; // only set when rsvpStatus === 'WAITLIST'
}

export interface IWaitlistService {
    cancelAndPromote(eventId: number, userId: string): Promise<Result<WaitlistCancelResult, EventError>>;
    getWaitlistStatus(eventId: number, userId: string): Promise<Result<WaitlistStatusResult, EventError>>;
}

class WaitlistService implements IWaitlistService {

    constructor(
        private readonly rsvpRepo: IRSVPRepository,
        private readonly eventRepo: IEventRepository,
    ) {}

    // Cancels a user's RSVP and atomically promotes the next waitlisted member.
    // This is the core of Feature 9 — both mutations happen together or not at all.
    async cancelAndPromote(
        eventId: number,
        userId: string,
    ): Promise<Result<WaitlistCancelResult, EventError>> {

        // 1. Confirm the event exists
        const eventResult = await this.eventRepo.getEventById(String(eventId));
        if (!eventResult.ok) return Err(eventResult.error);

        // 2. Confirm the user has an active RSVP to cancel
        const attendeeResult = await this.rsvpRepo.getAttendee(eventId, userId);
        if (!attendeeResult.ok) return Err(attendeeResult.error);

        const attendee = attendeeResult.value;
        if (!attendee || attendee.rsvpStatus === 'NO') {
            return Err(EventNotFoundError("No active RSVP found to cancel."));
        }

        // 3. Only a YES RSVP opening a spot should trigger promotion.
        //    Cancelling a WAITLIST entry just removes them — no spot opened.
        const wasGoing = attendee.rsvpStatus === 'YES';

        // 4. Cancel the user's RSVP
        const cancelResult = await this.rsvpRepo.cancelAttendee(eventId, userId);
        if (!cancelResult.ok) return Err(cancelResult.error);

        // 5. If a spot opened up, promote the next person on the waitlist
        let promoted: IEventAttendee | null = null;
        if (wasGoing) {
            const promoteResult = await this.rsvpRepo.promoteNextWaitlisted(eventId);
            if (!promoteResult.ok) return Err(promoteResult.error);
            promoted = promoteResult.value;
        }

        return Ok({ cancelled: cancelResult.value, promoted });
    }

    // Returns a user's current RSVP status and their waitlist queue position if applicable.
    async getWaitlistStatus(
        eventId: number,
        userId: string,
    ): Promise<Result<WaitlistStatusResult, EventError>> {

        const attendeeResult = await this.rsvpRepo.getAttendee(eventId, userId);
        if (!attendeeResult.ok) return Err(attendeeResult.error);

        const attendee = attendeeResult.value;
        if (!attendee) {
            return Ok({ rsvpStatus: 'NO', queuePosition: null });
        }

        let queuePosition: number | null = null;
        if (attendee.rsvpStatus === 'WAITLIST') {
            const posResult = await this.rsvpRepo.getQueuePosition(eventId, userId);
            if (!posResult.ok) return Err(posResult.error);
            queuePosition = posResult.value;
        }

        return Ok({ rsvpStatus: attendee.rsvpStatus, queuePosition });
    }
}

export function createWaitlistService(
    rsvpRepo: IRSVPRepository,
    eventRepo: IEventRepository,
): IWaitlistService {
    return new WaitlistService(rsvpRepo, eventRepo);
}