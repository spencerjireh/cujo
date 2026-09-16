import {
  C,
  Cell,
  LI,
  Lead,
  Note,
  P,
  Row,
  Section,
  Step,
  Steps,
  Table,
  UL,
} from "@/components/docs/Prose";
import { INSTALL_URL } from "@/lib/install-url";
import Link from "next/link";

/**
 * The page a reader lands on when they have decided to try it.
 *
 * Requirements come before the steps. Both of them — public, and branch
 * protection — are things that make Cujo look broken rather than unsupported if
 * you find them out afterwards: a private repository silently has no page, and
 * a block on an unprotected branch posts and holds nothing.
 */
export function Install() {
  return (
    <>
      <Section id="requirements" title="Two things the repository needs">
        <UL>
          <LI>
            <strong className="font-medium text-fg">It must be public.</strong> Nothing in this
            system holds a clone credential, which is the same property that keeps secrets out of
            the sandbox. A private repository has nothing to be cloned with, and no page on this
            board.
          </LI>
          <LI>
            <strong className="font-medium text-fg">
              Branch protection, if you want a block to actually hold.
            </strong>{" "}
            Require the <C>cujo/guard</C> status check on the target branch. Without it a block is a
            REQUEST_CHANGES review and a failed check on the commit, both visible and neither
            holding the merge; a review alone can be dismissed by anyone with write access, which is
            why the check exists.
          </LI>
        </UL>
      </Section>

      <Section id="steps" title="Installing it">
        <Steps>
          <Step n={1} title="Install the App on the repository.">
            <P>
              <a
                href={INSTALL_URL}
                target="_blank"
                rel="noreferrer"
                className="text-accent underline underline-offset-4"
              >
                github.com/apps/cujo-guard
              </a>
              . Running your own instance means creating your own App instead —{" "}
              <Link href="/docs/self-host" className="text-accent underline underline-offset-4">
                self-hosting
              </Link>{" "}
              has the settings.
            </P>
          </Step>
          <Step n={2} title="Open a pull request, or push to one that is open.">
            <P>
              Within about a second the pull request wears an eye. That reaction arrives before the
              agent has done anything, so its presence proves the delivery, the signature and the
              claim; its absence says the failure is at the front of the pipeline.
            </P>
          </Step>
          <Step n={3} title="Read the review.">
            <P>
              One review from <C>cujo-guard[bot]</C>, and the reaction settles on the verdict. What
              the run measured is on this board too, if the repository is public.
            </P>
          </Step>
        </Steps>
        <P>
          Nothing needs to be configured first. Cujo infers the install, test and boot commands from
          the repository&rsquo;s own build files; a{" "}
          <Link href="/docs/configure" className="text-accent underline underline-offset-4">
            <C>.cujo.yml</C>
          </Link>{" "}
          overrides what it got wrong.
        </P>
      </Section>

      <Section id="skipping" title="Pull requests Cujo skips">
        <P>
          Three filters, applied before a sandbox is provisioned or a token is spent. The first two
          are explicit human choices and are full stops; the third is an inference, so it softens
          the posture rather than producing silence.
        </P>
        <Table head={["Condition", "What happens"]}>
          <Row>
            <Cell head>Draft pull request</Cell>
            <Cell>Nothing runs. Marking it ready for review starts a run.</Cell>
          </Row>
          <Row>
            <Cell head>
              The <C>cujo:skip</C> label
            </Cell>
            <Cell>Nothing runs. An explicit opt-out by someone with write access.</Cell>
          </Row>
          <Row>
            <Cell head>Documentation only</Cell>
            <Cell>
              Every changed file is prose — <C>.md</C>, <C>.txt</C>, <C>.rst</C>, <C>.adoc</C>,{" "}
              <C>LICENSE</C>, <C>CHANGELOG</C> and the like. The sandbox still runs in full and
              every hard rule still fires; the review can only be advisory, so it cannot block a
              merge.
            </Cell>
          </Row>
        </Table>
        <Note>
          A file that is a dependency manifest is never documentation, and an empty changed-file
          list is not documentation-only — a metadata-only pull request should still be judged.
        </Note>
      </Section>

      <Section id="app" title="What the App asks for">
        <Lead>Five permissions and four event subscriptions, and one of them looks wrong.</Lead>
        <Table head={["Permission", "Why"]}>
          <Row>
            <Cell head>Contents: read</Cell>
            <Cell>Clone the pull request, and read the default branch&rsquo;s policy.</Cell>
          </Row>
          <Row>
            <Cell head>Metadata: read</Cell>
            <Cell>Required by the others.</Cell>
          </Row>
          <Row>
            <Cell head>Pull requests: write</Cell>
            <Cell>
              Post the review, the inline comments, the reaction and the replies, and dismiss the
              review when a maintainer lifts a block.
            </Cell>
          </Row>
          <Row>
            <Cell head>Checks: write</Cell>
            <Cell>
              Write the <C>cujo/guard</C> check run on each commit it reviews. This is the merge
              lock; an installation that has not approved it gets reviews and reactions and no
              check.
            </Cell>
          </Row>
          <Row>
            <Cell head>Issues: read</Cell>
            <Cell>
              Delivery only. No code here reads an issue — GitHub releases the <C>issue_comment</C>{" "}
              event on this permission and on nothing else, even for a comment on a pull request,
              and that event is how <C>/cujo dismiss</C> arrives.
            </Cell>
          </Row>
        </Table>
        <P>
          Events: <C>pull_request</C> (opened, synchronize, ready for review), <C>issue_comment</C>,{" "}
          <C>pull_request_review_comment</C>, and <C>repository</C> — the last so that a repository
          going private is noticed within seconds rather than at the next sweep.
        </P>
      </Section>
    </>
  );
}
