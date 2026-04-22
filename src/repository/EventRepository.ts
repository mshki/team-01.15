
import { EventError, RSVPError } from "../lib/errors";
import { Result } from "../lib/result";
import { CreateEventData, IEvent, IRSVP, } from "../types/EventTypes";

export interface IEventRepository {
    getAllEvents(): Promise<Result<IEvent[], EventError>>;
    getEventById(id: number): Promise<Result<IEvent, EventError>>;
    createEvent(event: CreateEventData): Promise<Result<IEvent, EventError>>;
    updateEvent(id: number, event: Partial<IEvent>): Promise<Result<IEvent, EventError>>;
    deleteEvent(id: number): Promise<Result<void, EventError>>;
    findUserRsvp(id: number, userId: string): Promise<Result<IRSVP | null, EventError | RSVPError>>;
}
