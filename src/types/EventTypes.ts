
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'CONCLUDED';

export type RSVPStatus = 'GOING' | 'WAITLISTED' | 'CANCELLED';

export interface IRSVP {
    id: string,
    eventId: number,
    userId: string,
    rsvpStatus: RSVPStatus,
    createdAt: Date,
}

export interface IUser {
    id: string,
    email: string,
    attendees: IRSVP[],
}

export interface IEvent {
    id: number,
    title: string,
    description: string,
    location: string,
    capacity: number | null,
    status: EventStatus;
    startDatetime: Date,
    endDatetime: Date,
    organizerId: string,
    attendees: IRSVP[],
    createdAt: Date,
    updatedAt: Date,
}

export interface CreateEventData {
    id: number,
    title: string,
    description: string,
    location: string,
    capacity?: number | null,
    status: EventStatus;
    startDatetime: Date,
    endDatetime: Date,
    organizerId: string,
    attendees: IRSVP[],
    createdAt?: Date,
    updatedAt?: Date,
  }


function normalize(data: string): string {
    return String(data ?? "").trim();
}


function normalizeTag(tag?: string): string {
    const normalized = String(tag ?? "general").trim().toLowerCase();
    return normalized || "general";
}

// TODO
// export class Event implements IEvent {
    // id: number;
    // title: string;
    // description: string;
    // location: string;
    // capacity: number | null;
    // status: EventStatus;
    // startDatetime: Date;
    // endDatetime: Date;
    // organizerId: string;
    // attendees: IRSVP[];
    // createdAt: Date;
    // updatedAt: Date;
  
    // constructor(id: number, data: CreateEventData) {
    //     const title = normalize(data.title);
    //     const description = normalize(data.description);
    //     const location = normalize(data.location);
    //     const capacity = 
  
    //     this.id = id;
    //     this.title = title;
    //     this.description = description;

        
        // this.location: location;
        // category: string;
        // status: EventStatus;
        // this.startDatetime: Date;
        // this.endDatetime: Date;
        // organizerId: string;
        // attendees: IRSVP[];
        // createdAt: Date;
        // updatedAt: Date;
//     }
// }
