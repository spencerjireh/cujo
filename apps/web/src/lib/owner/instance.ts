import type { BotState, Health, InstanceSettings } from "@/lib/api/owner-client";

/**
 * What the instance page says, decided without a component (decision 157):
 * whether the App holds what the reviews need, what a delivery's status
 * means, and which settings changed from what the environment seeded.
 */

/** One line for the permissions strip: all held, or which are short. */
export function describePermissions(permissions: BotState["permissions"]): string {
  const short = permissions.filter((p) => !p.ok);
  if (short.length === 0) return "The App has every permission it needs.";
  const names = short.map(
    (p) => `${p.name} (${p.needed}${p.held ? `, holds ${p.held}` : ", holds none"})`,
  );
  return `Missing permissions: ${names.join("; ")}. Grant them in the App settings, then accept on the installation.`;
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
  if (health.ready) return "Ready.";
  if (health.store !== "ok") return "Database unreachable.";
  return "Starting up.";
}

/** The keys an owner changed from what the environment seeded, in display order. */
export function changedKeys(
  sources: Record<keyof InstanceSettings, "seed" | "owner">,
): (keyof InstanceSettings)[] {
  return (Object.keys(sources) as (keyof InstanceSettings)[]).filter(
    (key) => sources[key] === "owner",
  );
}
