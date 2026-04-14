
export type EventStatus = 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'CONCLUDED';

export type RSVPStatus = 'YES' | 'NO' | 'WAITLIST';

export interface IEventAttendee {
    event_id: number,
    userId: string,
    rsvpStatus: RSVPStatus,
    createdAt: Date,
}

export interface IUser {
    id: string,
    email: string,
    attendees: IEventAttendee[],
}

export interface IEventDesc {
    id: number,
    eventId: number,
    title: string,
    desc: string,
    location: string,
    category: string,
    datetime: Date,
    organizerId: string,
    capacity: number,
    status: EventStatus,
    createdAt: Date,
    updatedAt: Date,
}

export interface IEvent {
    id: number,
    title: string,
    createdAt: Date,
    attendees: IEventAttendee[],
    eventDesc: IEventDesc,
}

