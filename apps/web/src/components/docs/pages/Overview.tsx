import { C, LI, Lead, Note, P, Section, UL } from "@/components/docs/Prose";
import Link from "next/link";

/**
 * The first page, and the only one allowed to argue rather than describe.
 *
 * It answers two questions and stops: what this does that a diff-reading
 * reviewer cannot, and what it will not do. The limits are on this page and not
 * buried at the back, because a reader who finds out on their own that private
 * repositories are unsupported has been misled by the three pages in between.
 */
export function Overview() {
  return (
    <>
      <Section id="claim" title="A diff shows what changed, not what happens">
        <Lead>
          A reviewer that only reads the diff cannot see the test that now fails, the endpoint that
          now returns 500, or the install-time payload in a new dependency. It can guess. It cannot
          know.
        </Lead>
        <P>
          Cujo reviews a pull request by running it. It clones the head into a disposable sandbox,
          runs the repository&rsquo;s suite on base and on head, writes and runs its own probes
          against the changed code, boots the app and hits it, and — when the pull request adds a
          dependency — installs that dependency in isolation and records what the install did. The
          review it posts cites what happened.
        </P>
      </Section>

      <Section id="what-lands" title="What lands on a pull request">
        <UL>
          <LI>
            A reaction, within about a second of the delivery. It says Cujo has the pull request
            before it has anything to report, and it moves as the run does.
          </LI>
          <LI>
            One review, from <C>cujo-guard[bot]</C>: a summary of what ran, the findings, and inline
            comments anchored to the lines they are about.
          </LI>
          <LI>
            Nothing else. Cujo never posts APPROVE, so it cannot satisfy branch protection and wave
            a merge through, and it never comments on style, architecture or preference — every
            finding follows from something a sensor observed.
          </LI>
        </UL>
        <P>
          Most reviews post unattended, including the ones that block a merge. Exactly one kind
          waits for a person:{" "}
          <Link href="/docs/the-gate" className="text-accent underline underline-offset-4">
            an accusation
          </Link>
          .
        </P>
      </Section>

      <Section id="limits" title="What it does not do">
        <P>
          Stated here rather than at the back, because each of these changes whether Cujo is worth
          pointing at your repository.
        </P>
        <UL>
          <LI>
            <strong className="font-medium text-fg">Public repositories only.</strong> There is no
            clone credential anywhere in this system, so there is nothing a private repository could
            be cloned with. A private repository gets no page on this board either.
          </LI>
          <LI>
            <strong className="font-medium text-fg">Egress is metadata, never payload.</strong> The
            sandbox&rsquo;s proxy records the host, the port and the byte count. It does not
            intercept TLS, so it never sees what was sent.
          </LI>
          <LI>
            <strong className="font-medium text-fg">
              A process that opens a direct socket is not observed.
            </strong>{" "}
            The proxy sees what honours <C>HTTP_PROXY</C>, which is pip, npm, cargo, go and the
            common HTTP libraries. Something that deliberately bypasses it is a gap, and the reports
            say which sensors were watching so that gap is legible rather than silent.
          </LI>
          <LI>
            <strong className="font-medium text-fg">It does not fix anything.</strong> Opening a
            remediation pull request is designed and not built.
          </LI>
        </UL>
        <Note>
          The hard rules are tripwires, not proofs of absence. Each fires only on positive evidence
          a sensor recorded, so a sensor gap can cost you a finding and can never invent one. A{" "}
          <C>false</C> in a report means &ldquo;not observed&rdquo;, and everything downstream reads
          it that way.
        </Note>
      </Section>

      <Section id="next" title="Where to go next">
        <UL>
          <LI>
            <Link href="/docs/install" className="text-accent underline underline-offset-4">
              Install it
            </Link>{" "}
            — put the App on a repository and open a pull request.
          </LI>
          <LI>
            <Link href="/docs/how-it-works" className="text-accent underline underline-offset-4">
              How a review runs
            </Link>{" "}
            — the whole path, webhook to review.
          </LI>
          <LI>
            <Link href="/docs/self-host" className="text-accent underline underline-offset-4">
              Self-hosting
            </Link>{" "}
            — run your own instance instead.
          </LI>
        </UL>
      </Section>
    </>
  );
}
