import type { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession, IAuthenticatedUserSession } from "../session/AppSession";
import { EventError } from "../lib/errors";
import { IApp } from "../contracts";
import { stat } from "node:fs";
import { EventStatus } from "../types/EventTypes";

export interface IEventController {
    showEventForm(res: Response, session: IAppBrowserSession): Promise<void>;
    newEventFromForm(res: Response,
        name: string,
        description: string,
        location: string,
        category: string | null,
        startDatetime: string,
        endDatetime: string,
        capacity: number | null,
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
    toggleRsvpFromForm(
        res: Response,
        eventId: number,
        user: IAuthenticatedUserSession,
        session: IAppBrowserSession
        ): Promise<void>;
    publishFromForm(res: Response, eventId: number, userId: string): Promise<void>;
    cancelFromForm(res: Response, eventId: number, userId: string, isAdmin: boolean): Promise<void>;
    filterEventsFromQuery(
        res: Response,
        timeframe: string,
        category: string | null,
        session: IAppBrowserSession
    ): Promise<void>;
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
        res.render("events/new", { session, pageError: null });
    }

    async newEventFromForm(res: Response,
        name: string,
        description: string,
        location: string,
        category: string | null,
        startDatetime: string,
        endDatetime: string,
        capacity: number | null,
        session: IAppBrowserSession
    ): Promise<void> {
        this.logger.info(`Creating new event with name "${name}"`);

        if (!session.authenticatedUser) {
            this.logger.warn("Unauthenticated user attempted to create event.");
            res.status(401);
            return;
        }

        // 1. Construct createEventData
        const data = {
            title: name,
            description: description,
            location: location,
            category: category,
            capacity: capacity,
            status: "PUBLISHED" as EventStatus, // Default to DRAFT if you want to require manual publishing
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
        res.redirect("/home");
    }

        async showEventDetails(res: Response, eventId: number, session: IAppBrowserSession): Promise<void> {
        // 1. Verify eventId is valid
        if (!eventId || eventId <= 0) {
            this.logger.warn(`showEventDetails called with invalid event ID: ${eventId}`);
            res.status(404).render("partials/error", { message: "Event not found.", layout: false });
            return;
        }

        this.logger.info(`Loading event details for event ${eventId}`);

        // 2. Load event details from EventService
        const result = await this.eventService.getEventDetails(eventId);

        // 6. If event not found, show error page
        if (!result.ok) {
            const error = result.value as EventError;
            const status = this.mapErrorStatus(error);
            this.logger.warn(`Failed to load event ${eventId}: ${error.message}`);
            res.status(status).render("partials/error", { message: error.message, layout: false });
            return;
        }

        // 3. If event is found
        const event = result.value;
        const currentUser = session.authenticatedUser;
        const isAdmin = currentUser?.role === "admin";
        const isOrganizer = currentUser?.userId === event.organizerId;

        // 4. If user is organizer or admin role, show regardless of status
        // 5. If event is published show, else if draft don't show (return 404 to avoid leaking existence)
        if (event.status === "DRAFT" && !isAdmin && !isOrganizer) {
            this.logger.warn(`User ${currentUser?.userId ?? "anonymous"} attempted to view draft event ${eventId}`);
            res.status(404).render("partials/error", { message: "Event not found.", layout: false });
            return;
        }

        const organizerName = isOrganizer && currentUser
            ? currentUser.displayName
            : event.organizerId;

        this.logger.info(`Rendering event details for event ${eventId} (status: ${event.status})`);

        res.render("events/show", {
            event,
            session,
            organizerName,
            pageError: null,
        });
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
        
        res.render("events/edit", {
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
        session: IAppBrowserSession
      ): Promise<void> {
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
        
            res.status(status).render("events/edit", {
                event: { id, title: name },
                pageError: result.value.message,
                values: {
                title: name,
                description,
                location,
                startDatetime,
                endDatetime,
                capacity,
                },
                session,
            });
            return;
        }
      
        if (!result.ok) {
            res.status(500).render("partials/error", {
                message: "Unable to update event.",
                layout: false,
            });
            return;
        }
      
        res.redirect(`/events/${result.value.id}`);
      }

    async toggleRsvpFromForm(res: Response, eventId: number, user: IAuthenticatedUserSession, session: IAppBrowserSession): Promise<void> {
        const result = await this.eventService.toggleRsvp(eventId, user.userId);

        if (!result.ok) {
          const error = result.value as EventError;
          res.status(this.mapErrorStatus(error)).render("events/partials/error", {
            message: error.message,
            layout: false,
          });
          return;
        }
    
        res.redirect(`/events/${eventId}`);
    }
    async publishFromForm(res: Response, eventId: number, userId: string): Promise<void> {
        this.logger.info(`POST publish event ${eventId} by user ${userId}`);

        const result = await this.eventService.publishEvent(eventId, userId);

        if (!result.ok) {
           const error = result.value as EventError;
           res.status(400).render("partials/error", {
               message: error.message,
                layout: false,
            });
            return;
        }

        res.redirect(`/events/${eventId}`);

    }
    async cancelFromForm(res: Response, eventId: number, userId: string, isAdmin: boolean): Promise<void> {
        this.logger.info(`POST cancel event ${eventId} by user ${userId}`);

        const result = await this.eventService.cancelEvent(eventId, userId, isAdmin);

        if (!result.ok) {
            const error = result.value as EventError;
            res.status(400).render("partials/error", {
                message: error.message,
                layout: false,
            });
            return;
        }

        res.redirect(`/events/${eventId}`);
    }

    async filterEventsFromQuery(
        res: Response,
        timeframe: string,
        category: string | null,
        session: IAppBrowserSession
    ): Promise<void> {
        this.logger.info(
            `Filtering events with timeframe "${timeframe}" and category "${category ?? "all"}"`
        );

        const normalizedTimeframe =
            timeframe === "all" || timeframe === "week" || timeframe === "weekend"
                ? timeframe
                : "all";

        const result = await this.eventService.filterPublishedEvents(
            normalizedTimeframe,
            category
        );

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            res.status(status).render("events/partials/error", {
                message: result.value.message,
                layout: false,
            });
            return;
        }

        if (!result.ok) {
            res.status(500).render("events/partials/error", {
                message: "Unable to filter events.",
                layout: false,
            });
            return;
        }
    
        res.render("events/index", {
            events: result.value,
            timeframe: normalizedTimeframe,
            category,
            session,
            pageError: null,
        });
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}