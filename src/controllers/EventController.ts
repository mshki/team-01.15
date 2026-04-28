import type { Response } from "express";
import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession, IAuthenticatedUserSession } from "../session/AppSession";
import { EventError, RSVPError } from "../lib/errors";
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
        status: EventStatus,
        startDatetime: string,
        endDatetime: string,
        capacity: number | null,
        session: IAppBrowserSession,
        isHtmx?: boolean
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
        category: string,
        status: EventStatus,
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
    publishFromForm(res: Response, eventId: number, session: IAppBrowserSession): Promise<void>;
    cancelFromForm(res: Response, eventId: number, session: IAppBrowserSession): Promise<void>;
    filterEventsFromQuery(
        res: Response,
        timeframe: string,
        category: string | null,
        session: IAppBrowserSession
    ): Promise<void>;
    searchEventsFromQuery(
        res: Response,
        query: string,
        session: IAppBrowserSession
    ): Promise<void>;
    showDraftEvents(res: Response, session: IAppBrowserSession): Promise<void>;
    deleteDraftFromForm(res: Response, eventId: number, session: IAppBrowserSession): Promise<void>;
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

    private isRSVPError(value: unknown): value is RSVPError {
        return (
            typeof value === "object" &&
            value !== null &&
            "name" in value &&
            "message" in value
        );
    }

    private mapErrorStatus(error: EventError | RSVPError): number {
        if (error.name === "EventNotFoundError") return 404;
        if (error.name === "ValidationError") return 400;
        if (error.name === "InvalidFieldError") return 400;
        if (error.name === "InvalidSearchQueryError") return 400;
        if (error.name === "InvalidEventFilterError") return 400;
        if (error.name === "ForbiddenError" || error.name === "UnauthorizedEventActionError" || error.name === "UnauthorizedError") return 403;
        if (error.name === "InvalidRSVPError") return 404;
        if (error.name === "UnauthorizedRSVPError") return 403;
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
        status: EventStatus,
        startDatetime: string,
        endDatetime: string,
        capacity: number | null,
        session: IAppBrowserSession,
        isHtmx: boolean = false
    ): Promise<void> {
        this.logger.info(`Creating new event with name "${name}"`);

        if (!session.authenticatedUser) {
            this.logger.warn("Unauthenticated user attempted to create event.");
            res.status(401);
            return;
        }

        // Only staff or higher can create events
        if (session.authenticatedUser.role == "user") {
            this.logger.warn(`User ${session.authenticatedUser.userId} with role "user" attempted to create event.`);
            res.status(403).end();
            return;
        }

        // 1. Construct createEventData
        const data = {
            title: name,
            description: description,
            location: location,
            category: category,
            capacity: capacity,
            status: status,
            organizerId: session.authenticatedUser.userId,
            startDatetime: new Date(startDatetime),
            endDatetime: new Date(endDatetime),
            attendees: [],
        };

        // 2. Call service to create event
        const result = await this.eventService.createEvent(data);

        this.logger.info(`Attempted to create event with name "${name}". Result: ${result.ok ? "Success" : "Error"}`);

        if (!result.ok && this.isEventError(result.value)) {
            const httpStatus = this.mapErrorStatus(result.value);
            const log = httpStatus === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Create event failed: ${result.value.message}`);

            res.status(isHtmx ? 200 : httpStatus).render("events/new", {
                session,
                pageError: result.value.message,
                formValues: { name, description, location, category, status, startDatetime, endDatetime, capacity },
                layout: isHtmx ? false : "layouts/base",
            });
            return;
        }

        // 3. Handle service result and return appropriate response
        if (isHtmx) {
            res.setHeader("HX-Redirect", "/home");
            res.status(200).send();
        } else {
            res.redirect("/home");
        }
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

        // Derive RSVP/attendance data for the template:
        //  - goingCount / waitlistedCount power the capacity meter in the sidebar.
        //  - userRsvp is the current user's *active* RSVP (CANCELLED RSVPs are
        //    kept in the attendees list for history, but shouldn't surface in UI).
        //  - queuePosition is only meaningful when the user is WAITLISTED; we ask
        //    the service for it so both "who gets promoted" and "what position am
        //    I in" agree on ordering.
        const goingCount = event.attendees.filter((a) => a.rsvpStatus === "GOING").length;
        const waitlistedCount = event.attendees.filter((a) => a.rsvpStatus === "WAITLISTED").length;

        const userRsvp = currentUser
            ? event.attendees.find(
                (a) => a.userId === currentUser.userId && a.rsvpStatus !== "CANCELLED"
              ) ?? null
            : null;

        let queuePosition: number | null = null;
        if (currentUser && userRsvp?.rsvpStatus === "WAITLISTED") {
            const qpResult = await this.eventService.getQueuePosition(
                eventId,
                currentUser.userId
            );
            if (qpResult.ok) {
                queuePosition = qpResult.value;
            } else {
                // Non-fatal: log and fall through with queuePosition = null so the
                // page still renders even if the lookup fails for some reason.
                this.logger.warn(
                    `getQueuePosition failed for user ${currentUser.userId} on event ${eventId}: ${
                        (qpResult.value as EventError).message
                    }`
                );
            }
        }

        this.logger.info(`Rendering event details for event ${eventId} (status: ${event.status})`);

        const isHtmx = res.req.get("HX-Request") === "true";

        res.render("events/show", {
            event,
            session,
            organizerName,
            goingCount,
            waitlistedCount,
            userRsvp,
            queuePosition,
            pageError: null,
            layout: isHtmx ? false : undefined,
        });
    }

    async getEditForm(res: Response, id: number, user: IAuthenticatedUserSession, session: IAppBrowserSession): Promise<void> {
        this.logger.info(`Loading edit form for event ${id}`);

        const result = await this.eventService.getEventEditForm(id, user.userId, user.role);

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            const log = status === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Load edit form failed: ${result.value.message}`);

            res.status(status).render("partials/error", {
                message: result.value.message,
                layout: false,
            });
            return;
        } else if (!result.ok) {
            res.status(500).render("partials/error", {
              message: "Unable to load event for editing.",
              layout: false,
            });
            return;
        }
        
        res.render("events/edit", {
            event: result.value,
            session,
        });
    }

    async editFromForm(
        res: Response,
        id: number,
        user: IAuthenticatedUserSession,
        name: string,
        description: string,
        location: string,
        category: string,
        status: EventStatus,
        startDatetime: Date,
        endDatetime: Date,
        capacity: number,
        session: IAppBrowserSession
      ): Promise<void> {

        this.logger.info(`Attempting to edit event ${id}...`);

        const result = await this.eventService.updateEvent(
            id, 
            user.userId, 
            user.role,
            name,
            description,
            location,
            category,
            status,
            startDatetime,
            endDatetime,
            capacity,
        );
      
        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            const log = status === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Edit event failed: ${result.value.message}`);
        
            res.status(status).render("events/partials/edit-form", {
                event: { id, title: name },
                pageError: result.value.message,
                values: {
                    title: name,
                    description,
                    location,
                    category,
                    status,
                    startDatetime,
                    endDatetime,
                    capacity,
                },
                session,
                layout: false,
            });
            return;
        } else if (!result.ok) {
            res.status(500).render("partials/error", {
                message: "Unable to update event.",
                layout: false,
            });
            return;
        }

        this.logger.info(`Event ${id} updated successfully. Redirecting...`);
      
        res.setHeader("HX-Redirect", '/events');
        res.status(200).send();
      }

    async toggleRsvpFromForm(res: Response, eventId: number, user: IAuthenticatedUserSession, session: IAppBrowserSession): Promise<void> {
        const result = await this.eventService.toggleRsvp(eventId, user.userId, user.role);

        if (!result.ok && (this.isEventError(result.value) || this.isRSVPError(result.value))) {
            const error = result.value as EventError | RSVPError;
            const status = this.mapErrorStatus(error);
            const log = status === 400 ? this.logger.warn : this.logger.error;
            log.call(this.logger, `Toggle RSVP failed: ${error.message}`);
            res.status(status).render("partials/error", {
                message: result.value.message,   
                layout: false,
            });
            return;
        } else if (!result.ok) {
            res.status(500).render("partials/error", {
                message: "Unable to rsvp for event.",
                layout: false,
            });
            return;
        }

        res.render("events/partials/rsvp-toggle-response", {
            event: result.value,
            session,
            layout: false,
        });
        return;
    
    }
    async publishFromForm(res: Response, eventId: number, session: IAppBrowserSession): Promise<void> {
        const userId = session.authenticatedUser?.userId;
        if (!userId) {
            res.status(401).render("partials/error", {
                message: "Please log in to continue.",
                layout: false,
            });
            return;
        }

        this.logger.info(`POST publish event ${eventId} by user ${userId}`);

        const result = await this.eventService.publishEvent(eventId, userId);

        if (!result.ok) {
            const error = result.value as EventError;
            res.status(400).render("events/partials/lifecycle-controls", {
                event: {
                    id: eventId,
                    status: "DRAFT",
                    organizerId: userId,
                },
                session,
                pageError: error.message,
                layout: false,
            });
            return;
        }

        const isHtmx = res.req.get("HX-Request") === "true";

        if (isHtmx) {
            res.status(200).send();
            return;
        }

        res.render("events/partials/lifecycle-controls", {
            event: result.value,
            session,
            pageError: null,
            layout: false,
        });
    }
        async cancelFromForm(res: Response, eventId: number, session: IAppBrowserSession): Promise<void> {
        const userId = session.authenticatedUser?.userId;
        const isAdmin = session.authenticatedUser?.role === "admin";

        if (!userId) {
            res.status(401).render("partials/error", {
                message: "Please log in to continue.",
                layout: false,
            });
            return;
        }

        this.logger.info(`POST cancel event ${eventId} by user ${userId}`);

        const result = await this.eventService.cancelEvent(eventId, userId, isAdmin);

        if (!result.ok) {
            const error = result.value as EventError;
            res.status(400).render("events/partials/lifecycle-controls", {
                event: {
                    id: eventId,
                    status: "PUBLISHED",
                    organizerId: userId,
                },
                session,
                pageError: error.message,
                layout: false,
            });
            return;
        }

        res.render("events/partials/lifecycle-controls", {
            event: result.value,
            session,
            pageError: null,
            layout: false,
        });
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

        const result = await this.eventService.filterPublishedEvents(
            timeframe,
            category
        );

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            res.status(status).render("partials/error", {
                message: result.value.message,
                layout: false,
            });
            return;
        }

        if (!result.ok) {
            res.status(500).render("partials/error", {
                message: "Unable to filter events.",
                layout: false,
            });
            return;
        }

        const isHtmx = res.req.get("HX-Request") === "true";

        if (isHtmx) {
            res.render("events/partials/event-list", {
                events: result.value,
                session,
                layout: false,
            });
            return;
        }

        res.render("events/index", {
            events: result.value,
            timeframe,
            category,
            session,
            pageError: null,
});
    }

    async searchEventsFromQuery(
        res: Response,
        query: string,
        session: IAppBrowserSession
    ): Promise<void> {
        this.logger.info(`Searching events with query "${query}"`);

        const result = await this.eventService.searchEvents(query);

        // Same error-handling shape as filterEventsFromQuery: differentiate
        // known EventErrors from anything unexpected, and never swallow them.
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
                message: "Unable to search events.",
                layout: false,
            });
            return;
        }

        // Pass the ORIGINAL query string (not a normalized version) back to the
        // view so the input field can re-populate with exactly what the user
        // typed. The service handled normalization internally.
        //
        // HTMX flow: when the search input fires its debounced request, HTMX
        // sends an "HX-Request: true" header. In that case we only need to
        // return the results partial — the browser will swap just the
        // #search-results section, keeping the page chrome and input focus
        // intact. For a regular (non-HTMX) GET we render the full page so
        // bookmarks, shares, and non-JS clients still work.
        const isHtmx = res.req.get("HX-Request") === "true";
        if (isHtmx) {
            res.render("events/partials/search-results", {
                events: result.value,
                query,
                session,
                layout: false,
            });
            return;
        }

        res.render("events/search", {
            events: result.value,
            query,
            session,
            pageError: null,
        });
    }
    async showDraftEvents(res: Response, session: IAppBrowserSession): Promise<void> {
        const currentUser = session.authenticatedUser;

        if (!currentUser) {
            res.status(401).render("partials/error", {
                message: "Please log in to continue.",
                layout: false,
            });
            return;
        }

        if (currentUser.role === "user") {
            res.status(403).render("partials/error", {
                message: "Only staff and admins can view draft events.",
                layout: false,
            });
            return;
        }

        const result = await this.eventService.getDraftEventsForUser(
            currentUser.userId,
            currentUser.role
        );

        if (!result.ok && this.isEventError(result.value)) {
            const status = this.mapErrorStatus(result.value);
            res.status(status).render("partials/error", {
                message: result.value.message,
                layout: false,
            });
            return;
        }

        if (!result.ok) {
            res.status(500).render("partials/error", {
                message: "Unable to load draft events.",
                layout: false,
            });
            return;
        }

        res.render("events/drafts", {
            events: result.value,
            session,
            pageError: null,
        });
    }
    async deleteDraftFromForm(
        res: Response,
        eventId: number,
        session: IAppBrowserSession
    ): Promise<void> {
        const currentUser = session.authenticatedUser;

        if (!currentUser) {
            res.status(401).render("partials/error", {
                message: "Please log in to continue.",
                layout: false,
            });
            return;
        }

        const result = await this.eventService.deleteDraftEvent(
            eventId,
            currentUser.userId,
            currentUser.role
        );

        if (!result.ok) {
            const status = this.mapErrorStatus(result.value);
            res.status(status).render("partials/error", {
                message: result.value.message,
                layout: false,
            });
            return;
        }

        const isHtmx = res.req.get("HX-Request") === "true";
        if (isHtmx) {
            res.status(200).send();
            return;
        }

        res.redirect("/events/drafts");
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}