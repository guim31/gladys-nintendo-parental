# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration holds and where:

- **The Nintendo session token**, the long-lived credential of the parent's
  Nintendo account obtained when the pasted link is used, in
  `/data/nintendo-state.json` (readable by the container user only, mode 600),
  with the sign-ins in progress (state and PKCE verifier) and what was seen of
  each console today. Short-lived id tokens stay in memory. "Sign out of
  Nintendo" deletes the session. None of them is ever written to the logs.
- **The pasted link** (single use, expires within minutes) stays in the Gladys
  configuration as a secret field; only a fingerprint of it is kept in `/data`.
- **The password** of the Nintendo account never goes through the integration:
  it is typed on nintendo.com only.

Network: outgoing HTTPS only, to `accounts.nintendo.com` (sign-in, tokens) and
`app.lp1.znma.srv.nintendo.net` (Parental Controls API). The container listens
on no port.

A report about what someone with access to Gladys can do with the commands
(change the limit, add bonus time, change the mode) is in scope too.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Nintendo services and consoles the integration talks to.
