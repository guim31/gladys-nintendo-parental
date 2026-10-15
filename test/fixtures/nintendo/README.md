# Nintendo Parental Controls fixtures

Real answers of the Nintendo Switch Parental Controls API, as published with
the tests of [pynintendoparental](https://github.com/pantherale0/pynintendoparental)
(MIT, © Justin Hammond), which anonymized them with Faker (ids, nicknames,
titles of the settings). Serial numbers, tokens, unlock and pairing codes and
account ids are replaced again by invented values here.

| File                                    | Source                                                                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owned_devices.json`                    | `account_devices.json` (a Switch, `P00`), plus a second console made from the first one: invented id, `P01` (Switch 2). Labels set to "Living room" and "Bedroom".        |
| `daily_summaries_switch.json`           | `device_daily_summaries.json`, unchanged.                                                                                                                                 |
| `parental_control_setting_switch.json`  | `device_parental_control_setting.json`, unchanged (daily mode, no limit, alarm only).                                                                                     |
| `daily_summaries_switch2.json`          | The raw Switch 2 summaries of `multiple_devices.json` ("Device 1 (P01)"), dates shifted so the latest is 2025-12-08 like the Switch; `lastUpdatedAt` set to that evening. |
| `parental_control_setting_switch2.json` | The Switch answer, turned into the per-day mode with a 2-hour limit on Mondays and the software suspended at the limit (shapes of the pynintendoparental test helpers).   |
