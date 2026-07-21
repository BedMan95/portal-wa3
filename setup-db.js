const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const dbPath = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const db = new Database(dbPath);

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    message TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS schedules (
    id TEXT PRIMARY KEY,
    targets TEXT,
    groups TEXT,
    message TEXT,
    mediaUrl TEXT,
    templateName TEXT,
    scheduleType TEXT NOT NULL,
    scheduleData TEXT,
    createdAt TEXT NOT NULL
  );
`);

// Migrate Users
if (fs.existsSync('users.json')) {
    const users = JSON.parse(fs.readFileSync('users.json', 'utf-8'));
    const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)');
    users.forEach(u => {
        // If password is not hashed (doesn't start with $2a$ or $2b$), hash it
        const pwd = u.password.startsWith('$2') ? u.password : bcrypt.hashSync(u.password, 10);
        insertUser.run(u.username, pwd);
    });
    console.log('Users migrated.');
} else {
    // Seed default admin if no users exist
    const count = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
    if (count === 0) {
        const hash = bcrypt.hashSync('password123', 10);
        db.prepare('INSERT INTO users (username, password) VALUES (?, ?)').run('admin', hash);
        console.log('Default admin created (admin / password123).');
    }
}

// Migrate Templates
if (fs.existsSync('templates.json')) {
    const templates = JSON.parse(fs.readFileSync('templates.json', 'utf-8'));
    const insertTemplate = db.prepare('INSERT OR IGNORE INTO templates (name, message) VALUES (?, ?)');
    templates.forEach(t => insertTemplate.run(t.name, t.message));
    console.log('Templates migrated.');
}

// Migrate Schedules
if (fs.existsSync('schedules.json')) {
    const schedules = JSON.parse(fs.readFileSync('schedules.json', 'utf-8'));
    const insertSchedule = db.prepare('INSERT OR IGNORE INTO schedules (id, targets, groups, message, mediaUrl, templateName, scheduleType, scheduleData, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    schedules.forEach(s => {
        insertSchedule.run(
            s.id,
            JSON.stringify(s.targets || []),
            JSON.stringify(s.groups || []),
            s.message || null,
            s.mediaUrl || null,
            s.templateName || null,
            s.scheduleType,
            JSON.stringify(s.scheduleData || {}),
            s.createdAt
        );
    });
    console.log('Schedules migrated.');
}

console.log('Database setup complete.');
db.close();
