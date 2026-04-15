import { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession } from "../session/AppSession";

export interface IEventController {
    showEventForm(res: Response): Promise<void>;
    newEventFromForm(res: Response, 
        form: {name: string,
            description: string,
            location: string,
            datetime: string,
            capacity: number}): Promise<void>;
    showEventDetails(res: Response, eventId: string): Promise<void>;
    // TODO: verify session is correct
    editFromForm(res: Response, id: number, session: IAppBrowserSession): Promise<void>;
}

class EventController implements IEventController {
    constructor(private readonly eventService: IEventService, private readonly logger: ILoggingService) {}

    async showEventForm(res: Response): Promise<void> {
        return;
    }

    async newEventFromForm(res: Response, form: {name: string; description: string; location: string; datetime: string; capacity: number}): Promise<void> {
        return;
    }

    async showEventDetails(res: Response, eventId: string): Promise<void> {
        return;
    async editFromForm(res: Response, id: number, session: IAppBrowserSession): Promise<void> {
        // TODO
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}