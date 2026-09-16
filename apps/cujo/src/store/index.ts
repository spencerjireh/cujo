/**
 * One database, eight stores. `Store` owns the connection and nothing else —
 * deliberately no delegating methods, because a facade that forwarded
 * `getRun` and `getDiscordChannel` alike would compile the moment it was
 * written and leave every consumer holding the same wide dependency the split
 * exists to remove.
 *
 * Consumers take the half they need. Only the notifier needs both.
 */

import { type Db, openDatabase } from "./db";
import { DetonationCacheStore } from "./detonations";
import { ExecutionStore } from "./executions";
import { NotificationStore } from "./notifications";
import { OcrReviewStore } from "./ocr";
import { RepositoryStore } from "./repositories";
import { RepositorySettingsStore } from "./repository-settings";
import { RunStore } from "./runs";
import { SettingsStore } from "./settings";
import { WebSessionStore } from "./web-sessions";

export { RunStore } from "./runs";
export { NotificationStore } from "./notifications";
export { DetonationCacheStore } from "./detonations";
export { ExecutionStore } from "./executions";
export { OcrReviewStore } from "./ocr";
export { RepositoryStore } from "./repositories";
export { RepositorySettingsStore } from "./repository-settings";
export { SettingsStore } from "./settings";
export { WebSessionStore } from "./web-sessions";

export class Store {
  private readonly db: Db;
  readonly notifications: NotificationStore;
  readonly runs: RunStore;
  readonly detonations: DetonationCacheStore;
  readonly executions: ExecutionStore;
  readonly ocr: OcrReviewStore;
  readonly repositories: RepositoryStore;
  readonly repositorySettings: RepositorySettingsStore;
  readonly settings: SettingsStore;
  readonly webSessions: WebSessionStore;

  constructor(path: string) {
    this.db = openDatabase(path);
    this.notifications = new NotificationStore(this.db);
    this.runs = new RunStore(this.db, this.notifications);
    this.detonations = new DetonationCacheStore(this.db);
    this.executions = new ExecutionStore(this.db);
    this.ocr = new OcrReviewStore(this.db);
    this.repositories = new RepositoryStore(this.db);
    this.repositorySettings = new RepositorySettingsStore(this.db);
    this.settings = new SettingsStore(this.db);
    this.webSessions = new WebSessionStore(this.db);
  }

  close(): void {
    this.db.close();
  }
}
