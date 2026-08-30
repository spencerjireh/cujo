import { SeverityBadge } from "@/components/SeverityBadge";
import { C, Cell, LI, Lead, Note, P, Row, Section, Table, UL } from "@/components/docs/Prose";
import { SEVERITIES } from "@/lib/api/types";
import Link from "next/link";

/**
 * The severity list is generated from `SEVERITIES`, and the badges are the same
 * component the run pages use, for the reason `Legend.tsx` gives: a word that is
 * matched literally in `apps/cujo` must not be retyped in prose here, where it
 * could drift without failing anything.
 *
 * The rule tables are prose, because the rules have no representation in this
 * app to read.
 */

const WHAT_EACH_MEANS: Record<(typeof SEVERITIES)[number], string> = {
  critical:
    "A probe shows the change does not do what the diff claims; an endpoint that worked on base now errors; a hard rule tripped.",
  warn: "Worth a glance: changed code no test covers, a write outside the workspace, an unfamiliar but plausible host, a check that returned nothing.",
  info: "What ran and what it showed, when nothing is wrong. Most of a calm review is this.",
};

export function Findings() {
  return (
    <>
      <Section id="severity" title="Three severities">
        <P>
          Lowercase, and exactly these three. They are matched literally in code on both sides, so
          they are not editorial.
        </P>
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
      </Section>

      <Section id="layers" title="Two layers decide it">
        <Lead>
          Code senses, the agent judges, and a hard rule overrides the agent on the cases that must
          never be reasoned away.
        </Lead>
        <P>
          Layer one is deterministic and written in code. It runs twice — the agent is told to apply
          it, and the service derives it again independently from the same reports — so a model that
          forgets a rule does not cost you the finding. Layer two is the agent&rsquo;s judgment over
          everything the rules do not cover, which is where most of the useful work happens.
        </P>
      </Section>

      <Section id="hard-rules" title="The hard rules">
        <P>
          Five force a <C>critical</C> the agent cannot lower or drop. They divide by the claim they
          make, and that split is what decides whether a review waits for a person.
        </P>
        <Table head={["Rule", "Claim", "Fires when"]}>
          <Row>
            <Cell head>tests failed</Cell>
            <Cell>correctness</Cell>
            <Cell>A test passes on base and fails on head.</Cell>
          </Row>
          <Row>
            <Cell head>decoy read</Cell>
            <Cell>malice</Cell>
            <Cell>Something opened the seeded credentials file, on any check.</Cell>
          </Row>
          <Row>
            <Cell head>decoy in egress</Cell>
            <Cell>malice</Cell>
            <Cell>The seeded secret left the sandbox, on any check.</Cell>
          </Row>
          <Row>
            <Cell head>wrote sensitive</Cell>
            <Cell>malice</Cell>
            <Cell>
              A write landed in an SSH directory, a shell rc, cron, or a credentials path — on any
              check.
            </Cell>
          </Row>
          <Row>
            <Cell head>unknown egress</Cell>
            <Cell>malice</Cell>
            <Cell>
              An install contacted a host that is neither a package index nor allowlisted. This one
              is scoped to <C>detonation</C>.
            </Cell>
          </Row>
        </Table>
        <P>
          &ldquo;Your tests fail&rdquo; is mechanical, checkable by the author in thirty seconds,
          and nobody sensible answers no to it. &ldquo;This code tried to steal a credential&rdquo;
          harms someone if it is wrong. That is the whole reason for{" "}
          <Link href="/docs/the-gate" className="text-accent underline underline-offset-4">
            the gate
          </Link>{" "}
          — and it is why the split is not the obvious one. Three of the four malice rules fire on
          any check, including the repository&rsquo;s own tests.
        </P>
      </Section>

      <Section id="operational" title="Three rules about the evidence itself">
        <P>
          These produce a <C>warn</C> and never a <C>critical</C>. Each says the measurement was
          thin, never that the code did anything.
        </P>
        <UL>
          <LI>A required check returned no report.</LI>
          <LI>The proxy or the decoy watcher was not armed while a check ran.</LI>
          <LI>A report did not match the shape a report is supposed to have.</LI>
        </UL>
        <Note>
          The rules are tripwires, not proofs of absence. Every one fires only on positive evidence
          a sensor recorded, so a gap can lose you a <C>critical</C> and can never manufacture one.
          A <C>false</C> means &ldquo;not observed&rdquo;, and the agent is told to read it that way
          too.
        </Note>
      </Section>

      <Section id="shape" title="What a finding carries">
        <UL>
          <LI>
            <C>title</C> — a clause of plain language, never a field name from a report.
          </LI>
          <LI>
            <C>evidence</C> — the observation itself: the failing assertion, the host and port, the
            path written, the timing. Numbers, not adjectives.
          </LI>
          <LI>
            <C>detail</C> — one paragraph of judgment. Expected on every <C>critical</C>.
          </LI>
          <LI>
            <C>next</C> — one imperative clause naming the action. Required on <C>critical</C>,
            allowed on <C>warn</C>, and never on <C>info</C> — and it may only follow from something
            a sensor observed, never from style, architecture or preference.
          </LI>
          <LI>
            A path, a line and a side, when the finding is about a line of the diff. Those become
            the inline comment.
          </LI>
        </UL>
      </Section>
    </>
  );
}
