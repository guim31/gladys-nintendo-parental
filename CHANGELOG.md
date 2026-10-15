# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Nintendo account sign-in like the Parental Controls app: the Connect button opens
  the Nintendo sign-in page, the link of "Select this person" is pasted once, and
  the integration keeps its own session. No password goes through Gladys.
- One device per console (Switch, Switch Lite, Switch OLED, Switch 2): play time
  today, time remaining, daily limit, bonus time, current or last game, playing,
  online and "suspend software at limit".
- Commands: the daily limit (no limit, or 15 minutes to 6 hours) and the software
  suspension at the limit, written where the app writes them.
- Scene triggers "Starts playing", "Limit almost reached" (30, 15, 10 or 5
  minutes left) and "Limit exceeded".
- Scene actions "Add bonus time" and "Set the daily limit".
- A "Nintendo Switch" dashboard widget: play time against the limit, game, mode,
  and "+15 min", "Alarm only" and "Suspend" buttons.
- "Check the connection" and "Sign out of Nintendo" actions in the configuration.
- Documentation in English, French, German and Spanish.

[Unreleased]: https://github.com/guim31/gladys-nintendo-parental/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-nintendo-parental/releases/tag/v1.0.1
