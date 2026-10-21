import type { BotState, Health, InstanceSettings, OwnedRepository } from "@/lib/api/owner-client";
import type { OwnerRunSummary as RunSummary } from "@/lib/api/types";
import { describeHealth, describePermissions } from "./instance";

/**
 * What an owner's activity page says, decided without a component (decision
 * 175): which setup steps are left, which pull requests need a person, and
 * each repository's newest run. Every input is something the owner plane
 * already serves; `/owner/runs` is the newest 100 runs across all
 * repositories, so a quiet repository can have no run here.
 */

export interface SetupStep {
  id: "app" | "provider" | "model" | "repository";
  title: string;
  done: boolean;
  /** What to do, or what is wrong, while the step is not done. */
  detail: string;
  /** Where the step is done, and what the link says. External for GitHub's own pages. */
  href: string;
  action: string;
  external?: boolean;
}

/**
 * The four steps between installing Cujo and a first review. A step whose
 * input did not load is not done and says so, rather than passing quietly.
 */
export function setupSteps(input: {
  bot: BotState | null | undefined;
  settings: InstanceSettings | null | undefined;
  health: Health | null | undefined;
  repositories: OwnedRepository[] | null | undefined;
}): SetupStep[] {
  const { bot, settings, health, repositories } = input;

  const installed = bot ? bot.installations.some((i) => !i.suspended) : false;
  const permitted = bot ? bot.permissions.every((p) => p.ok) : false;
  const app: SetupStep = {
    id: "app",
    title: "Install the GitHub App",
    done: installed && permitted,
    detail: !bot
      ? "GitHub did not answer. Reload to try again."
      : !installed
        ? "The App is not installed, or every installation is suspended."
        : describePermissions(bot.permissions),
    // Not installed: GitHub's install page. Short of a permission: the App's
    // public page, which links its settings for whoever owns it.
    href: !bot
      ? "/settings#app"
      : installed
        ? bot.app.htmlUrl
        : `${bot.app.htmlUrl}/installations/new`,
    action: !bot ? "Open settings" : installed ? "Open the App on GitHub" : "Install the App",
    external: Boolean(bot),
  };

  const providers = settings?.modelProviders.length ?? 0;
  const provider: SetupStep = {
    id: "provider",
    title: "Add a model provider",
    done: providers > 0,
    detail: "Add Anthropic or an OpenAI-compatible provider and its API key.",
    href: "/settings#providers",
    action: "Add a provider",
  };

  const model: SetupStep = {
    id: "model",
    title: "Pick a model",
    done: Boolean(settings?.model) && Boolean(health?.configured) && Boolean(health?.ready),
    detail: !settings?.model
      ? "No model is chosen. Pull requests get no review."
      : health && !health.ready
        ? describeHealth(health)
        : "No provider matches this model. Check the model name.",
    href: "/settings#models",
    action: "Pick a model",
  };

  const enabled = (repositories ?? []).some((r) => r.enabled && r.removedAt === null);
  const repository: SetupStep = {
    id: "repository",
    title: "Turn on a repository",
    done: enabled,
    detail: "Turn on at least one repository.",
    href: "/repos",
    action: "Choose repositories",
  };

  return [app, provider, model, repository];
}

const key = (run: RunSummary) => `${run.repo.toLowerCase()}#${run.pr_number}`;

/**
 * The newest run of each pull request. An older run of the same pull request
 * may still say `blocked` after a newer commit replaced it, so anything that
 * asks "is this pull request blocked" asks this list.
 */
export function latestPerPullRequest(runs: RunSummary[]): RunSummary[] {
  const seen = new Map<string, RunSummary>();
  for (const run of runs) {
    const prior = seen.get(key(run));
    if (!prior || run.created_at > prior.created_at) seen.set(key(run), run);
  }
  return [...seen.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * The pull requests that need a person: a block only a maintainer can lift,
 * or a run Cujo itself failed, which needs a re-run.
 */
/**
 * Whether the pull request is merged or closed (decision 179). Unknown is
 * open: a pull request cujo never heard close about still asks for attention
 * rather than vanishing on a guess.
 */
export function isClosed(run: RunSummary): boolean {
  return run.pr_state === "closed" || run.pr_state === "merged";
}

export function needsYou(runs: RunSummary[]): RunSummary[] {
  return latestPerPullRequest(runs).filter(
    (run) => !isClosed(run) && (run.status === "blocked" || run.status === "error"),
  );
}

/** Each repository's newest run, keyed by the lower-cased `owner/name`. */
export function lastRunPerRepository(runs: RunSummary[]): Map<string, RunSummary> {
  const last = new Map<string, RunSummary>();
  for (const run of runs) {
    const repo = run.repo.toLowerCase();
    const prior = last.get(repo);
    if (!prior || run.created_at > prior.created_at) last.set(repo, run);
  }
  return last;
}

/** How many pull requests in a repository are blocked on their newest run. */
export function openBlocks(runs: RunSummary[], repo: string): number {
  const name = repo.toLowerCase();
  return latestPerPullRequest(runs).filter(
    (run) => run.repo.toLowerCase() === name && run.status === "blocked" && !isClosed(run),
  ).length;
}
