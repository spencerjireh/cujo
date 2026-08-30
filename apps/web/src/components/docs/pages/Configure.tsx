import { C, Cell, LI, Lead, Note, P, Pre, Row, Section, Table, UL } from "@/components/docs/Prose";
import Link from "next/link";

const EXAMPLE = `install: uv sync
test: uv run pytest
boot: uv run uvicorn app:app --port 8000
smoke:
  - GET /health
  - GET /orders/1
allow_hosts:
  - api.stripe.com
discord_guild: "222222222222222222"`;

/**
 * The reference page, and the one with a trap in it.
 *
 * Two different readers parse this file, from two different branches, and a
 * page that presents it as one config file gets both of them wrong. The split
 * is not an implementation detail: it is the reason a pull request cannot
 * allowlist the host it is about to exfiltrate to, and the reason naming a
 * Discord server is proof of anything.
 */
export function Configure() {
  return (
    <>
      <Section id="file" title="The whole file">
        <P>
          Optional, and every key in it is optional. Missing keys are inferred from the
          repository&rsquo;s own build files — <C>pyproject.toml</C>, <C>package.json</C>, a{" "}
          <C>Makefile</C>, a CI workflow. Write only what Cujo got wrong.
        </P>
        <Pre>{EXAMPLE}</Pre>
      </Section>

      <Section id="two-readers" title="Two readers, and two branches">
        <Lead>
          Five of these keys are read by the agent from the pull request&rsquo;s{" "}
          <strong className="font-medium text-fg">base</strong> tree. The sixth is read by the
          service from the repository&rsquo;s{" "}
          <strong className="font-medium text-fg">default branch</strong>. Neither is read from the
          pull request&rsquo;s own code.
        </Lead>
        <P>
          That is the point of the whole design. Policy that a pull request could edit is not
          policy: a change could add its own exfiltration host to <C>allow_hosts</C> in the same
          commit that calls it. And a declaration that has to be merged is proof that whoever made
          it controls the repository, which is what makes it worth anything.
        </P>
        <Note>
          If a pull request changes <C>.cujo.yml</C>, the run records a <C>warn</C> saying so and
          uses the base version anyway. The edit takes effect once it is merged, like any other
          policy change.
        </Note>
      </Section>

      <Section id="keys" title="The keys">
        <Table head={["Key", "Read from", "Meaning"]}>
          <Row>
            <Cell head>install</Cell>
            <Cell>base</Cell>
            <Cell>How to install the repository. Inferred when absent.</Cell>
          </Row>
          <Row>
            <Cell head>test</Cell>
            <Cell>base</Cell>
            <Cell>
              How to run the suite. If it is absent and cannot be inferred, the run stops with one{" "}
              <C>warn</C> — &ldquo;no test suite found&rdquo; — and no checks are spawned at all.
            </Cell>
          </Row>
          <Row>
            <Cell head>boot</Cell>
            <Cell>base</Cell>
            <Cell>How to start the app, for the smoke check.</Cell>
          </Row>
          <Row>
            <Cell head>smoke</Cell>
            <Cell>base</Cell>
            <Cell>
              Endpoints to hit once it is up, each written <C>METHOD /path</C>.
            </Cell>
          </Row>
          <Row>
            <Cell head>allow_hosts</Cell>
            <Cell>base</Cell>
            <Cell>
              Hosts this repository legitimately reaches. Anything contacted that is neither listed
              here nor a known package index counts as unknown egress. This is the one key that
              appears in no build file, so it is the one key that can never be inferred — if your
              build talks to a host, only you can say so.
            </Cell>
          </Row>
          <Row>
            <Cell head>discord_guild</Cell>
            <Cell>default branch</Cell>
            <Cell>
              Which Discord server may receive this repository&rsquo;s cards, as a quoted id. Half
              of a two-part binding; see{" "}
              <Link href="/docs/discord" className="text-accent underline underline-offset-4">
                Discord notifications
              </Link>
              .
            </Cell>
          </Row>
        </Table>
        <P>
          <C>discord_guild</C> is extracted by a single strict line match rather than parsed as
          YAML, so a malformed value is not an error — it simply means the repository has declared
          nothing. A configuration typo must never cost a review.
        </P>
      </Section>

      <Section id="unreadable" title="When the file cannot be read">
        <P>Four outcomes, and they are not the same outcome:</P>
        <UL>
          <LI>
            <C>read</C> — the policy is used.
          </LI>
          <LI>
            <C>absent</C> — there is no file. Everything is inferred, and no host is allowlisted.
          </LI>
          <LI>
            <C>too_large</C> — over the size cap. The agent reads the file itself rather than
            proceeding on half a policy.
          </LI>
          <LI>
            <C>unreadable</C> — a symlink pointing out of the checkout, or an I/O error. The run
            stops and says so. Half a policy is worse than none, because the missing half is usually
            the allowlist.
          </LI>
        </UL>
      </Section>
    </>
  );
}
