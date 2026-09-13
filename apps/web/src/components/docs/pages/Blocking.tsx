import { StatusBadge } from "@/components/StatusBadge";
import { C, Cell, LI, Lead, Note, P, Row, Section, Table, UL } from "@/components/docs/Prose";
import { STATUS_LINE } from "@/lib/api/status-line";
import { RUN_STATUSES } from "@/lib/api/types";
import Link from "next/link";

/**
 * The status table is built from `RUN_STATUSES` and `STATUS_LINE`, so a status
 * added in `apps/cujo` appears here without anyone remembering, and says the
 * same sentence a link preview says about the same run.
 *
 * The reaction and check columns are prose: neither vocabulary has a
 * representation in this app.
 */

/** The reaction a pull request wears, which is not the same claim as the status. */
const REACTION: Partial<Record<(typeof RUN_STATUSES)[number], string>> = {
  running: "eyes",
  clean: "hooray",
  blocked: "thumbs down",
  dismissed: "thumbs up",
  error: "confused",
  unproven: "confused",
  superseded: "nothing",
};

/** What the `cujo/guard` check run says on the commit. */
const CHECK: Partial<Record<(typeof RUN_STATUSES)[number], string>> = {
  running: "in progress",
  clean: "success",
  blocked: "failure",
  dismissed: "neutral, naming who dismissed it",
  error: "neutral",
  unproven: "neutral",
  superseded: "skipped, unless a newer run owns the commit",
};

export function Blocking() {
  return (
    <>
      <Section id="who-decides" title="The verdict comes from the tool, not from the model">
        <Lead>
          The agent chooses which of two tools to call. Which tool it called is what makes a review
          advisory or blocking — so a model cannot talk its way to a softer verdict after the fact,
          and nothing waits for a person before it posts.
        </Lead>
        <Table head={["Situation", "What posts"]}>
          <Row>
            <Cell head>
              No <C>critical</C> finding
            </Cell>
            <Cell>A comment review, with the findings and the inline comments.</Cell>
          </Row>
          <Row>
            <Cell head>
              Any <C>critical</C> finding
            </Cell>
            <Cell>
              REQUEST_CHANGES, at once. A broken test, a probe that contradicts the diff, a decoy
              secret read, an install that called an unknown host: all of them block the same way.
            </Cell>
          </Row>
        </Table>
        <P>
          Cujo never posts APPROVE. It cannot satisfy branch protection, so it can never wave a bad
          merge through by staying quiet.
        </P>
      </Section>

      <Section id="lock" title="The lock is a check run">
        <P>
          A review can be dismissed by anyone with write access — a coding agent with write access
          included. A check run cannot be dismissed at all: only the App that owns it can complete
          it. So beside every review, Cujo writes a check run named <C>cujo/guard</C> on the commit
          it reviewed, and moves it as the run moves: in progress from the moment the commit is
          claimed, success on a clean run, failure on a block.
        </P>
        <P>
          To make the block hold the merge, require the check in branch protection:{" "}
          <em>Require status checks to pass</em>, and pick <C>cujo/guard</C>. The check appears in
          the picker once the App has written one. Without that setting a block is still a
          REQUEST_CHANGES review and a red mark on the commit, and nothing more.
        </P>
        <Note>
          The check needs the <C>Checks: write</C> permission on the App, which every installation
          has to approve once. Until it has, the review and the reaction post as before and the
          check is not written.
        </Note>
      </Section>

      <Section id="unlock" title="The unlock, on the pull request">
        <P>
          A block is lifted by a person, and only by a person. Two verbs exist, each alone on its
          own line in a comment. They are matched as exact strings by the service and never by a
          model, and a line inside a code fence, a blockquote or an HTML comment does not count — if
          a reader cannot see it, it is not a command.
        </P>
        <Table head={["Command", "Does", "Who may"]}>
          <Row>
            <Cell head>/cujo dismiss</Cell>
            <Cell>
              Dismisses Cujo&rsquo;s blocking review on the current commit and turns the check
              neutral, naming who dismissed it. The findings and their evidence stay on the pull
              request; only the block is lifted.
            </Cell>
            <Cell>
              Anyone with write access <strong className="font-medium text-fg">except</strong> the
              pull request&rsquo;s author, and never a bot account.
            </Cell>
          </Row>
          <Row>
            <Cell head>/cujo review</Cell>
            <Cell>
              Reviews the current head again. Its main use is a pull request Cujo never saw; any
              earlier run for that commit is replaced.
            </Cell>
            <Cell>Anyone with write access, the author included.</Cell>
          </Row>
        </Table>
        <P>
          The author may not dismiss, because that is the direction that lifts a block on their own
          change. A bot account may not dismiss whatever access it holds, because the unlock exists
          to be the one thing a coding agent cannot do to the block it earned; GitHub&rsquo;s own
          word for the account is what decides it, before any permission is read. A new commit gets
          its own run, its own review and its own check, so a block is never carried forward — and
          never dismissed forward either.
        </P>
        <P>
          Write access is read from GitHub on every command, and every outcome speaks on the pull
          request — a refusal nobody can see is indistinguishable from a delivery that never
          arrived. The command comment gets a thumbs up when it was applied and a confused face when
          it was refused.
        </P>
      </Section>

      <Section id="statuses" title="The seven run states">
        <Table head={["Status", "Means", "Reaction", "Check"]}>
          {RUN_STATUSES.map((status) => (
            <Row key={status}>
              <Cell head>
                <StatusBadge status={status} />
              </Cell>
              <Cell>{STATUS_LINE[status]}</Cell>
              <Cell>{REACTION[status] ?? "—"}</Cell>
              <Cell>{CHECK[status] ?? "—"}</Cell>
            </Row>
          ))}
        </Table>
        <UL>
          <LI>
            The reactions describe what happened to the pull request, not what Cujo concluded —
            which is why a dismissed block leaves a thumbs up even though the findings stand.
          </LI>
          <LI>
            Red is reserved for a pull request that is dangerous, never for Cujo falling over, so a
            run that errored is drawn in the same blue as a clean one at reduced strength.
          </LI>
          <LI>
            A superseded run writes no reaction at all. The run that replaced it is about to say
            what the pull request should show. Its check is per commit, so it is marked skipped —
            unless the replacement reviews the same commit, which then owns the check.
          </LI>
          <LI>
            A diff review reaches three of these: <C>running</C>, <C>clean</C> and <C>error</C>. Its{" "}
            <C>clean</C> is an advisory review with findings of at most <C>warn</C>, and never{" "}
            <C>unproven</C>, since it never had evidence to post; the run page and the record mark
            it <C>diff review</C> so the two kinds of <C>clean</C> are not confused.
          </LI>
        </UL>
        <P>
          What each state looks like on the board is on{" "}
          <Link href="/docs/board" className="text-accent underline underline-offset-4">
            reading the board
          </Link>
          .
        </P>
      </Section>
    </>
  );
}
