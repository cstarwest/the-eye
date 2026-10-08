# Security and privacy

Gatekeeper reads source code and sends selected content to a model provider. It is
not an operating-system sandbox or a safe way to execute an untrusted program.
Use a separate account, container or VM for repositories you do not trust. Do not
point the app at a directory containing information you cannot share with the
selected provider.

## What is restricted

- **Repository tools:** reads and searches use the same path policy, check both
  requested and resolved paths, and reject paths outside the selected root.
  Common secret filenames and internal/build directories are withheld. Search
  results are structured before they are formatted, so an explicit filename or
  a filename containing delimiters cannot defeat a text-prefix filter.
- **Git:** the app constructs narrow, read-only metadata commands. Arbitrary
  arguments, branch creation, raw object reads, blame and patch contents are not
  supported. Gitfiles/linked worktrees, shared or alternate object stores, and
  symlinked Git metadata are refused; read/search also fail closed when ignore
  rules cannot be evaluated within the supported layout. Bare repositories are
  unsupported. In particular, `show HEAD:.env`, index blobs and staged patches
  cannot expose secret contents through this tool. Git configuration-driven
  execution is restricted, including clean/process filters during worktree status;
  this is not a general-purpose Git shell.
- **Claude Code:** the app checks the installed CLI's version and required
  capabilities before a question. Claude Code 2.1.248 or newer is required;
  the required isolation flags must also be advertised by the CLI. Older or
  custom installations may need updating. It runs from a private temporary directory,
  with restricted configuration loading and an explicit hook-off setting.
  Built-in tools, including Bash and direct Read, are disabled. Only the app's
  repository MCP tools are exposed and pre-approved. Repository-local executable
  candidates, settings, plugins and MCP configuration are not trusted. Unsupported
  versions or custom tool/permission/MCP overrides fail closed with an error.
  Custom configuration directories, unsupported profiles and provider-selection
  overrides are rejected rather than silently choosing a different account.
  Normal Claude Code subscription authentication is retained; this change does
  not create credentials or switch the user to API billing.
- **API oracle:** repository tools enforce the same restrictions before their
  results are sent to the API. External MCP tools are disabled unless the user
  explicitly lists exact names in that server's `allowedTools`. Missing, empty
  or wildcard grants expose no tools. Remote toolsets have a deny-by-default
  configuration, including tools added by a server later.
- **Desktop boundary:** the window has Node integration off, context isolation
  and Electron sandboxing on, a restrictive content policy, and navigation,
  popup and permission restrictions. Every IPC operation verifies the live
  window, its main frame and the exact application document URL. Root execution
  and known sandbox-disabling launch flags are refused.

## Important residual risks

### Provider disclosure and prompt injection

Questions, selected source text, tool results and conversation history can leave
this computer. Claude Code uses its configured account/provider; the API oracle
uses the configured Anthropic API endpoint and credentials. External remote MCP
servers also receive tool arguments through the provider. Provider retention,
account policies and costs apply. The mock oracle does not use a model provider.
Do not paste credentials or private material into a question.

Repository text and MCP results can contain malicious instructions. Fixed tools
reduce what those instructions can do; they do not guarantee a correct answer,
prevent all disclosure of accessible code, or make tool output trustworthy.
Review answers and do not treat the game's victory condition as authorization.

### Secret filtering and filesystem boundaries

Secret filtering is a filename-based precaution, **not content scanning or data
loss prevention**. Secrets in ordinary source files, commit messages, branch
names, questions or MCP output can still be disclosed. Remove secrets, rotate
exposed credentials, and use a sanitized working copy when needed. Metadata may
include sensitive names or commit messages even when file contents are withheld.

Path checks handle static traversal and symlink aliases. They are not a kernel
filesystem boundary: a hostile concurrent process can race filesystem changes;
hard links, mount points and an already compromised local account remain outside
this protection. Stop concurrent writers or use a separate sandbox for hostile
repositories. Git internals and installed executables are trusted native software.

### Claude Code and machine policy

The CLI, its runtime, the app installation, the login shell and machine-admin
managed policies remain trusted. Preserving normal authentication/home also means
the installed CLI may load user-level context or memory according to its version
and policy. The selected repository is not a guarantee of all possible context
sent to the provider; automatic global context suppression is not verified. Managed Claude policies can take precedence over
command-line settings, including managed hooks. Gatekeeper does not claim to
suppress administrator-controlled code or contain a compromised CLI. Login-shell
startup files can execute when the app imports the login environment; set
`GATEKEEPER_SHELL_ENV=0` to opt out. Use an independently installed, current CLI
outside the repository. The app does not launch a real Claude session in tests. Fake-CLI tests inspect
launch arguments and configuration; live CLI flag enforcement and subscription
authentication have not been exercised by this change.

### External MCP authority

Adding an exact name to `allowedTools` grants that tool unattended authority in
API mode; it is not a per-call confirmation dialog. Review its implementation,
permissions and data destinations first. A tool called “read” or advertising
`readOnlyHint` can still mutate state. Grant only tools whose full behavior you
accept. A configured stdio server runs local code with the user's OS privileges
as soon as an allowed server is connected. Tool allowlists do not sandbox that
process. Only the SDK's minimal default environment and explicit `env` values
are supplied, but a process can still access files permitted to the account.
The hardened Claude Code route does not accept external MCP configuration.

Keep settings and MCP files under your control. Do not copy configuration from a
repository without reviewing it. Avoid unpinned `npx -y` commands; install and
pin reviewed server packages yourself. Do not commit tokens, API keys or settings
containing credentials. Prefer least-privilege credentials and approved secure
storage; the app's JSON settings are not an encrypted vault.

### Cancellation and process cleanup

Cancellation and quit request termination of tracked process groups (process
trees on Windows), with escalation where implemented; SDK-managed MCP clients
are closed separately. This is best effort, not an OS containment guarantee.
A process that detaches, or descendants surviving after their leader exits, may
outlive tracking. Check for survivors after abnormal termination. A timeout or
cancelled UI does not prove that every external side effect was prevented.

### Dependencies and releases

Use Node.js 22.12 or newer. The launcher uses `npm ci` and the committed lockfile
for reproducible dependency selection. Installation/build scripts and native
binaries remain a supply-chain trust decision; the lockfile does not certify
that dependencies are harmless. Install from reviewed sources, review dependency
updates and run `npm audit` regularly. Never disable Electron's sandbox to make a
build launch. Packaging is not code signing or notarization; verify the source
and provenance of release artifacts before installing.

On 2026-10-08, the committed dependency selection reported no production
advisories with `npm audit --omit=dev`. A full audit reported eight moderate
build/development dependency entries, rooted in `sprintf-js` advisory
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
These were not “fixed” by an unreviewed forced builder downgrade. Recheck at
release time; an audit result is neither permanent nor a complete security review.

## Verification and reporting

`npm test` exercises synthetic temporary repositories, fake Claude processes and
a local mock API. Security regressions cover blocked secret paths and Git object
reads, read-only command grammar, constrained Claude launch arguments/config,
MCP grants, IPC sender validation and runtime guards. `npm run test:e2e` requires
a supported non-root graphical Electron environment. Tests do not certify a live
provider, administrator policies, arbitrary MCP servers or every OS/package build.

For a suspected vulnerability, avoid posting credentials, private repositories
or a working exploit publicly. Use GitHub's private vulnerability reporting flow
if enabled, or contact the repository maintainer privately through an established
channel. Include affected version, platform, a synthetic reproduction and impact.
