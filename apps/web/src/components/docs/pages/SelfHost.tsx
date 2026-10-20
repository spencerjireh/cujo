import { C, Cell, LI, Note, P, Pre, Row, Section, Table, UL } from "@/components/docs/Prose";

const REQUIRED = `GITHUB_APP_ID
GITHUB_APP_PRIVATE_KEY       # the PEM text; literal \\n is accepted
GITHUB_WEBHOOK_SECRET
GITHUB_OAUTH_CLIENT_ID       # the App's own OAuth client
GITHUB_OAUTH_CLIENT_SECRET
CUJO_PUBLIC_BASE_URL         # the board's origin; the sign-in callback is under it`;

const SEEDS = `CUJO_MODEL                   # <provider name>/<model name>
ANTHROPIC_API_KEY            # seeds an Anthropic provider
MODEL_PROVIDER_BASE_URL      # seeds one OpenAI-compatible provider,
MODEL_PROVIDER_API_KEY       #   with MODEL_PROVIDER_NAME and
MODEL_PROVIDER_MODELS        #   <model name>=<provider model id>, comma separated`;

/**
 * Vendor-neutral on purpose. The product needs a container host with Docker,
 * a reverse proxy that terminates TLS, a model provider and a GitHub App, and
 * that is what this page names.
 */
export function SelfHost() {
  return (
    <>
      <Section id="shape" title="What you deploy">
        <P>
          One Docker Compose project on any host with Docker and a reverse proxy that terminates
          TLS.
        </P>
        <Table head={["Service", "Role", "Public"]}>
          <Row>
            <Cell head>cujo</Cell>
            <Cell>Receives GitHub and Discord events and runs the reviews.</Cell>
            <Cell>Yes, one hostname.</Cell>
          </Row>
          <Row>
            <Cell head>web</Cell>
            <Cell>This site. Holds no secrets.</Cell>
            <Cell>Yes, one hostname.</Cell>
          </Row>
          <Row>
            <Cell head>harness</Cell>
            <Cell>Runs the model. Keeps its state in one SQLite file.</Cell>
            <Cell>No.</Cell>
          </Row>
          <Row>
            <Cell head>github-mcp</Cell>
            <Cell>Posts reviews. Holds the App&rsquo;s private key.</Cell>
            <Cell>No.</Cell>
          </Row>
          <Row>
            <Cell head>sandbox-mcp</Cell>
            <Cell>Starts the sandboxes. Holds the Docker socket.</Cell>
            <Cell>No.</Cell>
          </Row>
        </Table>
      </Section>

      <Section id="app" title="Your own GitHub App">
        <P>Create your own App, so that the private key is yours.</P>
        <UL>
          <LI>
            Permissions: Contents read, Metadata read, Pull requests write, Checks write, Issues
            read. GitHub offers the <C>issue_comment</C> event only after you set Issues read.
          </LI>
          <LI>
            Events: <C>pull_request</C>, <C>issue_comment</C>, <C>pull_request_review_comment</C>,{" "}
            <C>repository</C>.
          </LI>
          <LI>
            Webhook URL: <C>POST /webhook</C> on the <C>cujo</C> hostname, with the secret you set
            as <C>GITHUB_WEBHOOK_SECRET</C>.
          </LI>
        </UL>
      </Section>

      <Section id="env" title="Configuration">
        <P>Required. The services do not start without these.</P>
        <Pre>{REQUIRED}</Pre>
        <P>
          Choose the model on the Settings page, after you sign in. Until you do, every pull request
          gets a neutral <C>cujo/guard</C> check that says no model is set. Add a provider (an
          Anthropic key, or any OpenAI-compatible URL, key and model list), press Test, save, and
          pick a model. The diff review can use a different, cheaper model.
        </P>
        <P>
          For Discord, set <C>DISCORD_BOT_TOKEN</C> and <C>DISCORD_PUBLIC_KEY</C>. Without them,
          Cujo runs and sends no cards.
        </P>
        <P>For a local or test stack, these set the first model at first start only:</P>
        <Pre>{SEEDS}</Pre>
        <Note>
          If your provider rejects a sampling value, such as a temperature, every review fails while
          the service still reports ready. Leave these unset unless you know what your provider
          accepts.
        </Note>
      </Section>

      <Section id="local" title="Try it locally">
        <Pre>{"cp .env.example .env\nmake up-local"}</Pre>
        <P>
          The site is on <C>localhost:3000</C>. Send the App&rsquo;s webhook to your machine through
          an HTTP tunnel, then open a pull request on a repository where the App is installed. The
          repository&rsquo;s <C>docs/architecture.md</C> describes the full design.
        </P>
      </Section>
    </>
  );
}
