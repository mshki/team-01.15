import type { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession, IAuthenticatedUserSession } from "../session/AppSession";
import { EventError } from "../lib/errors";
import { IApp } from "../contracts";

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
    getEditForm(res: Response, id: number, user: IAuthenticatedUserSession, session: IAppBrowserSession): Promise<void>;
    editFromForm(
        res: Response, 
        id: number, 
        user: IAuthenticatedUserSession, 
        name: string,
        description: string,
        location: string,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number,
        session: IAppBrowserSession): Promise<void>;
}

class EventController implements IEventController {
    constructor(private readonly eventService: IEventService, private readonly logger: ILoggingService) {}

    private isEventError(value: unknown): value is EventError {
        return (
            typeof value === "object" &&
            value !== null &&
            "name" in value &&
            "message" in value
        );
    }
    
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

    async getEditForm(res: Response, id: number, user: IAuthenticatedUserSession, session: IAppBrowserSession): Promise<void> {
        // TODO
        return;
    }

    async editFromForm(
        res: Response, 
        id: number, 
        user: IAuthenticatedUserSession, 
        name: string, 
        description: string, 
        location: string, 
        startDatetime: Date, 
        endDatetime: Date, 
        capacity: number, 
        session: IAppBrowserSession): Promise<void> {
        
    }

}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}