const ejs = require('ejs');
const path = require('path');

const base = {
  event: {
    id: 42, title: 'Board Game Night', description: 'Bring your favorites\!',
    location: 'Student Union', status: 'PUBLISHED', organizerId: 'u1',
    startDatetime: new Date('2026-05-01T19:00:00Z'),
    endDatetime: new Date('2026-05-01T21:00:00Z'),
    capacity: 2, category: 'Social',
    attendees: [
      { id: 'r1', eventId: 42, userId: 'u2', rsvpStatus: 'GOING',      createdAt: new Date() },
      { id: 'r2', eventId: 42, userId: 'u3', rsvpStatus: 'GOING',      createdAt: new Date() },
      { id: 'r3', eventId: 42, userId: 'u4', rsvpStatus: 'WAITLISTED', createdAt: new Date() },
      { id: 'r4', eventId: 42, userId: 'me', rsvpStatus: 'WAITLISTED', createdAt: new Date() },
    ],
  },
  organizerName: 'Alice',
  goingCount: 2,
  waitlistedCount: 2,
  pageError: null,
};

const caseA = {
  ...base,
  session: { authenticatedUser: { userId: 'me', role: 'user', displayName: 'Me' } },
  userRsvp: { id: 'r4', eventId: 42, userId: 'me', rsvpStatus: 'WAITLISTED', createdAt: new Date() },
  queuePosition: 2,
};
const caseB = {
  ...base,
  session: { authenticatedUser: { userId: 'u2', role: 'user', displayName: 'U2' } },
  userRsvp: { id: 'r1', eventId: 42, userId: 'u2', rsvpStatus: 'GOING', createdAt: new Date() },
  queuePosition: null,
};

function includer() { return { template: '' }; } // stub included partials

async function run(name, locals) {
  const tpl = path.resolve('src/views/events/show.ejs');
  const html = await ejs.renderFile(tpl, locals, { includer });
  const hasBadge = html.includes('Waitlisted · #');
  const hasHint  = html.includes('in line');
  const badgeText = (html.match(/Waitlisted · #\d+/) || [null])[0];
  console.log(`[${name}] badge=${hasBadge} hint=${hasHint} badgeText=${badgeText}`);
}

(async () => { await run('A', caseA); await run('B', caseB); })()
  .catch(e => { console.error(e); process.exit(1); });
