import Image from "next/image";
import {
  Mark,
  OneHop,
  ResultCards,
  SkillsLoop,
  ThreePaths,
  TreeShape,
} from "./figures";

const demoVideo = {
  src: "/media/jcr-demo.309f937ccaf8.mp4",
  poster: "/media/jcr-demo-poster.054e63ed1f78.webp",
};

const nodeJson = `{
  "id": "cloudflare",
  "name": "Cloudflare",
  "description": "DNS, zones, Workers, networking, security, storage, and edge services."
}`;

const itemsJson = `[
  {
    "id": "worker-script-upload-worker-module",
    "name": "Upload Worker Module",
    "description": "Upload a worker module to Cloudflare.",
    "context": "PUT /client/v4/accounts/{account_id}/workers/scripts/{script_name}\\nUpload a worker module. …\\nRequired: account_id (path); script_name (path); body (body)"
  }
]`;

const resolverCode = `async function resolve_capabilities(request) {
  const steps = await splitIfNeeded(request)
  return Promise.all(steps.map(async step => {
    let paths = [rootPath()]
    while (canExpand(paths)) {
      const options = await describeDirectChildren(paths)
      const probabilities = await askJev(request, step, options)
      paths = rankAndPrune(paths, options, probabilities)
    }
    if (isUnresolved(paths)) return explainUnresolved(paths)
    return selectedItems(paths).map(({ path, context }) => (
      { path, context }
    ))
  }))
}`;

const output = `## 1. Upload the Worker module to Cloudflare
cloud-infrastructure/cloudflare/accounts/workers/scripts/worker-script-upload-worker-module
PUT /client/v4/accounts/{account_id}/workers/scripts/{script_name}
Upload a worker module. …
Required: account_id (path); script_name (path); body (body)

## 2. Create a Stripe Checkout Session
payments-and-finance/stripe/checkout/PostCheckoutSessions
POST /v1/checkout/sessions
Creates a Checkout Session object.
Optional: body (body)

## 3. Send a launch email with Resend
communication/resend/emails/post_emails
POST /emails
Send an email
Optional: Idempotency-Key (header) — …; body (body)`;

