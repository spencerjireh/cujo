import { C, Cell, LI, Lead, Note, P, Row, Section, Table, UL } from "@/components/docs/Prose";
import Link from "next/link";

/**
 * What actually runs, and — the part a reader needs more — what was watching
 * while it ran. The sensor table is here rather than on the findings page
 * because a sensor is a measurement, and a finding is a judgment about one.
 */
export function Checks() {
  return (
    <>
      <Section id="four" title="Four checks">
        <P>
          Each runs as its own subagent with fresh context: the check&rsquo;s instructions and the
          sandbox, no shared history, and no sight of any other check&rsquo;s report. Only a JSON
          report comes back.
        </P>
        <Table head={["Check", "What it does"]}>
          <Row>
            <Cell head>tests</Cell>
            <Cell>
              Runs the repository&rsquo;s suite on base and on head, in the same box, like for like.
              Reports each test&rsquo;s status on both sides and derives the set that passes on base
              and fails on head — which is the single most useful thing a reviewer can be told.
            </Cell>
          </Row>
          <Row>
            <Cell head>probes</Cell>
            <Cell>
              Reads the diff, writes small scripts that call the changed functions with inputs it
              chooses, and runs them. The expectation is stated before the script runs, so the
              report records a prediction and its outcome rather than a description of what
              happened.
            </Cell>
          </Row>
          <Row>
            <Cell head>smoke</Cell>
            <Cell>
              Boots the app, hits the configured or inferred endpoints, stops it — on head, then on
              base. Reports each endpoint&rsquo;s status on both sides, plus the log tail.
            </Cell>
          </Row>
          <Row>
            <Cell head>detonation</Cell>
            <Cell>
              Runs only when a dependency manifest changed. Diffs the manifest to the specifiers
              that were added or version-bumped, then installs each one on its own into a fresh
              environment and records the hosts it contacted, the files it touched and the processes
              it spawned. A version bump counts: a compromised release is a real attack, and the new
              version runs new install code.
            </Cell>
          </Row>
        </Table>
        <Note>
          No test suite and none named in <C>.cujo.yml</C> means one <C>warn</C> and a stop. No
          checks are spawned at all — running probes against code whose own suite cannot be found is
          a measurement of nothing.
        </Note>
      </Section>

      <Section id="sensors" title="What was watching">
        <Lead>
          Four sensors, shared by every check. Every report says which of them were armed, so
          &ldquo;nothing was observed&rdquo; and &ldquo;nothing could have been observed&rdquo;
          never read alike.
        </Lead>
        <Table head={["Sensor", "Sees", "Blind to"]}>
          <Row>
            <Cell head>proxy</Cell>
            <Cell>
              Host, port and byte count for every connection made through it — pip, npm, cargo, go,
              curl, the common HTTP libraries.
            </Cell>
            <Cell>
              Payloads: there is no TLS interception. And a process that opens a socket directly
              rather than honouring the proxy variables.
            </Cell>
          </Row>
          <Row>
            <Cell head>decoy</Cell>
            <Cell>
              A seeded credentials file that nothing legitimate has any reason to open. Any read of
              it is recorded.
            </Cell>
            <Cell>Nothing, where the kernel provides file-watch events.</Cell>
          </Row>
          <Row>
            <Cell head>audit</Cell>
            <Cell>
              Inside Python: file opens, socket connects, subprocesses. It rides into every Python
              child, including pip running a package&rsquo;s <C>setup.py</C>.
            </Cell>
            <Cell>Anything that is not Python. Reported as unarmed, not as clean.</Cell>
          </Row>
          <Row>
            <Cell head>fs_diff</Cell>
            <Cell>
              Everything created or modified outside the workspace, and anything under a sensitive
              path, by content hash where a silent edit is the attack.
            </Cell>
            <Cell>
              Never off, only capped. The report names the cap when one cut the evidence short.
            </Cell>
          </Row>
        </Table>
        <P>
          An unarmed proxy or decoy earns a <C>warn</C> of its own, never a <C>critical</C>: it says
          the evidence was thin, not that the code did anything.
        </P>
      </Section>

      <Section id="egress" title="Egress, and what makes a host unknown">
        <P>
          Every host contacted is classified once, against two lists: the package indexes Cujo knows
          about — PyPI, npm, crates.io, the Go module proxy, RubyGems, GitHub&rsquo;s own download
          hosts — and whatever the repository named in{" "}
          <Link href="/docs/configure" className="text-accent underline underline-offset-4">
            <C>allow_hosts</C>
          </Link>
          . Anything else is unknown.
        </P>
        <UL>
          <LI>
            Unknown egress during <C>detonation</C> is <C>critical</C>, and it is a hard rule. An
            install that phones home is the supply-chain attack this check exists to catch.
          </LI>
          <LI>
            Unknown egress during any other check is a <C>warn</C>. A test suite reaching a host the
            allowlist does not name is worth a look, and painting it in the same red would be the
            page making an accusation the reviewer did not.
          </LI>
        </UL>
      </Section>
    </>
  );
}
