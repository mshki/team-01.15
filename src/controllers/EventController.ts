import type { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession, IAuthenticatedUserSession } from "../session/AppSession";
import { EventError } from "../lib/errors";
import { IApp } from "../contracts";
import { EventStatus } from "@prisma/client";

export interface IEventController {
    showEventForm(res: Response, session: IAppBrowserSession): Promise<void>;
    newEventFromForm(res: Response, 
        name: string,
        description: string,
        location: string,
        startDatetime: string,
        endDatetime: string,
        capacity: number,
        session: IAppBrowserSession
    ): Promise<void>;
    showEventDetails(res: Response, eventId: number, session: IAppBrowserSession): Promise<void>;
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

    private mapErrorStatus(error: EventError): number {
        if (error.name === "EventNotFoundError") return 404;
        if (error.name === "ValidationError") return 400;
        return 500;
      }
    
    async showEventForm(res: Response, session: IAppBrowserSession): Promise<void> {
        return;
    }

    async newEventFromForm(res: Response, 
        name: string,
        description: string,
        location: string,
        startDatetime: string,
        endDatetime: string,
        capacity: number,
        session: IAppBrowserSession
    ): Promise<void> {
        this.logger.info(`Creating new event with name "${name}"`);

        if (!session.authenticatedUser) {
            this.logger.warn("Unauthenticated user attempted to create event.");
            res.status(401);
            return;
        }

        if (session.authenticatedUser.role === "user") {
            this.logger.warn(`User ${session.authenticatedUser.userId} attempted to create event without permission.`);
            res.status(403);
            return;
        }

        // 1. Construct createEventData
        const data = {
            title: name,
            description: description,
            location: location,
            capacity: capacity,
            status: EventStatus.PUBLISHED,
            organizerId: session.authenticatedUser.userId,
            startDatetime: new Date(startDatetime),
            endDatetime: new Date(endDatetime),
            attendees: [],
        };

        // 2. Call service to create event
        const result = await this.eventService.createEvent(data);

        this.logger.info(`Attempted to create event with name "${name}". Result: ${result.ok ? "Success" : "Error"}`);

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            const log = status === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Create event failed: ${result.value.message}`);

            res.status(status);

            return
        }

        // 3. Handle service result and return appropriate response
        res.redirect("/events");
    }

    async showEventDetails(res: Response, eventId: number, session: IAppBrowserSession): Promise<void> {
        return;
    }

    async getEditForm(res: Response, id: number, user: IAuthenticatedUserSession, session: IAppBrowserSession): Promise<void> {
        this.logger.info(`Loading edit form for event ${id}`);

        const result = await this.eventService.getEventEditForm(id, user);

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            const log = status === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Load edit form failed: ${result.value.message}`);

            res.status(status).render("events/partials/error", {
                message: result.value.message,
                layout: false,
            });
            return;
        }

        if (!result.ok) {
            res.status(500).render("events/partials/error", {
              message: "Unable to load event for editing.",
              layout: false,
            });
            return;
        }
        
        res.render("events/:id/edit", {
            event: result.value,
            session,
            layout: false,
        });
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
            this.logger.info(`Editing event ${id}`);

        const result = await this.eventService.updateEvent(
            id, 
            user, 
            name,
            description,
            location,
            startDatetime,
            endDatetime,
            capacity,
        );

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            const log = status === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Edit event failed: ${result.value.message}`);

            res.status(status).render("events/:id/edit", {
            error: result.value.message,
            values: {
                title: name,
                description,
                location,
                startDatetime,
                endDatetime,
                capacity,
            },
            session,
            layout: false,
            });
            return;
        }

        if (!result.ok) {
            res.status(500).render("events/partials/error", {
            message: "Unable to update event.",
            layout: false,
            });
            return;
        }

        res.redirect(`/events/${result.value.id}`);
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}