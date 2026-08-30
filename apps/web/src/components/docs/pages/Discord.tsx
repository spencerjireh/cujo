import {
  C,
  Cell,
  LI,
  Lead,
  Note,
  P,
  Pre,
  Row,
  Section,
  Step,
  Steps,
  Table,
  UL,
} from "@/components/docs/Prose";
import Link from "next/link";

export function Discord() {
  return (
    <>
      <Section id="two-halves" title="Two halves, proved by different people">
        <Lead>
          Neither half alone does anything, and that is the point: without the repository&rsquo;s
          half anyone could point a repository they do not own at their own channel, and without the
          server&rsquo;s half anyone could push a repository&rsquo;s reviews into a server they do
          not belong to.
        </Lead>
        <Table head={["Half", "Question it answers", "Proved by", "Where"]}>
          <Row>
            <Cell head>Declaration</Cell>
            <Cell>Which Discord server may have this repository&rsquo;s reviews?</Cell>
            <Cell>Whoever can merge to the default branch</Cell>
            <Cell>
              <C>discord_guild</C> in <C>.cujo.yml</C>
            </Cell>
          </Row>
          <Row>
            <Cell head>Binding</Cell>
            <Cell>Which channel, and which role gets pinged?</Cell>
            <Cell>A member with Manage Server</Cell>
            <Cell>
              <C>/cujo watch</C>, in that server
            </Cell>
          </Row>
        </Table>
        <P>
          The declaration is read from the default branch and never from a pull request&rsquo;s
          copy. Reading the merged branch is what makes it proof: code that declares its own
          authorization is not an authorization.
        </P>
      </Section>

      <Section id="setup" title="Setting it up">
        <Steps>
          <Step n={1} title="Name the server in the repository.">
            <Pre>{'# .cujo.yml on the default branch\ndiscord_guild: "222222222222222222"'}</Pre>
            <P>
              Merge it. On an instance that serves a single Discord server, the operator can answer
              this half once in the environment instead, and no repository needs a commit.
            </P>
          </Step>
          <Step n={2} title="Bind a channel, from inside Discord.">
            <P>
              <C>/cujo watch repo channel [role]</C>, run by someone with Manage Server. Cujo needs
              View Channel, Send Messages and Embed Links there.
            </P>
          </Step>
        </Steps>
        <Note>
          Revoking is a commit. Removing or changing <C>discord_guild</C> is re-checked before every
          card, so a binding made before the edit stops delivering rather than running forever. A
          repository that declares nothing, and a repository whose file could not be read, are
          different facts — only the first revokes.
        </Note>
      </Section>

      <Section id="commands" title="The commands">
        <Table head={["Command", "Does"]}>
          <Row>
            <Cell head>/cujo watch repo channel [role]</Cell>
            <Cell>
              Sends that repository&rsquo;s cards to that channel, pinging that role when a review
              blocks.
            </Cell>
          </Row>
          <Row>
            <Cell head>/cujo unwatch repo</Cell>
            <Cell>
              Stops sending them. Deliberately the one command that does not require Manage Server:
              stopping is never gated.
            </Cell>
          </Row>
          <Row>
            <Cell head>/cujo status</Cell>
            <Cell>
              Where each watched repository currently goes, and the line to paste into another one.
            </Cell>
          </Row>
          <Row>
            <Cell head>/cujo test repo</Cell>
            <Cell>
              Posts a sample card. It exercises the token, the channel permissions and the rendering
              at once, which nothing else can do without waiting for a real pull request.
            </Cell>
          </Row>
        </Table>
        <P>Every reply is ephemeral — only the person who ran the command sees it.</P>
      </Section>

      <Section id="what-arrives" title="What arrives in the channel">
        <UL>
          <LI>
            <strong className="font-medium text-fg">One card per run</strong>, edited in place as
            the run moves. A new push is a new run and a new card; the old one is rewritten to say
            it was superseded. The card carries the head, the pull request, the findings, and what
            each check measured — <C>tests done, 1 critical, 41s</C> — with a zero written out
            rather than implied by an absence.
          </LI>
          <LI>
            <strong className="font-medium text-fg">One ping when a run blocks on a person</strong>,
            as a second message. An edit notifies nobody, so the card going amber would be a
            notification nobody receives. When the run resolves, that message is edited in place and
            recoloured.
          </LI>
        </UL>
        <P>
          Only the configured role can be mentioned — never everyone, never a role somebody named in
          a pull request title. With no role configured the ping still posts, without a mention.
        </P>
      </Section>

      <Section id="not-a-control" title="Nobody approves from Discord">
        <P>
          This is notification and nothing else. Being in a channel is not a claim about a
          repository, and Discord membership is not repository write access. A held finding is
          answered on the pull request, with{" "}
          <Link href="/docs/the-gate" className="text-accent underline underline-offset-4">
            <C>/cujo confirm</C>
          </Link>
          .
        </P>
        <P>
          The whole feature is optional. With no bot token configured, the service runs exactly as
          it otherwise would and says nothing.
        </P>
      </Section>
    </>
  );
}
