const blue = "#2f7df6";
const blueSoft = "#eaf2fe";
const ink = "#111111";
const muted = "#8a8a86";
const font = { fontFamily: "var(--font-inter)" } as const;
const mono = { fontFamily: "var(--mono)" } as const;

export function Mark({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M6 3h9v9.5a4.5 4.5 0 0 1-4.5 4.5H8.5"
        fill="none"
        stroke={ink}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function SkillsLoop() {
  const files = [
    { provider: "cloudflare", reference: "workers.md" },
    { provider: "stripe", reference: "checkout.md" },
    { provider: "resend", reference: "emails.md" },
  ];

  return (
    <div className="fig-cards">
      <div className="agent">
        <div className="agent__bar">
          <span className="dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          Agent · reading the instructions
        </div>
        <div className="agent__body">
          <p className="bubble">
            Upload the Worker, create a Checkout Session, and send a launch
            email.
          </p>
          {files.map(({ provider, reference }) => (
            <div key={provider}>
              <div className="call">
                <span className="call__name">read</span>
                <span className="call__arg">{provider}/SKILL.md</span>
                <span className="call__state call__state--ok">loaded</span>
              </div>
              <div className="call">
                <span className="call__name">read</span>
                <span className="call__arg">↳ references/{reference}</span>
                <span className="call__state call__state--ok">loaded</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <aside className="ctx">
        <div className="ctx__title">Working context</div>
        <div className="ctx__sub">6 documents loaded</div>
        {files.map(({ provider, reference }) => (
          <div className="ctx__group" key={provider}>
            <div className="ctx__file">{provider}/SKILL.md</div>
            <div className="ctx__file">↳ {reference}</div>
          </div>
        ))}
        <div className="ctx__sub">Instructions and references accumulate.</div>
      </aside>
    </div>
  );
}

export function TreeShape() {
  return (
    <pre className="tree">
      {`capabilities/
├─ cloud-infrastructure/
│  ├─ index.json
│  └─ cloudflare/
│     ├─ index.json
│     └─ accounts/workers/scripts/
│        └─ items.json        ← Upload Worker Module, …
├─ payments-and-finance/
│  └─ stripe/
│     └─ checkout/
│        └─ items.json        ← Create a Checkout Session, …
└─ communication/
   └─ resend/
      └─ emails/
         └─ items.json        ← Send an email, …`}
    </pre>
  );
}

export function ThreePaths() {
  const paths = [
    {
      step: "01 · Upload the Worker module",
      nodes: [
        "Cloud infrastructure",
        "Cloudflare",
        "… / workers / scripts",
        "Upload Worker Module",
      ],
    },
    {
      step: "02 · Create a Checkout Session",
      nodes: [
        "Payments & finance",
        "Stripe",
        "Checkout",
        "Create Checkout Session",
      ],
    },
    {
      step: "03 · Send the launch email",
      nodes: ["Communication", "Resend", "Emails", "Send an email"],
    },
  ];
  const positions = [112, 262, 392, 532];
  const widths = [134, 114, 124, 164];

  return (
    <svg
      className="fig"
      viewBox="0 0 700 310"
      role="img"
      aria-label="The request splits into three parallel searches. Cloudflare leads to Upload Worker Module, Stripe to Create a Checkout Session, and Resend to Send an email. Each path narrows through a group, provider, and resource to an operation."
    >
      <rect x={0} y={143} width={76} height={30} rx={8} fill={ink} />
      <text
        x={38}
        y={162}
        textAnchor="middle"
        fill="#fff"
        fontSize={11}
        {...font}
      >
        request
      </text>
      {["group", "provider", "resource", "operation"].map((label, i) => (
        <text
          key={label}
          x={positions[i]}
          y={16}
          fill={muted}
          fontSize={10.5}
          {...font}
        >
          {label}
        </text>
      ))}
      {paths.map((path, row) => {
        const y = 61 + row * 98;
        return (
          <g key={path.step}>
            <path
              d={`M76 158 C94 158 94 ${y + 15} 112 ${y + 15}`}
              fill="none"
              stroke={blue}
              strokeWidth={1.4}
            />
            <text x={112} y={y - 12} fill={muted} fontSize={11} {...font}>
              {path.step}
            </text>
            {path.nodes.map((label, col) => (
              <g key={label}>
                {col > 0 && (
                  <path
                    d={`M${positions[col - 1] + widths[col - 1]} ${y + 15} H${positions[col]}`}
                    fill="none"
                    stroke={blue}
                    strokeWidth={1.4}
                  />
                )}
                <rect
                  x={positions[col]}
                  y={y}
                  width={widths[col]}
                  height={30}
                  rx={7}
                  fill={blueSoft}
                  stroke="#bcd5fb"
                />
                <text
                  x={positions[col] + widths[col] / 2}
                  y={y + 19}
                  textAnchor="middle"
                  fill={blue}
                  fontSize={10.5}
                  fontWeight={500}
                  {...font}
                >
                  {label}
                </text>
              </g>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export function OneHop() {
  const rows = [
    { l: "Checkout", v: 0.95, pick: true },
    { l: "Payment intents", v: 0.03 },
    { l: "Customers", v: 0.01 },
    { l: "Subscriptions", v: 0.01 },
    { l: "None of these", v: 0.0 },
  ];
  return (
    <div className="hop">
      <div className="hop__q">
        <span className="hop__step">Create a Stripe Checkout Session</span>
        <span className="hop__at">at stripe · selected options</span>
      </div>
      <ul className="hop__rows">
        {rows.map((r) => (
          <li key={r.l} className={r.pick ? "is-pick" : undefined}>
            <span>{r.l}</span>
            <i>
              <b style={{ width: `${r.v * 100}%` }} />
            </i>
            <em style={mono}>{r.v.toFixed(2)}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ResultCards() {
  const cards = [
    {
      provider: "Cloudflare",
      color: "#f38a1f",
      name: "Upload Worker Module",
      method: "PUT",
      path: "/client/v4/accounts/{account_id}/workers/scripts/{script_name}",
      fields: "account_id, script_name · multipart module",
    },
    {
      provider: "Stripe",
      color: "#6b5cf6",
      name: "Create a Checkout Session",
      method: "POST",
      path: "/v1/checkout/sessions",
      fields: "Creates a Checkout Session object",
    },
    {
      provider: "Resend",
      color: "#111111",
      name: "Send an email",
      method: "POST",
      path: "/emails",
      fields: "Idempotency-Key header optional",
    },
  ];
  return (
    <div className="results">
      {cards.map((c) => (
        <article key={c.provider} className="result">
          <span className="result__provider" style={{ color: c.color }}>
            {c.provider}
          </span>
          <strong>{c.name}</strong>
          <span className="pill">{c.method}</span>
          <code>{c.path}</code>
          <small>{c.fields}</small>
        </article>
      ))}
    </div>
  );
}
