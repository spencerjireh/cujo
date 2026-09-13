import { C, Cell, LI, Lead, Note, P, Pre, Row, Section, Table, UL } from "@/components/docs/Prose";
import Link from "next/link";

const REQUIRED = `GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY     # the PEM text; literal \\n is accepted
GITHUB_WEBHOOK_SECRET
CUJO_MODEL                 # <provider name>/<model name>`;

const DIFF = `CUJO_REVIEW_MODE          # sandbox (default) or diff, when a repo declares none
CUJO_DIFF_MODEL           # <provider name>/<model name>; unset means CUJO_MODEL
CUJO_DIFF_BUDGET_TOKENS   # billed tokens per diff run, default 400000
CUJO_DIFF_TIMEOUT_MS      # default 600000
CUJO_DIFF_BYTES           # bytes of diff the model is handed, default 60000`;

const PROVIDERS = `MODEL_PROVIDER_NAME
MODEL_PROVIDER_BASE_URL             # an OpenAI-compatible chat-completions endpoint
MODEL_PROVIDER_API_KEY
MODEL_PROVIDER_MODELS               # <model name>=<provider model id>, comma separated
MODEL_PROVIDER_CONTEXT_WINDOW       # default 128000
MODEL_PROVIDER_MAX_TOKENS           # default 16384
MODEL_PROVIDER_REASONING            # 0 for a model that takes no reasoning effort`;

/**
 * Vendor-neutral on purpose. This board runs on one particular host behind one
 * particular proxy, and none of that is a requirement of the product — naming
 * it here would read as one. What the product actually needs is a container
 * host with Docker, a TLS-terminating proxy, a model provider and a GitHub
 * App, and that is what this page names.
 */
