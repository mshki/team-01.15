import { IEventRepository } from "../repository/EventRepository";
import { ILoggingService } from "./LoggingService";

export interface IEventService {

}

class EventService implements IEventService {
    constructor(private readonly eventRepository: IEventRepository, private readonly logger: ILoggingService) {}
}

export function createEventService(eventRepository: IEventRepository, logger: ILoggingService): IEventService {
    return new EventService(eventRepository, logger);
}