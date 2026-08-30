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
 * The reaction table is prose: GitHub's reaction set has no representation in
 * this app.
 */

/** The reaction a pull request wears, which is not the same claim as the status. */
const REACTION: Partial<Record<(typeof RUN_STATUSES)[number], string>> = {
  running: "eyes",
  clean: "hooray",
  blocked_pending: "eyes, rocket",
  blocked_unattended: "thumbs down",
  blocked_posted: "thumbs down",
  denied: "thumbs up",
  error: "confused",
  superseded: "nothing",
};

export function TheGate() {
  return (
    <>
      <Section id="who-decides" title="The verdict comes from the tool, not from the model">
        <Lead>
          The agent chooses which of three tools to call. Which tool it called is what makes a
          review advisory, blocking or held — so a model cannot talk its way to a softer verdict
          after the fact.
        </Lead>
        <Table head={["Situation", "What posts", "Waits for a person?"]}>
          <Row>
            <Cell head>
              No <C>critical</C> finding
            </Cell>
            <Cell>A comment review, with the findings and the inline comments.</Cell>
            <Cell>No</Cell>
          </Row>
          <Row>
            <Cell head>
              Every <C>critical</C> is about correctness
            </Cell>
            <Cell>REQUEST_CHANGES, unattended. Cujo blocks on its own authority.</Cell>
            <Cell>No</Cell>
          </Row>
          <Row>
            <Cell head>
              A <C>critical</C> accuses the change of malice
            </Cell>
            <Cell>
              The observation posts first, as a held <C>warn</C>. The conclusion waits.
            </Cell>
            <Cell>Yes</Cell>
          </Row>
        </Table>
        <P>
          Cujo never posts APPROVE. It cannot satisfy branch protection, so it can never wave a bad
          merge through by staying quiet.
        </P>
      </Section>

      <Section id="accusation" title="Why only the accusation waits">
        <P>
          Blocking a merge because a test broke is mechanical and nobody is harmed by it being wrong
          for an hour. Saying that a change tried to read a credential is an accusation, and a
          person holds information the sandbox cannot: they know the host, or the package, or the
          fixture that touches a fake credentials file on purpose.
        </P>
        <P>
          So a malice finding posts twice. The observation goes up immediately — with the evidence,
          marked held — and the conclusion is drafted and paused inside the harness until somebody
          answers. Nothing about the held conclusion is published in the meantime, on the pull
          request or on this board. Publishing it early is exactly what the gate exists to prevent.
        </P>
        <Note>
          A held approval has no deadline. It waits until a person answers or a new commit
          supersedes it. The merge is not blocked while it waits, and nothing expires it.
        </Note>
      </Section>

      <Section id="answering" title="Answering, on the pull request">
        <P>
          Three verbs, each alone on its own line in a comment. They are matched as exact strings by
          the service and never by a model, and a line inside a code fence, a blockquote or an HTML
          comment does not count — if a reader cannot see it, it is not a command.
        </P>
        <Table head={["Command", "Does", "Who may"]}>
          <Row>
            <Cell head>/cujo confirm</Cell>
            <Cell>Publishes the held conclusion as a blocking review.</Cell>
            <Cell>Anyone with write access, the author included.</Cell>
          </Row>
          <Row>
            <Cell head>/cujo dismiss</Cell>
            <Cell>
              Publishes nothing further. The observation and its evidence stay on the pull request;
              only the claim about a person is dropped.
            </Cell>
            <Cell>
              Anyone with write access <strong className="font-medium text-fg">except</strong> the
              pull request&rsquo;s author.
            </Cell>
          </Row>
          <Row>
            <Cell head>/cujo review</Cell>
            <Cell>
              Reviews the current head again. Its main use is a pull request Cujo never saw; any
              earlier run for that commit is replaced.
            </Cell>
            <Cell>Anyone with write access.</Cell>
          </Row>
        </Table>
        <P>
          The author may confirm, because acting against your own interest needs no guard. The
          author may not dismiss, because that is the direction that buries an accusation against
          their own change.
        </P>
        <P>
          Write access is read from GitHub on every command, and every outcome speaks on the pull
          request — a refusal nobody can see is indistinguishable from a delivery that never
          arrived. The command comment gets a thumbs up when it was applied and a confused face when
          it was refused.
        </P>
      </Section>

      <Section id="statuses" title="The eight run states">
        <Table head={["Status", "Means", "Reaction"]}>
          {RUN_STATUSES.map((status) => (
            <Row key={status}>
              <Cell head>
                <StatusBadge status={status} />
              </Cell>
              <Cell>{STATUS_LINE[status]}</Cell>
              <Cell>{REACTION[status] ?? "—"}</Cell>
            </Row>
          ))}
        </Table>
        <UL>
          <LI>
            The reactions describe what happened to the pull request, not what Cujo concluded —
            which is why a dismissed finding leaves a thumbs up even though the observation stands.
          </LI>
          <LI>
            Red is reserved for a pull request that is dangerous, never for Cujo falling over, so a
            run that errored is drawn in the same blue as a clean one at reduced strength.
          </LI>
          <LI>
            A superseded run writes no reaction at all. The run that replaced it is about to say
            what the pull request should show.
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