export default function Home() {
  return (
    <main className="article">
      <link
        rel="preload"
        as="image"
        href={demoVideo.poster}
        fetchPriority="high"
      />
      <header className="masthead">
        <div className="brand">
          <Mark />
          <span>JCR</span>
        </div>
        <h1>How I&rsquo;m using Jev in an agent harness</h1>
        <p className="lede">
          I built JCR to explore how Jev can help agents find deterministic
          commands across providers. It&rsquo;s a capability lookup designed to
          complement skills.
        </p>
        <div className="byline">
          <strong>Niaz Morshed</strong>
          <span>
            <a href="https://x.com/niazmorshed_">@niazmorshed_</a> · September
            20, 2026
          </span>
        </div>
      </header>

      <figure className="video">
        <video
          src={demoVideo.src}
          poster={demoVideo.poster}
          width={1440}
          height={810}
          preload="auto"
          autoPlay
          muted
          loop
          playsInline
        />
      </figure>

      <p>
        On September 15, TypeSafe{" "}
        <a href="https://typesafe.ai/blog/introducing-system-one-models-and-jev">
          released Jev
        </a>
        , its first{" "}
        <a href="https://docs.typesafe.ai/introduction">System One model</a>, in
        early access. It makes quick, structured decisions with probabilities
        that code can act on. People are already using it for{" "}
        <a href="https://x.com/gregpr07/status/2100411066966749359">
          browser control
        </a>{" "}
        and experimenting with{" "}
        <a href="https://x.com/ryanvogel/status/2100042788851101842">
          email classification
        </a>
        .
      </p>
      <p>
        I kept thinking about how much reading agents do before finding the
        command they need. The harness could handle more of that search. That
        led me to build the Jev Capability Resolver, or JCR, to see how much of
        that lookup I could move out of the agent&rsquo;s context.
      </p>
      <p>
        Skills give us a useful starting point. A skill packages instructions in
        a <code>SKILL.md</code> file, often with scripts and references
        alongside it. In the{" "}
        <a href="https://agentskills.io/home">usual loading mechanism</a>, the
        agent initially sees the name and description of each available skill.
        When one looks relevant, it opens the full instructions and follows the
        references it needs.
      </p>
      <p>
        That keeps the full library out of context at the start. But the files
        the agent does read usually stay in its working context as it moves
        through the task.
      </p>
      <p>
        Imagine we have a small app ready to launch. Here is what we ask the
        agent to do.
      </p>
      <blockquote className="task-quote">
        Upload the app&rsquo;s Worker module to Cloudflare, create a Stripe
        Checkout Session, and send a launch email with Resend.
      </blockquote>
      <p>
        The agent reads the Cloudflare skill, which points it to a Workers
        reference. Then it reads the Stripe skill and a checkout guide. Then the
        Resend skill and its email reference. We now have six documents in
        context to find three operations. They may include setup instructions,
        alternative approaches, and examples that have nothing to do with this
        particular app.
      </p>
      <figure>
        <SkillsLoop />
        <figcaption>
          An illustrative sequence. Each file is read on demand, but the earlier
          reads remain in context as the agent moves to the next integration.
        </figcaption>
      </figure>
      <p>
        This is where things can start to slip. The agent might use a detail
        from the wrong example, miss a requirement buried in a reference, or
        settle on a familiar command before finding the right one. As more
        skills and overlapping capabilities become available, choosing which
        instructions to read also becomes a bigger part of the job.
      </p>
      <p>
        Skills are useful for teaching workflows and conventions. Alongside
        them, I wanted a way to organize the deterministic commands an agent can
        use. By that I mean an operation with a defined invocation and inputs,
        such as a CLI command or an API endpoint. The model chooses the
        operation that fits from commands that are already documented.
      </p>
      <p>
        So I put those capabilities into a tree of broad areas, providers,
        resources, and individual operations. The entries are plain files that
        another harness could read too. Here are a few branches from the catalog
        JCR uses today.
      </p>
      <figure>
        <TreeShape />
        <figcaption>
          A few branches from JCR&rsquo;s capability tree. Some intermediate
          directories and index files are omitted for space.
        </figcaption>
      </figure>
      <p>
        The format uses plain directories and JSON files. Each node has an{" "}
        <code>index.json</code> with an ID, a name, and a description that helps
        a resolver choose that branch.
      </p>
      <pre className="code code--wrap">
        <code>{nodeJson}</code>
      </pre>
      <p>
        An <code>items.json</code> file holds a list of capabilities. Each one
        has the same identifying fields, plus <code>context</code> for the exact
        command, its inputs, and the instructions needed to use it. Here is a
        shortened version of the upload entry.
      </p>
      <pre className="code code--wrap">
        <code>{itemsJson}</code>
      </pre>
      <p>
        The format has no fixed nesting limit. A group can contain commands,
        subgroups, or both, and each subgroup follows the same structure. If a
        list of commands gets too large, I recommend splitting it into smaller,
        meaningful subgroups and placing the commands inside them. You can
        repeat this for as many levels as you need, keeping the choices at each
        level manageable.
      </p>
      <p>
        You can add a command to an existing branch or organize a new group
        without changing the format. I want people to be able to read these
        files, improve them, and build their own tooling around them.
      </p>
      <p>
        JCR is the resolver I built to use this format. I am using Jev for the
        routing decisions, but the format itself does not depend on Jev. Another
        harness could search the same files differently. In JCR, the agent gets
        one tool for the lookup.
      </p>
      <pre className="code code--center">
        <code>resolve_capabilities(request)</code>
      </pre>
      <p>
        The agent sends its complete request. JCR searches the tree and returns
        the context attached to the matches, so the agent only reads what the
        search finds.
      </p>
      <p>
        Follow the same launch request through this process. Jev first checks
        whether the request contains one action or several. If it contains
        several, a small language model breaks it into individual steps, while
        keeping the details and dependencies from the request.
      </p>
      <ol className="steps">
        <li>Upload the Worker module to Cloudflare.</li>
        <li>Create a Stripe Checkout Session.</li>
        <li>Send the launch email with Resend.</li>
      </ol>
      <p>
        Each step now gets its own search, and those searches run in parallel.
        We are only looking up instructions here. The agent still handles the
        order in which the actual work needs to happen.
      </p>
      <figure>
        <ThreePaths />
        <figcaption>
          Three independent searches, each ending at a specific operation.
          Intermediate levels are compressed in this view.
        </figcaption>
      </figure>
      <p>
        Take the Stripe step. At the top of the tree, Jev sees the names and
        descriptions of the broad groups and selects payments and finance.
        Inside that group, it selects Stripe. Then checkout. Then the operation
        for creating a Checkout Session. Every decision narrows down what it
        needs to look at next.
      </p>
      <p>
        At each level, Jev only sees the direct children of the current node. It
        does not read all the operations underneath them. The Cloudflare and
        Resend searches follow their own branches in the same way. That lets JCR
        work through a catalog with thousands of entries without putting the
        whole catalog into a prompt.
      </p>
      <p>
        Here is the tool in simplified pseudocode. The helper names describe the
        work happening inside JCR. The loop searches recursively by repeating
        the same choice inside each subgroup it follows.
      </p>
      <pre className="code">
        <code>{resolverCode}</code>
      </pre>
      <p>
        In each round, <code>describeDirectChildren</code> gathers just the
        names and descriptions under the open paths. Jev compares them against
        the request and the current step, including a no-match option. The
        command&rsquo;s full context stays out of these routing questions.
      </p>
      <p>
        Then <code>rankAndPrune</code> combines the probabilities along each
        path using a geometric mean. This lets paths of different depths compete
        without penalizing one just for having more levels. JCR ranks them and,
        by default, keeps up to three close candidates. If two branches still
        look promising, both continue into the next round, where Jev evaluates
        their children together.
      </p>
      <p>
        Once a path reaches a command, JCR keeps it in the ranking while the
        open paths continue. When the search finishes, the tool takes the stored{" "}
        <code>context</code> from each selected item and returns it with its
        path. The scores and intermediate choices stay inside the resolver. It
        retrieves the instructions without generating or executing a command.
      </p>
      <figure>
        <OneHop />
        <figcaption>
          An illustrative choice inside Stripe. Here, checkout is a clear enough
          match to continue down one branch.
        </figcaption>
      </figure>
      <p>
        If a few final matches remain close, the agent can receive them
        together. If too many remain close, JCR reports ambiguity so the agent
        can ask again with a more precise request. Each choice also includes
        &ldquo;none of these,&rdquo; so the search can end without a match. The
        probabilities help guide the search, though a match can still be wrong.
      </p>
      <p>For our example, the three paths lead to these operations.</p>
      <figure>
        <ResultCards />
      </figure>
      <p>
        JCR returns each item&rsquo;s path and <code>context</code>, grouped by
        step. Here is the response, with longer descriptions shortened.
      </p>
      <pre className="code code--wrap">
        <code>{output}</code>
      </pre>
      <p>
        We started with six documents to find three operations. Now the agent
        has three small blocks of context and can get back to our app. It still
        needs to supply the values, make the calls, and check what happened. But
        it got here without bringing all six documents into the rest of the
        conversation.
      </p>
      <section className="benchmark-section" aria-label="Benchmark results">
        <p>
          I wanted to measure this beyond the example, so I ran{" "}
          <mark className="metric metric--detail">20</mark> scenarios through
          the Claude harness with Opus 5 and the Codex harness with GPT-5.6-Sol.
          Each scenario ran once with skills and once with JCR in each harness,
          giving <mark className="metric metric--detail">80</mark> runs. The
          agents only read the instructions and explained the steps needed for
          the task. They did not execute any of those steps.
        </p>
        <figure className="benchmark">
          <a
            className="benchmark__image"
            href="/jcr-benchmark-sol-opus.png"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open the benchmark measurements at full size in a new tab"
          >
            <Image
              src="/jcr-benchmark-sol-opus.png"
              alt="Benchmark report for 20 scenarios in Claude and Codex harnesses comparing skills with JCR. Opus 5 used 85% less agent context at 67% lower total cost. GPT-5.6-Sol used 23% less agent context at 16% lower total cost, but took longer."
              width={2156}
              height={996}
              sizes="(max-width: 720px) calc(100vw - 40px), 680px"
            />
          </a>
          <figcaption>
            20 scenarios, two harnesses, two modes. The report shows averages
            per run and total costs. Open the image to read it at full size.
          </figcaption>
        </figure>
        <p className="metric-key" aria-label="Benchmark number colors">
          <span className="metric metric--baseline">Skills baseline</span>
          <span className="metric metric--lower">Lower with JCR</span>
          <span className="metric metric--slower">Slower with JCR</span>
          <span className="metric metric--detail">Run details</span>
        </p>
        <p>
          With Opus 5, average agent context fell from{" "}
          <mark className="metric metric--baseline">108,585</mark> to{" "}
          <mark className="metric metric--lower">15,819</mark> tokens, a
          reduction of about <mark className="metric metric--lower">85%</mark>.
          Average total cost dropped from{" "}
          <mark className="metric metric--baseline">$0.3700</mark> to{" "}
          <mark className="metric metric--lower">$0.1222</mark> per run, about{" "}
          <mark className="metric metric--lower">67%</mark> less. With
          GPT-5.6-Sol, context fell from{" "}
          <mark className="metric metric--baseline">61,952</mark> to{" "}
          <mark className="metric metric--lower">47,669</mark> tokens, about{" "}
          <mark className="metric metric--lower">23%</mark> less, and average
          total cost dropped from{" "}
          <mark className="metric metric--baseline">$0.1377</mark> to{" "}
          <mark className="metric metric--lower">$0.1151</mark>, about{" "}
          <mark className="metric metric--lower">16%</mark> less.
        </p>
        <p>
          Context here means the input tokens processed by the agent across the
          run, including cached tokens. Jev&rsquo;s context is reported
          separately. The JCR cost includes the agent model, Jev routing, and
          the model that breaks compound requests into steps, so the savings
          account for that extra work too.
        </p>
        <p>
          Time went in different directions. Opus 5 averaged{" "}
          <mark className="metric metric--baseline">105.5</mark> seconds with
          skills and <mark className="metric metric--lower">77.7</mark> with
          JCR. Sol went from{" "}
          <mark className="metric metric--baseline">25.3</mark> seconds to{" "}
          <mark className="metric metric--slower">62.4</mark>. These are means,
          and a long run can pull them up. One Sol run took{" "}
          <mark className="metric metric--slower">372.6</mark> seconds, with{" "}
          <mark className="metric metric--detail">two</mark> resolver calls and{" "}
          <mark className="metric metric--detail">193</mark> Jev calls. Across
          all <mark className="metric metric--detail">20</mark> scenarios,
          Sol&rsquo;s median was{" "}
          <mark className="metric metric--baseline">23.2</mark> seconds with
          skills and <mark className="metric metric--slower">45.4</mark> with
          JCR. Opus 5&rsquo;s median went from{" "}
          <mark className="metric metric--baseline">86.6</mark> to{" "}
          <mark className="metric metric--lower">57.5</mark> seconds. Sol was
          still slower with JCR in{" "}
          <mark className="metric metric--slower">19 of 20</mark> scenarios, so
          that one run explains only part of the gap.
        </p>
        <p>
          The timer covers the whole agent run, including startup, model
          generation, tool calls, routing, and decomposition. The agents also
          produced different amounts of output. I ran each case once, with
          multiple runs active at the same time. The model&rsquo;s choices and
          API response times could affect these numbers, but the report does not
          isolate their contributions. I would want repeated runs and timings
          for each stage before saying how much of the gap comes from Jev, the
          harness, or the agent&rsquo;s behavior.
        </p>
        <p>
          For this batch, I got lower cost and less agent context in both
          harnesses, with a longer wait in Codex.
        </p>
      </section>
      <p>
        That is the kind of work I wanted to try with Jev. The harness handles
        the small decisions about where to look, and the agent gets the command
        it needs for the next step. A skill can still guide how it approaches
        the whole task. I want the two to work together.
      </p>

      <p>
        If someone adds their provider&rsquo;s commands to this tree, I want
        another harness to be able to use them too. Some of the current entries
        still need better parameter details and examples. With a shared format,
        we could improve an entry once and share that fix with everyone using
        it.
      </p>
      <p>
        Do you think this could become an open standard for deterministic
        commands across providers? Let&rsquo;s{" "}
        <a href="https://github.com/NiazMorshed2007/jcr/discussions">
          discuss it on GitHub
        </a>
        . I&rsquo;d love to hear what you&rsquo;d change and what you&rsquo;d
        want to build with it.
      </p>

      <footer className="end">
        <div className="brand">
          <Mark size={16} />
          <span>JCR</span>
        </div>
        <span>
          Niaz Morshed ·{" "}
          <a href="https://x.com/niazmorshed_">@niazmorshed_</a>
        </span>
      </footer>
    </main>
  );
}
