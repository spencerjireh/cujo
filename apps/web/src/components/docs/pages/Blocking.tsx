import { StatusBadge } from "@/components/StatusBadge";
import { C, Cell, Note, P, Row, Section, Table } from "@/components/docs/Prose";
import { STATUS_LINE } from "@/lib/api/status-line";
import { RUN_STATUSES } from "@/lib/api/types";

/**
 * The status table is built from `RUN_STATUSES` and `STATUS_LINE`, so a status
 * added in `apps/cujo` appears here without anyone remembering, and says the
 * same sentence the run page says.
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
  superseded: "none",
};

/** What the `cujo/guard` check run says on the commit. */
const CHECK: Partial<Record<(typeof RUN_STATUSES)[number], string>> = {
  running: "in progress",
  clean: "success",
  blocked: "failure",
  dismissed: "neutral",
  error: "neutral",
  unproven: "neutral",
  superseded: "skipped",
};

export function Blocking() {
  return (
    <>
      <Section id="block" title="What blocks">
        <P>
          Any <C>critical</C> finding blocks. Cujo posts the review as REQUEST_CHANGES and the{" "}
          <C>cujo/guard</C> check fails. With no critical finding, the review is a comment and the
          check passes. Cujo never approves.
        </P>
        <P>
          A review can be dismissed by anyone with write access. The check cannot; only Cujo can
          change it. That is why the merge lock is the check. Require it in branch protection, or a
          block does not hold the merge.
        </P>
      </Section>

      <Section id="unlock" title="Lifting a block">
        <P>Comment one of these, alone on its own line, on the pull request:</P>
        <Table head={["Command", "Does", "Who may"]}>
          <Row>
            <Cell head>/cujo dismiss</Cell>
            <Cell>
              Dismisses the blocking review on the current commit and sets the check to neutral. The
              findings stay.
            </Cell>
            <Cell>Anyone with write access, except the author and bot accounts.</Cell>
          </Row>
          <Row>
            <Cell head>/cujo review</Cell>
            <Cell>Reviews the current commit again.</Cell>
            <Cell>Anyone with write access.</Cell>
          </Row>
        </Table>
        <P>
          The author cannot dismiss a block on their own change, and a coding agent cannot dismiss a
          block on its own work. Cujo reacts to the command with a thumbs up when it applied and a
          confused face when it refused. A command inside a code block or a quote does not count.
        </P>
        <Note>
          A new commit gets a new run and a new check. A dismissal does not carry over to it.
        </Note>
      </Section>

      <Section id="statuses" title="Run states">
        <Table head={["Status", "Means", "Reaction", "Check"]}>
          {RUN_STATUSES.map((status) => (
            <Row key={status}>
              <Cell head>
                <StatusBadge status={status} />
              </Cell>
              <Cell>{STATUS_LINE[status]}</Cell>
              <Cell>{REACTION[status] ?? "none"}</Cell>
              <Cell>{CHECK[status] ?? "none"}</Cell>
            </Row>
          ))}
        </Table>
        <P>
          Red means the pull request has a critical finding. When Cujo itself fails, the run is
          blue, not red.
        </P>
      </Section>
    </>
  );
}
