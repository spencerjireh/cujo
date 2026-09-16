import type { BotState, Health, InstanceSettings } from "@/lib/api/owner-client";

/**
 * What the instance page says, decided without a component (decision 157):
 * whether the App holds what the reviews need, what a delivery's status
 * means, and which settings changed from what the environment seeded.
 */

/** One line for the permissions strip: all held, or which are short. */
export function describePermissions(permissions: BotState["permissions"]): string {
  const short = permissions.filter((p) => !p.ok);
  if (short.length === 0) return "The App holds every permission the reviews need.";
  const names = short.map(
    (p) => `${p.name} (${p.needed}${p.held ? `, holds ${p.held}` : ", holds none"})`,
  );
  return `Short of what the reviews need: ${names.join("; ")}. Grant it on the App's settings page, then accept it on the installation.`;
}

/** A delivery's tone: answered, refused, or never reached. */
export function deliveryTone(delivery: BotState["deliveries"][number]): "ok" | "warn" | "critical" {
  if (delivery.statusCode === null) return "critical";
  if (delivery.statusCode >= 200 && delivery.statusCode < 300) return "ok";
  if (delivery.statusCode === 503) return "warn";
  return "critical";
}

/** One sentence on the process: ready, or what it is waiting on. */
export function describeHealth(health: Health): string {
  if (health.ready) return "Ready: the harness has its settings and the store answers.";
  if (health.store !== "ok")
    return "Not ready: the store does not answer, so no run can be claimed.";
  return "Not ready: the harness is still registering its settings, so deliveries are deferred with 503.";
}

/** The keys an owner changed from what the environment seeded, in display order. */
export function changedKeys(
  sources: Record<keyof InstanceSettings, "seed" | "owner">,
): (keyof InstanceSettings)[] {
  return (Object.keys(sources) as (keyof InstanceSettings)[]).filter(
    (key) => sources[key] === "owner",
  );
}
