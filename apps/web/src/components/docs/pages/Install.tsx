import { C, Cell, LI, P, Row, Section, Step, Steps, Table, UL } from "@/components/docs/Prose";
import { INSTALL_URL } from "@/lib/install-url";
import Link from "next/link";

const LINK = "text-accent underline underline-offset-4";

/**
 * The page for a reader who has decided to try it. Branch protection comes
 * first: without it a block posts and holds nothing, which looks like a bug.
 */
export function Install() {
  return (
    <>
      <Section id="steps" title="Install it">
        <Steps>
          <Step n={1} title="Install the App on the repository.">
            <P>
              <a href={INSTALL_URL} target="_blank" rel="noreferrer" className={LINK}>
                github.com/apps/cujo-guard
              </a>
              . Public and private repositories both work. To run your own instance, create your own
              App instead; see{" "}
              <Link href="/docs/self-host" className={LINK}>
                self-hosting
              </Link>
              .
            </P>
          </Step>
          <Step n={2} title="Require the cujo/guard check.">
            <P>
              In branch protection for the target branch, turn on{" "}
              <em>Require status checks to pass</em> and pick <C>cujo/guard</C>. The check appears
              in the list after the App writes its first one. Without this, a block is a review and
              a red mark, and the merge stays open.
            </P>
          </Step>
          <Step n={3} title="Open a pull request, or push to an open one.">
            <P>
              An eyes reaction appears within about a second. If it does not, the webhook did not
              arrive.
            </P>
          </Step>
          <Step n={4} title="Read the review.">
            <P>
              One review from <C>cujo-guard[bot]</C>, and the reaction changes to show the result.{" "}
              <Link href="/docs/reviews" className={LINK}>
                Reading a review
              </Link>{" "}
              explains it.
            </P>
          </Step>
        </Steps>
        <P>
          You do not need to configure anything first. Cujo finds the install, test and boot
          commands in the repository&rsquo;s build files. Add a{" "}
          <Link href="/docs/configure" className={LINK}>
            <C>.cujo.yml</C>
          </Link>{" "}
          only to correct them.
        </P>
      </Section>

      <Section id="skipping" title="Pull requests Cujo skips">
        <Table head={["Condition", "What happens"]}>
          <Row>
            <Cell head>Draft</Cell>
            <Cell>Nothing runs. Mark it ready for review to start a run.</Cell>
          </Row>
          <Row>
            <Cell head>
              The <C>cujo:skip</C> label
            </Cell>
            <Cell>Nothing runs.</Cell>
          </Row>
          <Row>
            <Cell head>Documentation only</Cell>
            <Cell>
              Every changed file is prose, such as <C>.md</C> or <C>LICENSE</C>. The run happens,
              but the review cannot block. A change to a dependency file is never documentation.
            </Cell>
          </Row>
        </Table>
      </Section>

      <Section id="app" title="What the App asks for">
        <Table head={["Permission", "Why"]}>
          <Row>
            <Cell head>Contents: read</Cell>
            <Cell>Read the code and the repository&rsquo;s settings.</Cell>
          </Row>
          <Row>
            <Cell head>Metadata: read</Cell>
            <Cell>GitHub requires it.</Cell>
          </Row>
          <Row>
            <Cell head>Pull requests: write</Cell>
            <Cell>Post the review, comments and reactions, and dismiss a review.</Cell>
          </Row>
          <Row>
            <Cell head>Checks: write</Cell>
            <Cell>
              Write the <C>cujo/guard</C> check. Each installation approves it once.
            </Cell>
          </Row>
          <Row>
            <Cell head>Issues: read</Cell>
            <Cell>
              Receive pull request comments. GitHub sends comment events only with this permission.
              Cujo reads no issues.
            </Cell>
          </Row>
        </Table>
        <UL>
          <LI>
            Events: <C>pull_request</C>, <C>issue_comment</C>, <C>pull_request_review_comment</C>,
            and <C>repository</C>.
          </LI>
        </UL>
      </Section>
    </>
  );
}
