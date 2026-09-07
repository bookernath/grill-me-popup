// A sample round used by the preview and the tests. Deliberately generic:
// designing the config system of a hypothetical CLI called "harbor".
export const SAMPLE = {
  roundId: "preview",
  round: 2,
  topic: "Configuration model for the `harbor` CLI",
  context:
    "Settled in round 1: `harbor` is a single static binary, config is **declarative**, and the CLI must work with no config file at all. " +
    "This round settles where configuration comes from and how conflicts between sources are resolved.",
  questions: [
    {
      id: "Q4", title: "Precedence between configuration sources",
      body:
        "Four sources can set the same key: built-in defaults, a project file (`harbor.toml`), the environment (`HARBOR_*`), and flags. " +
        "When two disagree, which wins?\n\n" +
        "```mermaid\nflowchart LR\n  D[defaults] --> F[harbor.toml] --> E[HARBOR_* env] --> C[CLI flags]\n  C -->|effective value| R((resolved))\n```\n\n" +
        "The conventional order is *later overrides earlier*, but some teams pin the project file above the environment so CI cannot silently drift.",
      recommendation:
        "Conventional order — flags over env over file over defaults — with `harbor config explain <key>` to show which layer won. " +
        "Pinning the file above env is surprising to everyone who has used any other tool, and `explain` removes the drift worry.",
      options: [
        { key: "A", label: "flags > env > file > defaults", detail: "The order every other CLI uses.", recommended: true },
        { key: "B", label: "flags > file > env > defaults", detail: "Project file wins over environment so CI cannot drift from the repo." },
        { key: "C", label: "No environment layer at all", detail: "Env vars only ever select which file to load." },
      ],
    },
    {
      id: "Q5", title: "Where the project file may live",
      body:
        "| Location | Found by | Used by |\n|---|---|---|\n| `./harbor.toml` | cwd only | most tools |\n| nearest ancestor | walk up to `/` | git, cargo |\n| `~/.config/harbor/` | XDG | user-level defaults |\n\n" +
        "Walking up the tree makes `harbor` work from any subdirectory of a project, at the cost of a surprising pickup when a parent directory happens to contain a file.",
      recommendation: "Walk up to the nearest `harbor.toml` **or** the nearest `.git`, whichever comes first — the repo boundary is the natural stop.",
      options: [
        { key: "A", label: "Current directory only" },
        { key: "B", label: "Walk up to the nearest harbor.toml", detail: "Stop at the filesystem root." },
        { key: "C", label: "Walk up, but stop at the repo boundary", detail: "Nearest `harbor.toml` or `.git`, whichever is closer.", recommended: true },
      ],
    },
    {
      id: "Q6", title: "Secrets in configuration",
      body:
        "Some keys are credentials (`registry.token`). Should the file format allow them inline, or only by reference?\n\n" +
        "```mermaid\nsequenceDiagram\n  participant H as harbor\n  participant F as harbor.toml\n  participant E as env\n  H->>F: read registry.token\n  F-->>H: \"env:REGISTRY_TOKEN\"\n  Note over H,E: reference resolved at load time, never written back\n  H->>E: getenv(REGISTRY_TOKEN)\n  E-->>H: value\n```\n\n" +
        "> A config file that *can* hold a secret eventually *will*, and it will be committed.\n\n" +
        "References could look like `token = \"env:REGISTRY_TOKEN\"` or `token = \"file:~/.harbor/token\"`.",
      recommendation:
        "Reference-only for keys marked secret in the schema; inline values are rejected at load time with a message that shows the reference syntax. " +
        "Non-secret keys are unaffected.",
    },
    {
      id: "Q7", title: "Unknown keys",
      body: "A typo (`retires = 3`) is silently ignored by lenient loaders and hard-fails in strict ones. Which is `harbor`?",
      recommendation: "Hard fail, with a *did you mean `retries`?* suggestion from the schema. Silent acceptance is how config rot starts.",
      options: [
        { key: "A", label: "Error, with a suggestion", recommended: true },
        { key: "B", label: "Warn and continue" },
        { key: "C", label: "Ignore silently" },
      ],
    },
    {
      id: "Q8", title: "Which formats to accept",
      body: "TOML is settled as the canonical format. Should JSON and YAML also be accepted, as many users will reach for them first?",
      recommendation: "TOML only. One format keeps `explain`, the schema errors and the docs single-sourced; a `harbor config convert` can import the others.",
      options: [
        { key: "A", label: "TOML only", recommended: true },
        { key: "B", label: "TOML + JSON" },
        { key: "C", label: "TOML + JSON + YAML" },
      ],
      multi: false,
    },
  ],
};
