export const DB_NAME = 'productivity-db';
export const DB_VERSION = 1;

export function onUpgrade(db, oldVersion) {
  if (oldVersion < 1) {
    // Notes
    const notes = db.createObjectStore('notes', { keyPath: 'id' });
    notes.createIndex('updatedAt', 'updatedAt');
    notes.createIndex('pinned', 'pinned');
    notes.createIndex('linkedDates', 'linkedDates', { multiEntry: true });

    // Calendar events + meetings
    const events = db.createObjectStore('events', { keyPath: 'id' });
    events.createIndex('date', 'date');
    events.createIndex('type', 'type');
    events.createIndex('noteId', 'noteId');

    // File attachments
    const attachments = db.createObjectStore('attachments', { keyPath: 'id' });
    attachments.createIndex('parentId', 'parentId');

    // Business goals
    const goals = db.createObjectStore('goals', { keyPath: 'id' });
    goals.createIndex('status', 'status');
    goals.createIndex('targetDate', 'targetDate');

    // Tasks (children of goals)
    const tasks = db.createObjectStore('tasks', { keyPath: 'id' });
    tasks.createIndex('goalId', 'goalId');
    tasks.createIndex('done', 'done');
    tasks.createIndex('dueDate', 'dueDate');
  }
}
