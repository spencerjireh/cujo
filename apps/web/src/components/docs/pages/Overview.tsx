import { C, LI, Lead, P, Section, UL } from "@/components/docs/Prose";
import Link from "next/link";

const LINK = "text-accent underline underline-offset-4";

/**
 * The first page. What Cujo does, what lands on a pull request, and what it
 * does not do. The limits are here, not at the back, because they decide
 * whether Cujo is worth installing.
 */
export function Overview() {
  return (
    <>
      <Section id="what" title="It runs the pull request">
        <Lead>
          A reviewer that only reads the diff cannot see a test that now fails or an install that
          contacts an unknown host. Cujo runs the code to find out.
        </Lead>
        <P>
          For each pull request, Cujo copies the code into a disposable sandbox. The sandbox holds
          no token or secret. Cujo runs the test suite on the base and the head, tries the changed
          code, boots the app, and installs each new dependency alone. The review cites what
          happened.
        </P>
      </Section>

      <Section id="what-lands" title="What you get on a pull request">
        <UL>
          <LI>A reaction within about a second, which changes as the run moves.</LI>
          <LI>
            One review from <C>cujo-guard[bot]</C>: what ran, the findings, and inline comments on
            the lines they are about.
          </LI>
          <LI>
            A <C>cujo/guard</C> check on the commit. It fails when a finding is critical, which
            holds the merge under branch protection.
          </LI>
        </UL>
        <P>
          Cujo never approves a pull request. Reviews post without a person. The only step that
          needs a person is to{" "}
          <Link href="/docs/blocking" className={LINK}>
            lift a block
          </Link>
          .
        </P>
      </Section>

      <Section id="limits" title="What it does not do">
        <UL>
          <LI>
            It does not read network traffic content. It records which hosts the code contacted and
            how many bytes, not what was sent.
          </LI>
          <LI>
            It can miss a process that connects to the network directly. A finding needs evidence,
            so a gap can hide a problem but cannot invent one.
          </LI>
          <LI>It does not comment on style or design, and it does not fix code.</LI>
        </UL>
        <P>
          Private repositories work. Their runs are visible only to an owner of the installation who
          signs in with GitHub.
        </P>
      </Section>

      <Section id="next" title="Next">
        <P>
          <Link href="/docs/install" className={LINK}>
            Install it
          </Link>{" "}
          on a repository, or{" "}
          <Link href="/docs/self-host" className={LINK}>
            run your own
          </Link>
          .
        </P>
      </Section>
    </>
  );
}
