import { C, Cell, LI, Note, P, Pre, Row, Section, Table, UL } from "@/components/docs/Prose";

const EXAMPLE = `mode: sandbox
install: uv sync
test: uv run pytest
boot: uv run uvicorn app:app --port 8000
smoke:
  - GET /health
  - GET /orders/1
allow_hosts:
  - api.stripe.com
discord_guild: "222222222222222222"`;

/**
 * `.cujo.yml` and Discord, on one page. Discord is one key here and three
 * commands, so it does not need a page of its own.
 */
export function Configure() {
  return (
    <>
      <Section id="file" title="The .cujo.yml file">
        <P>
          The file and every key in it are optional. Cujo finds missing commands in files such as{" "}
          <C>package.json</C>, <C>pyproject.toml</C> or a <C>Makefile</C>. Write only what it gets
          wrong.
        </P>
        <Pre>{EXAMPLE}</Pre>
        <Note>
          Cujo reads this file from the base branch, not from the pull request. A pull request that
          changes it gets a warning, and the change applies after you merge it.
        </Note>
      </Section>

      <Section id="keys" title="The keys">
        <Table head={["Key", "Meaning"]}>
          <Row>
            <Cell head>mode</Cell>
            <Cell>
              <C>sandbox</C> runs the code. <C>diff</C> only reads the diff against your
              repository&rsquo;s contributor guides, costs less, and never blocks. A change to a
              dependency file, or a pull request from a bot, always gets <C>sandbox</C>.
            </Cell>
          </Row>
          <Row>
            <Cell head>install</Cell>
            <Cell>The install command.</Cell>
          </Row>
          <Row>
            <Cell head>test</Cell>
            <Cell>The test command. If Cujo cannot find one, the run stops with one warning.</Cell>
          </Row>
          <Row>
            <Cell head>boot</Cell>
            <Cell>The command that starts the app.</Cell>
          </Row>
          <Row>
            <Cell head>smoke</Cell>
            <Cell>
              Endpoints to call after boot, each as <C>METHOD /path</C>.
            </Cell>
          </Row>
          <Row>
            <Cell head>allow_hosts</Cell>
            <Cell>
              Hosts your code is allowed to contact. Any other host, apart from package registries,
              is unknown. Cujo cannot infer this list.
            </Cell>
          </Row>
          <Row>
            <Cell head>discord_guild</Cell>
            <Cell>
              The Discord server that can receive this repository&rsquo;s reviews, as a quoted id.
              Read from the default branch.
            </Cell>
          </Row>
        </Table>
        <P>
          If the file is present but cannot be read, the run stops and says so. A bad value for{" "}
          <C>mode</C> or <C>discord_guild</C> is ignored.
        </P>
      </Section>

      <Section id="discord" title="Discord notifications">
        <P>
          Optional. Two people agree to it: someone who can merge to the repository names the
          server, and someone with Manage Server in that server picks the channel.
        </P>
        <UL>
          <LI>
            Merge <C>discord_guild</C> into <C>.cujo.yml</C> on the default branch.
          </LI>
          <LI>
            In Discord, run <C>/cujo watch repo channel [role]</C>. Cujo needs View Channel, Send
            Messages and Embed Links in that channel.
          </LI>
        </UL>
        <Table head={["Command", "Does"]}>
          <Row>
            <Cell head>/cujo watch repo channel [role]</Cell>
            <Cell>Sends the repository&rsquo;s reviews to the channel.</Cell>
          </Row>
          <Row>
            <Cell head>/cujo unwatch repo</Cell>
            <Cell>Stops them. Anyone can run it.</Cell>
          </Row>
          <Row>
            <Cell head>/cujo status</Cell>
            <Cell>Shows where each repository sends its reviews.</Cell>
          </Row>
          <Row>
            <Cell head>/cujo test repo</Cell>
            <Cell>Posts a sample card.</Cell>
          </Row>
        </Table>
        <P>
          Each run is one card, updated as the run moves. A block also sends one message that
          mentions the role. Remove <C>discord_guild</C> to stop all cards. You cannot lift a block
          from Discord.
        </P>
      </Section>
    </>
  );
}
