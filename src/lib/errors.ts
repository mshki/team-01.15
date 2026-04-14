export type EventError = 
    | { name: "EventNotFoundError"; message: string }
    | { name: "DatabaseError"; message: string }
    | { name: "ValidationError"; message: string }
    | { name: "UnknownError"; message: string };

export const EventNotFoundError = (message: string): EventError => ({
    name: "EventNotFoundError",
    message,
});

export const DatabaseError = (message: string): EventError => ({
    name: "DatabaseError",
    message,
});

export const ValidationError = (message: string): EventError => ({
    name: "ValidationError",
    message,
});

export const UnknownError = (message: string): EventError => ({
    name: "UnknownError",
    message,
});
