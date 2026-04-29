const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'src/db/test.db');

[dbPath, dbPath + '-wal', dbPath + '-shm'].forEach(f => fs.existsSync(f) && fs.unlinkSync(f));

const db = new Database(dbPath);

// Find and apply the latest migration
const migrationsDir = path.join(root, 'prisma/migrations');
const migrationDirs = fs.readdirSync(migrationsDir)
    .filter(d => fs.statSync(path.join(migrationsDir, d)).isDirectory())
    .sort();

for (const dir of migrationDirs) {
    const sqlFile = path.join(migrationsDir, dir, 'migration.sql');
    if (fs.existsSync(sqlFile)) {
        db.exec(fs.readFileSync(sqlFile, 'utf-8'));
    }
}

// Seed users (same as data.db)
db.prepare("INSERT OR IGNORE INTO User (id, email) VALUES ('user-admin', 'admin@app.test')").run();
db.prepare("INSERT OR IGNORE INTO User (id, email) VALUES ('user-staff', 'staff@app.test')").run();
db.prepare("INSERT OR IGNORE INTO User (id, email) VALUES ('user-reader', 'user@app.test')").run();

db.close();
console.log('test.db created at', dbPath);
