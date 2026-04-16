import { IEventRepository } from "../repository/EventRepository";
import { ILoggingService } from "./LoggingService";
import { Err, Result } from "../lib/result"; 
import { EventError, ValidationError } from "../lib/errors";
import { IEvent } from "../types/EventTypes";



export interface IEventService {
    publishEvent(eventId: string, userId: string): Promise<Result<IEvent, EventError>>;
    cancelEvent(eventId: string, userId: string, isAdmin: boolean): Promise<Result<IEvent, EventError>>;
}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}
    
    async publishEvent(eventId: string, userId: string): Promise<Result<IEvent, EventError>> {
        this.logger.info(`User ${userId} is publishing event ${eventId}`);

        const eventResult = await this.eventRepository.getEventById(eventId);

        if (!eventResult.ok) {
            return eventResult;
        }

        const event = eventResult.value;

        if (event.eventDesc.organizerId !== userId) {
            this.logger.info(`Publish denied for user ${userId} on event ${eventId}: not organizer`);
            return Err(ValidationError("Only the organizer can publish this event"));
        }

        if (event.eventDesc.status !== "DRAFT") {
            this.logger.info(`Publish denied for event ${eventId}: status is ${event.eventDesc.status}`);
            return Err(ValidationError("Only draft events can be published"));
        }

        return this.eventRepository.updateEvent(eventId, {
            eventDesc: {
                ...event.eventDesc,
                status: "PUBLISHED",
            },
        });
    }

    async cancelEvent(
        eventId: string,
        userId: string,
        isAdmin: boolean,
    ): Promise<Result<IEvent, EventError>> {
        this.logger.info(`User ${userId} is cancelling event ${eventId}`);

        const eventResult = await this.eventRepository.getEventById(eventId);

        if (!eventResult.ok) {
            return eventResult;
        }

        const event = eventResult.value;
        const isOrganizer = event.eventDesc.organizerId === userId;

        if (!isOrganizer && !isAdmin) {
            this.logger.info(`Cancel denied for user ${userId} on event ${eventId}: not organizer or admin`);
            return Err(ValidationError("Only the organizer or an admin can cancel this event"));
        }

        if (event.eventDesc.status !== "PUBLISHED") {
            this.logger.info(`Cancel denied for event ${eventId}: status is ${event.eventDesc.status}`);
            return Err(ValidationError("Only published events can be cancelled"));
        }

        return this.eventRepository.updateEvent(eventId, {
            eventDesc: {
                ...event.eventDesc,
                status: "CANCELLED",
            },
        });
    }

}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}