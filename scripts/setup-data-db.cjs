const Database = require('better-sqlite3');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'src/db/data.db');

const db = new Database(dbPath);

db.prepare("INSERT OR IGNORE INTO User (id, email) VALUES ('user-admin', 'admin@app.test')").run();
db.prepare("INSERT OR IGNORE INTO User (id, email) VALUES ('user-staff', 'staff@app.test')").run();
db.prepare("INSERT OR IGNORE INTO User (id, email) VALUES ('user-reader', 'user@app.test')").run();

db.prepare(`
    INSERT OR IGNORE INTO Event (id, title, description, location, category, capacity, status, organizerId, startDatetime, endDatetime, createdAt, updatedAt)
    VALUES (1, 'Team Kickoff 2026', 'Join us for the annual team kickoff to align on goals and celebrate the year ahead.', 'Main Conference Room', 'general', 50, 'PUBLISHED', 'user-admin', '2026-05-01T09:00:00.000Z', '2026-05-01T11:00:00.000Z', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
`).run();

db.close();
console.log('Seeded users and example event into data.db');
