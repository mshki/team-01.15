import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";

export interface IEventController {

}

class EventController implements IEventController {
    constructor(private readonly eventService: IEventService, private readonly logger: ILoggingService) {}
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}