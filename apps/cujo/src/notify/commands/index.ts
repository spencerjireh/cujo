/**
 * What `/cujo` does, once the interactions endpoint has verified the signature
 * and established who is asking (spec Contract 8).
 *
 * Nothing in this directory knows what a Discord interaction looks like. The
 * endpoint pulls the options out and passes plain values, so these are ordinary
 * functions returning the line the invoker sees — testable without a signature,
 * a deferred reply, or an interaction envelope.
 *
 * They route notifications and nothing else. There is no approve command and
 * adding one is a change to the human gate, not a feature (decision 28); the
 * NotificationStore they hold has no way to reach a run's decision, which is
 * what keeps that true rather than remembered.
 */

import type { DiscordClient } from "../../clients/discord";
import type { GitHubReader } from "../../clients/github";
import type { UiLinks } from "../../review/links";
import type { NotificationStore } from "../../store";
import { authorizationFor, explain } from "../authorization";
import { status } from "./status";
import { test } from "./test";
import { unwatch } from "./unwatch";
import { watch } from "./watch";

export interface CommandDeps {
  store: NotificationStore;
  discord: DiscordClient;
  github: GitHubReader;
  links: UiLinks;
}

export interface CommandInput {
  /** The subcommand name, straight from Discord; unknown names are answered. */
  name: string;
  guildId: string;
  userId: string;
  repo: string | null;
  channelId: string | null;
  roleId: string | null;
}

const REPO = /^[A-Za-z0-9._-]{1,100}\/[A-Za-z0-9._-]{1,100}$/;

/**
 * The dispatch, and the order the checks run in — which is load-bearing, so it
 * lives here beside the handlers it orders rather than in the HTTP shell.
 */
export async function runCommand(deps: CommandDeps, input: CommandInput): Promise<string> {
  if (input.name === "status") return status(deps, input.guildId);

  if (!input.repo || !REPO.test(input.repo)) {
    return "That does not look like an `owner/name` repository.";
  }
  const repo = input.repo.toLowerCase();

  // Deliberately ahead of every other check: a server must always be able to
  // stop receiving. Gating this behind authorization or the App's installation
  // list would mean a repo that revoked its declaration, or was uninstalled,
  // left the channel unable to clean itself up.
  if (input.name === "unwatch") return unwatch(deps, { guildId: input.guildId, repo });

  // Checked before authorization so the refusal names the real problem: a repo
  // the App cannot see has no readable `.cujo.yml` either, and "it has not
  // named this server" would send someone editing a file that Cujo could not
  // read anyway. Only a list Cujo actually read can refuse.
  const installed = await deps.github.installedRepos().catch(() => null);
  if (installed && !installed.some((full) => full.toLowerCase() === repo)) {
    return `Cujo's GitHub App is not installed on \`${repo}\`, so it would never have anything to send.`;
  }

  // The repo says which server may have its reviews; the server says which
  // channel. Both halves are needed (decision 31).
  const authorization = await authorizationFor(deps, input.guildId, repo);
  if (!authorization.allowed) return explain(repo, input.guildId, authorization);

  if (input.name === "watch") {
    return watch(deps, {
      guildId: input.guildId,
      userId: input.userId,
      repo,
      channelId: input.channelId,
      roleId: input.roleId,
    });
  }
  if (input.name === "test") return test(deps, input.guildId, repo);
  return "Unknown command.";
}