export function SelfHost() {
  return (
    <>
      <Section id="shape" title="What you are deploying">
        <P>
          One Compose project, so the services share a network. Nothing here is tied to a particular
          cloud: any container host and any reverse proxy that terminates TLS will do.
        </P>
        <Table head={["Service", "Role", "Published?"]}>
          <Row>
            <Cell head>harness</Cell>
            <Cell>
              The agent harness: sessions, turns, the event log, the subagents and the approval
              gate, on the pi coding agent SDK. Its state is one SQLite file on a volume.
            </Cell>
            <Cell>No &mdash; internal only. There is no console.</Cell>
          </Row>
          <Row>
            <Cell head>cujo</Cell>
            <Cell>
              The service. The only thing GitHub touches, and the harness&rsquo;s only client.
            </Cell>
            <Cell>One hostname, for the webhook and the Discord endpoint.</Cell>
          </Row>
          <Row>
            <Cell head>web</Cell>
            <Cell>The board. Holds no secret and no state.</Cell>
            <Cell>One hostname.</Cell>
          </Row>
          <Row>
            <Cell head>github-mcp</Cell>
            <Cell>
              The MCP server the agent calls to post a review. Holds the App&rsquo;s private key.
            </Cell>
            <Cell>No — internal only.</Cell>
          </Row>
          <Row>
            <Cell head>sandbox-mcp</Cell>
            <Cell>
              The MCP server that provisions the sandbox: a container on the host with its egress
              filtered by a gateway outside it. The one service that holds the Docker socket.
            </Cell>
            <Cell>No — internal only.</Cell>
          </Row>
        </Table>
        <Note>
          Cujo itself has no application-level login. The webhook host carries two signature-gated
          routes; the board&rsquo;s read API answers only on the internal Compose name, where
          anything outside <C>/public</C> is 404 rather than 401. <C>/healthz</C> and <C>/readyz</C>{" "}
          are ungated operational endpoints. The harness and both MCP servers answer to nobody
          outside the Compose network, and have no authentication of their own.
        </Note>
      </Section>

      <Section id="app" title="Your own GitHub App">
        <P>
          A self-hosted instance does not install this board&rsquo;s App — it needs its own, so that
          the private key is yours.
        </P>
        <UL>
          <LI>
            Permissions: Contents read, Metadata read, Pull requests write, Issues read. The last is
            for event delivery only; GitHub releases <C>issue_comment</C> on it and on nothing else,
            and the settings page will not offer the event until the permission is set.
          </LI>
          <LI>
            Events: <C>pull_request</C>, <C>issue_comment</C>, <C>pull_request_review_comment</C>,{" "}
            <C>repository</C>.
          </LI>
          <LI>
            Webhook URL: <C>POST /webhook</C> on the webhook hostname, with a secret you also set as{" "}
            <C>GITHUB_WEBHOOK_SECRET</C>.
          </LI>
        </UL>
      </Section>

      <Section id="env" title="Configuration">
        <Lead>Required. The services exit at start without these.</Lead>
        <Pre>{REQUIRED}</Pre>
        <P>
          The model provider, which the service registers on the harness at boot. There is nowhere
          else to configure one. The three limits apply to every model in the list: the window the
          harness compacts against, the output cap, and whether a reasoning effort means anything to
          the model.
        </P>
        <Pre>{PROVIDERS}</Pre>
        <P>
          Any OpenAI-compatible provider works — the model is chosen at deploy time and nothing in
          the code names one. Discord is configured with <C>DISCORD_BOT_TOKEN</C> and{" "}
          <C>DISCORD_PUBLIC_KEY</C>; leave them unset and the service runs and notifies nobody. The
          rest — turn timeout, conversation limits, the public stream cap, the pull request reaction
          switch — have working defaults.
        </P>
        <P>
          The diff review has its own five, all optional. The model must be one of{" "}
          <C>MODEL_PROVIDER_MODELS</C>; a cheap one is the point. The budget is billed tokens, with
          the context counted again on every message, and a run that passes it ends in <C>error</C>{" "}
          with the count on its record.
        </P>
        <Pre>{DIFF}</Pre>
      </Section>

      <Section id="traps" title="Two settings that fail confusingly">
        <UL>
          <LI>
            <C>CUJO_MODEL_REASONING_EFFORT</C> is clamped to what the model can take: a model with{" "}
            <C>MODEL_PROVIDER_REASONING=0</C> gets none, and <C>xhigh</C> or <C>max</C> fold to{" "}
            <C>high</C> unless the model maps them. Nothing refuses to start over it; check the
            harness log for what was actually sent if a review reasons less than you asked.
          </LI>
          <LI>
            A sampling key your provider rejects — <C>CUJO_MODEL_TEMPERATURE</C> on a model that
            only accepts one value, say — produces exactly that failure: readiness stays green and
            every review fails. Both are unset by default, and unset means the key is not sent at
            all rather than sent with a default. Check what your provider accepts before setting
            either.
          </LI>
        </UL>
      </Section>

      <Section id="local" title="Trying it locally">
        <Pre>{"cp .env.example .env\nmake up-local"}</Pre>
        <P>
          That publishes the board on <C>3000</C>, the harness on <C>8790</C>, the service on{" "}
          <C>8080</C> and the MCP servers on <C>8081</C> and <C>8082</C>, all on loopback. The
          service dispatches on <C>Host</C>, which is what every production request carries too:
        </P>
        <Pre>{"curl -s -H 'Host: cujo' http://localhost:8080/public/runs"}</Pre>
        <P>
          Point the App&rsquo;s webhook at your machine with any HTTP tunnel, with the <C>Host</C>{" "}
          set to the webhook hostname, then open a pull request on a repository the App is installed
          on. The deployment uses the base Compose file alone; the local overlay is only for this.
        </P>
        <P>
          The full component and deployment reference lives in the repository, in{" "}
          <C>docs/architecture.md</C>, and every contract the code follows is in <C>docs/spec.md</C>
          . Start with{" "}
          <Link href="/docs/sandbox" className="text-accent underline underline-offset-4">
            the sandbox boundary
          </Link>{" "}
          if you are going to change anything that moves data around.
        </P>
      </Section>
    </>
  );
}
