import { SeverityBadge } from "@/components/SeverityBadge";
import { C, Cell, LI, P, Pre, Row, Section, Table, UL } from "@/components/docs/Prose";
import { SEVERITIES } from "@/lib/api/types";
import Link from "next/link";

const LINK = "text-accent underline underline-offset-4";

/**
 * Reading a review: the checks, the severities, new pushes, questions, and
 * who can see a run.
 *
 * The severity table is built from `SEVERITIES`, with the same badge the run
 * pages use, so a severity word that `apps/cujo` matches literally is never
 * retyped here.
 */

const WHAT_EACH_MEANS: Record<(typeof SEVERITIES)[number], string> = {
  critical:
    "Something is wrong: a test that passed on base fails on head, an endpoint that worked now errors, or the code did something unsafe. Blocks the merge.",
  warn: "Worth a look: changed code with no test, a write outside the project, an unexpected host, or a check that returned nothing.",
  info: "What ran and what it showed, when nothing is wrong.",
};

export function Reviews() {
  return (
    <>
      <Section id="checks" title="What Cujo runs">
        <Table head={["Check", "What it does"]}>
          <Row>
            <Cell head>tests</Cell>
            <Cell>
              Runs your test suite on the base and the head, and lists tests that pass on base and
              fail on head.
            </Cell>
          </Row>
          <Row>
            <Cell head>probes</Cell>
            <Cell>
              Writes small scripts that call the changed code, states what it expects, and runs
              them.
            </Cell>
          </Row>
          <Row>
            <Cell head>smoke</Cell>
            <Cell>Boots the app and calls its endpoints, on the head and on the base.</Cell>
          </Row>
          <Row>
            <Cell head>detonation</Cell>
            <Cell>
              Runs when a dependency is added or upgraded. Installs each one alone and records the
              hosts it contacted, the files it changed and the processes it started.
            </Cell>
          </Row>
        </Table>
        <P>
          A diff review (<C>mode: diff</C>) runs none of these. It only reads the diff, so its
          findings are at most <C>warn</C>.
        </P>
      </Section>

      <Section id="severity" title="Severity">
        <Table head={["Severity", "What it means"]}>
          {SEVERITIES.map((severity) => (
            <Row key={severity}>
              <Cell head>
                <SeverityBadge severity={severity} />
              </Cell>
              <Cell>{WHAT_EACH_MEANS[severity]}</Cell>
            </Row>
          ))}
        </Table>
        <P>Some findings are always critical. The model cannot lower them:</P>
        <UL>
          <LI>A test passes on base and fails on head.</LI>
          <LI>The code read or sent a test secret that Cujo planted in the sandbox.</LI>
          <LI>The code wrote to an SSH, shell startup, cron or credentials path.</LI>
          <LI>
            A new dependency&rsquo;s install contacted a host that is not a package registry and not
            in <C>allow_hosts</C>.
          </LI>
        </UL>
        <P>
          Each finding has a title, the evidence (the failing assertion, the host, the path), and
          for a critical one, the next step to take. Findings about a line appear as inline
          comments.
        </P>
      </Section>

      <Section id="pushes" title="New pushes">
        <P>
          Cujo reviews only the newest commit. A push while a run is going stops that run and marks
          it outdated. Cujo does not review the same commit twice. To review it again, comment{" "}
          <C>/cujo review</C>.
        </P>
      </Section>

      <Section id="questions" title="Asking questions">
        <P>
          Mention <C>@cujo-guard</C> in a pull request comment or in a review thread. It runs the
          code again to answer, and replies where you asked.
        </P>
        <Pre>
          {
            "@cujo-guard that endpoint needs orders to exist.\nSeed the database first and try it again."
          }
        </Pre>
        <UL>
          <LI>You need write access to the repository.</LI>
          <LI>Three questions per pull request per hour, one at a time.</LI>
          <LI>
            It cannot change a verdict. Use{" "}
            <Link href="/docs/blocking" className={LINK}>
              <C>/cujo dismiss</C>
            </Link>{" "}
            for that.
          </LI>
        </UL>
      </Section>

      <Section id="visibility" title="Who can see a run">
        <P>
          Every run has a page, linked from the review. A run on a public repository is visible to
          anyone with the link. Search engines do not index it. A run on a private repository is
          visible only to an owner of the installation who signs in with GitHub. Other people get a
          404.
        </P>
        <P>
          The{" "}
          <Link href="/galaxy" className={LINK}>
            board
          </Link>{" "}
          shows recent public runs. Red means a finding is critical. It does not name who lifted a
          block; the pull request does.
        </P>
      </Section>
    </>
  );
}
