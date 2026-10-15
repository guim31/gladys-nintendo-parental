# Nintendo Parental Controls for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for the **Nintendo Switch Parental
Controls**, like the "Nintendo Switch Parental Controls" smartphone app and the Home Assistant
`nintendo_parental_controls` integration:

- **one device per console** (Switch, Switch Lite, Switch OLED, Switch 2): today's play time, time remaining, daily
  limit, bonus time, current or last game, playing, online, and the "suspend software at limit" switch;
- **commands**, the parental actions of the app: change the daily limit (no limit, or 15 minutes to 6 hours), add
  bonus time for today, suspend the software at the limit instead of an alarm;
- **scene triggers**: _starts playing_ (with the game), _limit almost reached_ (30, 15, 10 or 5 minutes left) and
  _limit exceeded_;
- **scene actions**: _add bonus time_ and _set the daily limit_;
- **a dashboard widget**: the consoles, play time against the limit, and "+15 min", "Alarm only" and "Suspend"
  buttons (each with a confirmation).

**Not affiliated with Nintendo**: Nintendo Switch is a trademark of Nintendo.

> **Developed without the hardware: feedback welcome.** No console and no Nintendo account were at hand: the code is
> tested against the real, anonymized answers of the Parental Controls API published with the tests of
> pynintendoparental, not yet against the live service.

## Requirements

- Gladys Assistant **5.1.0** or later.
- The parent's **Nintendo account**, with the console(s) already paired in the Nintendo Switch Parental Controls app.
- The consoles connected to the Internet: everything goes through Nintendo's servers (`transports: cloud`).

## Installation

In Gladys: **Integrations → Install from GitHub**, paste `https://github.com/guim31/gladys-nintendo-parental`, then,
in the **Configuration** tab:

1. click **Connect**: the Nintendo sign-in page opens; sign in with the parent account;
2. right-click the red **Select this person** button, **Copy link address** (a `npf54789befb391a838://auth#…` link);
3. paste it in **Link of "Select this person"** and save.

Then add the consoles from the **Discovery** tab. The password is only ever typed on nintendo.com.

The full user documentation is in [English](docs/en.md), [French](docs/fr.md), [German](docs/de.md) and
[Spanish](docs/es.md).

## How it works

- **Sign-in** as the app does it: the Connect button (`account_link` field) gets a sign-in URL with a PKCE challenge
  from the container; the pasted link gives a single-use code, exchanged for a long-lived session token kept in
  `/data/nintendo-state.json` (mode 600), then short-lived id tokens renewed every 10 minutes. No password goes
  through the integration, and nothing works around a Nintendo protection: a refused link or session is reported in
  the Configuration screen.
- **Refresh** by an internal timer (1, 2 or 5 minutes, 1 by default): the core's polling of external devices is not
  reliable (GladysAssistant/Gladys#3198), `onPoll` only stays as a fallback. Per console, 2 requests per refresh (daily
  summaries, settings), plus the console list every 30 minutes: about 2 requests a minute for one console, the pace of
  the Home Assistant integration. Nintendo publishes no quota for this private API; a 429 pauses the refreshes for 5
  minutes.
- **Playing** is deduced from today's play time growing (Nintendo has no "playing now" flag), the current game from
  the game whose play time grew; the console uploads every few minutes, so both come a few minutes late.
- Only changed states are sent to Gladys, with a heartbeat every 6 hours; everything is sent again when a console is
  added.

## Limits

- The data are as fresh as the console's own reports (every few minutes, while it is online).
- "Online" means "sent play data in the last 20 minutes".
- Once a bonus is granted for the day, Nintendo refuses any change of the limit or of the mode until the next day.
- Bedtime, per-day settings, content restrictions, PIN and monthly reports stay in the app.
- The API is the private API of the official app; Nintendo may change it at any time.

## Development

```bash
npm install
npm test                 # node --test, against the SDK's fake Gladys and a fake Nintendo
npm run lint
npm run format:check
node scripts/probe.mjs   # read-only probe of the real Nintendo servers (needs the network)
```

`scripts/probe.mjs` runs the integration's own sign-in and client against Nintendo: with no environment, fake
values (code, session token, id token) that must each be refused the expected way; with `NINTENDO_SESSION_TOKEN`, a
real read-only pass that prints only counts and minutes (no token, id, name or label).

Project rules for contributors and coding assistants: [CLAUDE.md](CLAUDE.md). Releases are made with the
**Release** workflow (Actions → Release), which bumps the versions and builds the image.

## Credits

- [pynintendoparental](https://github.com/pantherale0/pynintendoparental) (MIT) and
  [pynintendoauth](https://github.com/pantherale0/pynintendoauth) (Apache-2.0), by Justin Hammond (pantherale0): the
  endpoints, headers, sign-in flow and time computations are ported from them, and the test fixtures of
  `test/fixtures/nintendo` come from their tests.
- The Home Assistant [`nintendo_parental_controls`](https://www.home-assistant.io/integrations/nintendo_parental_controls/)
  integration (Apache-2.0, by the Home Assistant authors) for the choice of entities and bounds.
- [Gladys Assistant](https://github.com/GladysAssistant/Gladys) and its
  [integration SDK](https://github.com/GladysAssistant/integration-sdk-js), by Pierre-Gilles Leymarie and the
  contributors.

## License

[Apache-2.0](LICENSE).
