export type EventError =
    | { name: "EventNotFoundError"; message: string }
    | { name: "DatabaseError"; message: string }
    | { name: "ValidationError"; message: string }
    | { name: "UnknownError"; message: string }
    | { name: "InvalidEventTransitionError"; message: string }
    | { name: "UnauthorizedEventActionError"; message: string }
    | { name: "UnauthorizedError"; message: string }
    | { name: "ForbiddenError"; message: string }
    | { name: "InvalidFieldError"; message: string };

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

export const InvalidEventTransitionError = (message: string): EventError => ({
    name: "InvalidEventTransitionError",
    message,
});

export const UnauthorizedEventActionError = (message: string): EventError => ({
    name: "UnauthorizedEventActionError",
    message,
});

export const UnauthorizedError = (message: string): EventError => ({
    name: "UnauthorizedError",
    message,
});

export const ForbiddenError = (message: string): EventError => ({
    name: "ForbiddenError",
    message,
});

export const InvalidFieldError = (message: string): EventError => ({
    name: "InvalidFieldError",
    message,
});
