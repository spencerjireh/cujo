/**
 * Who counts as an owner (decision 153): any admin of an installation of
 * this App. For an installation on a user account that is the account
 * itself; for one on an organisation it is anyone GitHub calls an admin of
 * that organisation. Decided once at sign-in and kept on the session.
 */

import type { GitHubOAuth, OAuthInstallation, OAuthUser } from "../clients/github-oauth";

export interface OwnerVerdict {
  isOwner: boolean;
  /** The installations that made the verdict true, by account login. */
  through: string[];
}

export async function resolveOwner(
  appId: number,
  user: OAuthUser,
  installations: readonly OAuthInstallation[],
  oauth: Pick<GitHubOAuth, "orgRole">,
  token: string,
): Promise<OwnerVerdict> {
  const through: string[] = [];
  for (const installation of installations) {
    if (installation.appId !== appId) continue;
    if (installation.account.type === "User") {
      if (installation.account.id === user.id) through.push(installation.account.login);
      continue;
    }
    if ((await oauth.orgRole(token, installation.account.login)) === "admin") {
      through.push(installation.account.login);
    }
  }
  return { isOwner: through.length > 0, through };
}
