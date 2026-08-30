import { C, Cell, LI, Lead, Note, P, Row, Section, Table, UL } from "@/components/docs/Prose";

/**
 * The architecture page, and the argument the rest of the product rests on.
 *
 * It is written as one property with a list of things that would break it,
 * rather than as a component diagram — the reader who needs this page is asking
 * "what happens if the pull request is hostile", and a box-and-arrow drawing
 * does not answer that. The drawing they might also want is on
 * /docs/how-it-works.
 */
export function Sandbox() {
  return (
    <>
      <Section id="problem" title="Running a pull request means running a stranger's code">
        <Lead>
          <C>pip install</C> alone executes a package&rsquo;s <C>setup.py</C> before any of your own
          code runs.
        </Lead>
        <P>
          That is not a hazard Cujo introduces; it is the hazard Cujo exists to measure. What
          follows from it is that all of it has to run somewhere holding no credentials, with no
          path back, and that gets thrown away afterwards.
        </P>
      </Section>

      <Section id="zones" title="Two zones, one narrow bridge">
        <Table head={["Zone", "Holds"]}>
          <Row>
            <Cell head>Trusted</Cell>
            <Cell>
              The harness, the Cujo service, the MCP server that posts reviews, and every secret —
              the App&rsquo;s private key, the model key, the Discord token.
            </Cell>
          </Row>
          <Row>
            <Cell head>Untrusted and disposable</Cell>
            <Cell>
              The pull request&rsquo;s code and its dependencies, the checks&rsquo; own scripts,
              Cujo&rsquo;s sensor code, and the logging proxy. One box per turn, destroyed after it.
            </Cell>
          </Row>
        </Table>
        <P>Four things cross into the sandbox, and one comes back:</P>
        <UL>
          <LI>The pull request&rsquo;s code and its public metadata.</LI>
          <LI>The names of the dependencies it added.</LI>
          <LI>
            Cujo&rsquo;s own sensor script and the commands the checks run. Ours, carrying no secret
            — the instrument, not the specimen.
          </LI>
          <LI>
            A public run&rsquo;s own id, so a report can name itself. An id and never a URL, so no
            hostname crosses either.
          </LI>
          <LI>
            Out: <strong className="font-medium text-fg">JSON reports</strong>. Nothing else.
          </LI>
        </UL>
        <Note>
          No token, key, clone credential or hostname ever enters the sandbox. That is the property
          the whole design protects, and it is also why private repositories are unsupported rather
          than partly supported — there is no credential to clone one with, by construction.
        </Note>
      </Section>

      <Section id="inside" title="What is armed inside the box">
        <UL>
          <LI>
            <strong className="font-medium text-fg">A decoy secret.</strong> A plausible credentials
            file that nothing legitimate has any reason to open. Reading it is a hard rule.
          </LI>
          <LI>
            <strong className="font-medium text-fg">A logging proxy.</strong> Every connection made
            through it is recorded by host, port and byte count — and only that. There is no TLS
            interception, so no payload is ever read.
          </LI>
          <LI>
            <strong className="font-medium text-fg">A filesystem diff.</strong> Taken before and
            after every sensed command, hashing content wherever a silent edit would be the attack.
          </LI>
          <LI>
            <strong className="font-medium text-fg">A Python audit hook.</strong> A second,
            independent witness to file opens, socket connects and subprocesses, which rides into
            every Python child including pip&rsquo;s own.
          </LI>
        </UL>
        <P>
          The harness is also configured so that a file written inside the box cannot be fetched
          back out through it. The reports are the only channel.
        </P>
      </Section>

      <Section id="honest" title="Where it is blind, and why it says so">
        <P>
          A sensor that can be off must say when it was off, or a quiet report reads as a clean one.
          So every report carries which sensors were armed and where a cap cut the evidence short,
          and an unarmed proxy or decoy produces a <C>warn</C> of its own.
        </P>
        <P>
          The known gap is a process that opens a socket directly instead of honouring the proxy
          variables. That is a missed observation, not a false one — which is the direction the
          whole sensing design is biased in.
        </P>
      </Section>
    </>
  );
}
