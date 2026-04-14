import { IEventService } from "../service/EventService";
import { ILoggingService } from "../service/LoggingService";
import { IAppBrowserSession } from "../session/AppSession";

export interface IEventController {
    // TODO: verify session is correct
    editFromForm(res: Response, id: number, session: IAppBrowserSession): Promise<void>;
}

class EventController implements IEventController {
    constructor(private readonly eventService: IEventService, private readonly logger: ILoggingService) {}
    async editFromForm(res: Response, id: number, session: IAppBrowserSession): Promise<void> {
        // TODO
    }
}

export function createEventController(eventService: IEventService, logger: ILoggingService): IEventController {
    return new EventController(eventService, logger);
}