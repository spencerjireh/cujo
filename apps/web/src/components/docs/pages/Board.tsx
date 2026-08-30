import { LI, Lead, Note, P, Section, UL } from "@/components/docs/Prose";
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
          held finding is answered on the pull request, and nothing here can answer one.
        </P>
      </Section>

      <Section id="reading" title="Reading a run">
        <P>
          The board draws its newest runs as a field of star systems, and{" "}
          <Link href="/" className="text-accent underline underline-offset-4">
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
            <strong className="font-medium text-fg">Runs on private repositories.</strong> Not
            hidden behind a permission — absent. A run whose repository is not public answers 404
            here, the same answer a run that does not exist gets. Every repository with a run is
            re-asked periodically whether it is still public, and a repository going private is
            carried by a webhook within seconds.
          </LI>
          <LI>
            <strong className="font-medium text-fg">Who decided anything.</strong> No approver is
            named, ever. The public serializer is an allowlist rather than a redaction pass, so a
            field is published because somebody classified it, not because nobody remembered to
            remove it.
          </LI>
          <LI>
            <strong className="font-medium text-fg">A held accusation, before it posts.</strong>{" "}
            Publishing it here early is precisely what{" "}
            <Link href="/docs/the-gate" className="text-accent underline underline-offset-4">
              the gate
            </Link>{" "}
            prevents.
          </LI>
        </UL>
      </Section>

      <Section id="indexing" title="Shareable, not searchable">
        <Note>
          A run page is public to anyone with the link and asks search engines not to index it. Cujo
          reviews public pull requests belonging to people who did not ask to be listed here, and a
          finding quotes their code and the sandbox&rsquo;s observations of it. A link somebody
          chooses to share is a different thing from a result that surfaces beside the repository
          itself. These documentation pages are indexable; nothing else on this site is.
        </Note>
      </Section>
    </>
  );
}
