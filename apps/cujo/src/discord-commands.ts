/**
 * The `/cujo` slash command (spec Contract 8). One command with four
 * subcommands, so a server gets a single entry in Discord's picker.
 *
 * The channel and role are Discord's own option types, which render as native
 * pickers — nothing is typed by hand except the repo, and that is completed
 * from the repos the Cujo App is installed on.
 */

/** Discord application command option types. */
const SUB_COMMAND = 1;
const STRING = 3;
const CHANNEL = 7;
const ROLE = 8;

/** Guild text and announcement: the only channels a card can be posted to. */
const POSTABLE_CHANNELS = [0, 5];

/**
 * `Manage Guild`. Discord enforces this itself, hiding the command from
 * everyone below the bar, which is a gate no request of ours has to survive.
 * The handler checks it again anyway (decision 28): a server admin can change
 * this default, and a permission check that lives only on the client is not a
 * permission check.
 */
export const MANAGE_GUILD = "32";

const repoOption = {
  type: STRING,
  name: "repo",
  description: "The repository, as owner/name",
  required: true,
  autocomplete: true,
};

export const CUJO_COMMAND = {
  name: "cujo",
  description: "Cujo review notifications for this server",
  // Guild-only: every subcommand acts on a server's channels and roles.
  contexts: [0],
  default_member_permissions: MANAGE_GUILD,
  options: [
    {
      type: SUB_COMMAND,
      name: "watch",
      description: "Send this repo's review updates to a channel",
      options: [
        repoOption,
        {
          type: CHANNEL,
          name: "channel",
          description: "Where the cards go",
          required: true,
          channel_types: POSTABLE_CHANNELS,
        },
        {
          type: ROLE,
          name: "role",
          description: "Mentioned when a review blocks a pull request",
          required: false,
        },
      ],
    },
    {
      type: SUB_COMMAND,
      name: "unwatch",
      description: "Stop sending this repo's review updates here",
      options: [repoOption],
    },
    {
      type: SUB_COMMAND,
      name: "status",
      description: "What this server is watching, and where",
    },
    {
      type: SUB_COMMAND,
      name: "test",
      description: "Post a sample card, to prove the whole path works",
      options: [repoOption],
    },
  ],
};

export const COMMANDS: unknown[] = [CUJO_COMMAND];
