Service Level Contracts

## Sprintg 1
Feature 1: EventService.createEvent() takes in a {title, desc, location, category, datetime}returns an event object with the EventDesc fields.

Feature 2: EventService.getEvent() return the EventDesc object

Feature 3: EventService.editEvent() takes as input an event id and the fields to be updated. Returns the updated Event object. 

Feature 4: EventService.rsvpToggle() takes as input the user id, event id, desired rsvp status. Returns the rsvp confirmation (either they get yes/no, or if the event is over capacity, yes turns into waitlist). 

Feature 5: EventService.publishEvent(): takes in {eventid, userid} returns updated EventDesc with updated status field to published  || EventService.cancelEvent(): takes in {eventid, userid} returns updated EventDesc with updated status field to canceled

Feature 6: EventService.cancelEvent(): takes in {category, date?} returns list of EventDesc objects matching the filter provided

Feature 9: WaitlistPromotion.service: takes in {id, eventid, userid, date(createdAt), the status} Returns an updated RSVP list if a customer is to cancel their RSVP the updated waitlistpromotion would highlight who’s next in line and others while displaying their position in the queue.

Feature 10: Event search.service takes in {title, description, location, category, date} Returns an updated list of EventSearch events that are upcoming or ongoing. 

## Model Contracts
enum status {
	DRAFT
	PUBLISHED
	CANCELLED
	CONCLUDED
}

enum rsvp {
	YES
	NO
	WAITLIST 
}

Model User {
	id 		UUID	@id @default(UUID())
	email		String
}


# For all features
Model Event {
	id		Int
	title		String
	createdAt	DateTime @default(now())
	updatedAt	DateTime @default(now())
}

# Feature 2, 6
model EventDesc {
id        	Int      @id @default(autoincrement())
title     	String
desc      	String
location	String
category 	String 
datetime 	DateTime
organizer 	String
capacity 	Int
attendees	UUID[]	
status	   	Status 	@default(DRAFT)
createdAt 	DateTime @default(now())
updatedAt 	DateTime @updatedAt
}





