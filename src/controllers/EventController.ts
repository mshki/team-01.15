import { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";

export interface IEventController {
    showEventForm(res: Response): Promise<void>;
    newEventFromForm(res: Response, 
        form: {name: string,
            description: string,
            location: string,
            datetime: string,
            capacity: number}): Promise<void>;
}

class EventController implements IEventController {
    constructor(private readonly eventService: IEventService, private readonly logger: ILoggingService) {}

    async showEventForm(res: Response): Promise<void> {
        return;
    }

    async newEventFromForm(res: Response, form: {name: string; description: string; location: string; datetime: string; capacity: number}): Promise<void> {
        return;
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}