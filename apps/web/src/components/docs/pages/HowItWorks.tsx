import { FlowDiagram } from "@/components/docs/FlowDiagram";
import { C, Lead, Note, P, Section, Step, Steps } from "@/components/docs/Prose";
import Link from "next/link";

/** The spine. Every other concept page is one of these steps in detail. */
export function HowItWorks() {
  return (
    <>
      <Section id="path" title="The path">
        <FlowDiagram />
        <P>
          GitHub delivers a webhook to the Cujo service, which starts one turn on the agent harness.
          The harness runs the pull request inside a disposable sandbox. Only the pull
          request&rsquo;s code and its dependency names cross into that sandbox; only JSON reports
          come back. The review is posted through a separate MCP server, which is where the
          credentials live — on the trusted side, and never in the box that ran the code.
        </P>
      </Section>

      <Section id="steps" title="Step by step">
        <Steps>
          <Step n={1} title="A pull request arrives.">
            <P>
              The App fires a <C>pull_request</C> webhook. The service verifies the signature before
              it reads anything else, applies the{" "}
              <Link href="/docs/install" className="text-accent underline underline-offset-4">
                entry filters
              </Link>
              , and reacts on the pull request.
            </P>
          </Step>
          <Step n={2} title="The service picks the review, and one turn starts.">
            <P>
              There are two reviews. The <strong className="font-medium text-fg">sandbox</strong>{" "}
              review, steps 3 to 5 below, runs the pull request. The{" "}
              <strong className="font-medium text-fg">diff</strong> review reads it: the service
              compresses the diff, reads the repository&rsquo;s own standards files —{" "}
              <C>AGENTS.md</C>, <C>CLAUDE.md</C>, <C>CONTRIBUTING.md</C>,{" "}
              <C>.github/copilot-instructions.md</C> — at the base commit, and hands both to a cheap
              model on a session with no sandbox and a token budget. It posts one advisory review
              with findings of at most <C>warn</C>, because a block needs evidence only execution
              can give. Which review a pull request gets is <C>mode</C> in{" "}
              <Link href="/docs/configure" className="text-accent underline underline-offset-4">
                <C>.cujo.yml</C>
              </Link>
              , read from base; a dependency-manifest change or a Bot author is always the sandbox.
            </P>
            <P>
              Either way the turn&rsquo;s context is the repository, the number, base and head SHA,
              and the changed-file list. The service stays subscribed to the turn&rsquo;s event
              stream and folds what it sees into a run you can watch while it is still going.
            </P>
          </Step>
          <Step n={3} title="Into the sandbox.">
            <P>
              The agent provisions a box and runs two commands. The first clones head, adds a
              worktree at base, and hands back the base branch&rsquo;s policy together with
              head&rsquo;s build files, so the commands are settled in one step. The second seeds a
              decoy secret and starts the logging proxy and the decoy watcher.
            </P>
          </Step>
          <Step n={4} title="Run the checks.">
            <P>
              Each is a subagent with fresh context and no access to the others&rsquo; reports.
              Detonation starts first, during setup, because it installs into its own environment
              and needs nothing the repository&rsquo;s install produces; tests, probes and smoke go
              together once that install is done. Each returns one JSON report.{" "}
              <Link href="/docs/checks" className="text-accent underline underline-offset-4">
                What each measures
              </Link>
              .
            </P>
          </Step>
          <Step n={5} title="Decide.">
            <P>
              The reports become findings. Hard rules force <C>critical</C> on the dangerous cases
              and the agent cannot argue with them; the agent judges everything else against its
              rubric.{" "}
              <Link href="/docs/findings" className="text-accent underline underline-offset-4">
                Findings and severity
              </Link>
              .
            </P>
          </Step>
          <Step n={6} title="Post.">
            <P>
              With no <C>critical</C>, the review posts as a comment. A <C>critical</C> that says
              the pull request is broken posts as REQUEST_CHANGES, unattended. Only a{" "}
              <C>critical</C> that accuses the change of malice waits for a person.{" "}
              <Link href="/docs/the-gate" className="text-accent underline underline-offset-4">
                The human gate
              </Link>
              .
            </P>
          </Step>
        </Steps>
      </Section>

      <Section id="pushes" title="What a new push does">
        <Lead>Only the newest head is reviewed.</Lead>
        <P>
          A pull request has one session for its whole life, and each push runs a fresh turn in it.
          When a new head arrives while a run is still going, that run ends <C>superseded</C> and
          the new head gets its own. If the superseded run was waiting on a person, that wait is
          answered too — the question was about a commit that no longer exists.
        </P>
        <Note>
          The service will not review a head <C>cujo-guard[bot]</C> has already reviewed, so a
          redelivered webhook costs nothing. To review the current head again deliberately, comment{" "}
          <C>/cujo review</C>.
        </Note>
      </Section>
    </>
  );
}
