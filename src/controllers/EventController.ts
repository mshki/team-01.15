import { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession } from "../session/AppSession";

export interface IEventController {
    showEventForm(res: Response, session: IAppBrowserSession): Promise<void>;
    newEventFromForm(res: Response, 
        name: string,
        description: string,
        location: string,
        datetime: string,
        capacity: number,
        session: IAppBrowserSession
    ): Promise<void>;
    showEventDetails(res: Response, eventId: string, session: IAppBrowserSession): Promise<void>;
    // TODO: verify session is correct
    editFromForm(res: Response, id: number, session: IAppBrowserSession): Promise<void>;
}

class EventController implements IEventController {
    constructor(private readonly eventService: IEventService, private readonly logger: ILoggingService) {}

    async showEventForm(res: Response, session: IAppBrowserSession): Promise<void> {
        return;
    }

    async newEventFromForm(res: Response, 
        name: string,
        description: string,
        location: string,
        datetime: string,
        capacity: number,
        session: IAppBrowserSession
    ): Promise<void> {
        return;
    }

    async showEventDetails(res: Response, eventId: string, session: IAppBrowserSession): Promise<void> {
        return;
    }

    async editFromForm(res: Response, id: number, session: IAppBrowserSession): Promise<void> {
        // TODO
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}