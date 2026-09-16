import { C, LI, Lead, Note, P, Section, UL } from "@/components/docs/Prose";
import Link from "next/link";

export function Board() {
  return (
    <>
      <Section id="what" title="What this site is">
        <Lead>
          A read-only view of Cujo&rsquo;s reviews of public pull requests. It writes nothing and
          decides nothing.
        </Lead>
        <P>
          There is no account, no login and no credential anywhere on it — not because one was
          removed from the page, but because the authenticated plane it belonged to was deleted. A
          block is lifted on the pull request, and nothing here can lift one.
        </P>
      </Section>

      <Section id="reading" title="Reading a run">
        <P>
          The board, at <C>/galaxy</C>, draws its newest runs as a field of star systems, and{" "}
          <Link href="/galaxy" className="text-accent underline underline-offset-4">
            the key under the record
          </Link>{" "}
          names each part where you can see the thing it names. In short: the core is the verdict
          and grows with the worst finding, one ring is one check and is as wide as that check took,
          and one satellite is one finding.
        </P>
        <UL>
          <LI>Depth is time, newest in front. Where a star sits within its layer means nothing.</LI>
          <LI>
            Red means the pull request is dangerous, never that Cujo fell over — a run that errored
            is blue.
          </LI>
          <LI>
            Amber lands on exactly one state, the one waiting on a person. A calm review has almost
            no colour on it.
          </LI>
        </UL>
        <P>
          A browser that will not give a WebGL context, or a phone, gets the readings and the record
          instead. Nothing is only in the drawing.
        </P>
      </Section>

      <Section id="visibility" title="What it will not show">
        <UL>
          <LI>
            <strong className="font-medium text-fg">
              Runs on private repositories, to anyone but their owner.
            </strong>{" "}
            A run whose repository is not public answers 404 to a visitor, the same answer a run
            that does not exist gets; an owner of the installation, signed in with GitHub, sees it
            on the same page. Every repository with a run is re-asked periodically whether it is
            still public, and a repository going private is carried by a webhook within seconds.
          </LI>
          <LI>
            <strong className="font-medium text-fg">Who decided anything.</strong> No approver is
            named, ever. The public serializer is an allowlist rather than a redaction pass, so a
            field is published because somebody classified it, not because nobody remembered to
            remove it.
          </LI>
          <LI>
            <strong className="font-medium text-fg">Who lifted a block.</strong> The dismissal names
            its login on the pull request and on the commit&rsquo;s check, where the people it
            concerns can read it; this board says only that{" "}
            <Link href="/docs/blocking" className="text-accent underline underline-offset-4">
              it was lifted
            </Link>
            .
          </LI>
        </UL>
      </Section>

      <Section id="indexing" title="Shareable, not searchable">
        <Note>
          A run page is public to anyone with the link and asks search engines not to index it. Cujo
          reviews public pull requests belonging to people who did not ask to be listed here, and a
          finding quotes their code and the sandbox&rsquo;s observations of it. A link somebody
          chooses to share is a different thing from a result that surfaces beside the repository
          itself. The front page and this manual are indexable; no run is.
        </Note>
      </Section>
    </>
  );
}
