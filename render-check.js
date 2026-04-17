const ejs = require('ejs');
const fs = require('fs');
const tpl = fs.readFileSync('src/views/events/show.ejs', 'utf8');

const baseEvent = {
  id: 42,
  title: 'Test Event',
  description: 'desc',
  location: 'loc',
  category: null,
  capacity: 2,
  status: 'PUBLISHED',
  startDatetime: new Date(Date.now() + 86400000),
  endDatetime: new Date(Date.now() + 2 * 86400000),
  organizerId: 'org1',
  attendees: [
    { id: 'r1', eventId: 42, userId: 'u1', rsvpStatus: 'GOING', createdAt: new Date() },
    { id: 'r2', eventId: 42, userId: 'u2', rsvpStatus: 'GOING', createdAt: new Date() },
    { id: 'r3', eventId: 42, userId: 'u3', rsvpStatus: 'WAITLISTED', createdAt: new Date() },
    { id: 'r4', eventId: 42, userId: 'u4', rsvpStatus: 'WAITLISTED', createdAt: new Date() },
  ],
  createdAt: new Date(),
  updatedAt: new Date(),
};

function render(user, userRsvp, queuePosition) {
  return ejs.render(tpl, {
    event: baseEvent,
    session: { authenticatedUser: user },
    organizerName: 'org1',
    userRsvp,
    queuePosition,
    goingCount: 2,
    waitlistedCount: 2,
    pageError: null,
  }, { filename: 'src/views/events/show.ejs' });
}

const html1 = render({ userId: 'u3', role: 'user', displayName: 'U3' }, baseEvent.attendees[2], 1);
console.log("waitlisted u3 shows '#1 on the waitlist' badge:", html1.includes("You're #1 on the waitlist"));
console.log("waitlisted u3 attendance hint '(you're #1)':", html1.includes("(you're #1)"));

const html2 = render({ userId: 'u1', role: 'user', displayName: 'U1' }, baseEvent.attendees[0], null);
console.log("going u1 shows 'marked as going':", html2.includes('You are currently marked as going.'));
console.log("going u1 NOT waitlisted badge:", !html2.includes('on the waitlist'));

const html3 = render(null, null, null);
console.log("anonymous: no RSVP panel:", !html3.includes('id="rsvp-panel"'));
