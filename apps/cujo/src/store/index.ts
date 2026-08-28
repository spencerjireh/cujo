/**
 * One database, two stores. `Store` owns the connection and nothing else —
 * deliberately no delegating methods, because a facade that forwarded
 * `getRun` and `getDiscordChannel` alike would compile the moment it was
 * written and leave every consumer holding the same wide dependency the split
 * exists to remove.
 *
 * Consumers take the half they need. Only the notifier needs both.
 */

import { type Db, openDatabase } from "./db";
import { NotificationStore } from "./notifications";
import { RunStore } from "./runs";

export { RunStore } from "./runs";
export { NotificationStore } from "./notifications";

export class Store {
  private readonly db: Db;
  readonly notifications: NotificationStore;
  readonly runs: RunStore;

  constructor(path: string) {
    this.db = openDatabase(path);
    this.notifications = new NotificationStore(this.db);
    this.runs = new RunStore(this.db, this.notifications);
  }

  close(): void {
    this.db.close();
  }
}
