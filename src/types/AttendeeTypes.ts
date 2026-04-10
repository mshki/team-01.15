
export type RSVPStatus = 'YES' | 'NO' | 'WAITLIST';

export interface IEventAttendee {
    event_id: number,
    userId: number,
    rsvpStatus: RSVPStatus,
    createdAt: Date,
}

