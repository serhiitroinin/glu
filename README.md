# glu

A terminal CLI for reading **FreeStyle Libre 3** continuous glucose monitor (CGM) data via the LibreLinkUp API.

Outputs glucose readings, time-in-range analysis, CV, GMI, and configurable personal targets — all from your shell.

![demo](demo/demo.gif)

```
$ glu current
118 mg/dL (6.6 mmol/L) →  [IN RANGE]
  at 2026-05-09T10:14:00

$ glu tir
TIR Analysis — Last 12 hours (graph)

Readings:  144

── Glucose ──────────────────────────
  Mean:    132 mg/dL (7.3 mmol/L)
  SD:      28.4 mg/dL
  CV:      21.5% ✓
  Min:     78 mg/dL  Max: 198 mg/dL
  GMI:     6.2%

── Time in Range ────────────────────
  Very Low  (<54):     0%   (0/144) ✓
  Low       (54-69):   0%   (0/144)
  TBR total (<70):     0%   ✓
  In Range  (70-180):  92.4% (133/144) ✓
  High      (181-250): 7.6%  (11/144)
  Very High (>250):    0%    (0/144)

── Targets (2019 consensus) ─────────
  TIR  ≥70%:  ✓ PASS
  TBR  <4%:   ✓ PASS
  <54  <1%:   ✓ PASS
  TAR  <25%:  ✓ PASS
  >250 <5%:   ✓ PASS
  CV   ≤36%:  ✓ PASS
  GMI  <7%:   ✓ PASS
```

## Requirements

- macOS (uses Keychain for credential storage)
- [Bun](https://bun.sh) ≥ 1.0
- A FreeStyle Libre 3 sensor synced to a [LibreLinkUp](https://www.librelinkup.com) account with **sharing enabled**

## Install

```bash
git clone https://github.com/serhiitroinin/glu.git
cd glu
bun install
bun run build         # compiles to dist/glu
ln -s "$PWD/dist/glu" /usr/local/bin/glu   # optional: put on PATH
```

Or run directly without compiling:

```bash
bun run src/cli.ts current
```

## First-time setup

1. Install **LibreLinkUp** on your phone and accept the patient share invitation from the LibreLink app.
2. Confirm you can see live readings in LibreLinkUp.
3. Authenticate `glu`:

   ```bash
   glu setup your@email.com
   glu login
   ```

   Credentials are written to macOS Keychain (service: `glu`). The login flow handles regional API redirects (eg `api-eu`, `api-us`) and patient discovery automatically.

## Commands

### Auth

| Command | Description |
|---|---|
| `glu setup <email>` | Save LibreLinkUp credentials |
| `glu login` | Authenticate, follow region redirect, discover patient |
| `glu status` | Show API region, patient name, token expiry |

### Data

| Command | Description |
|---|---|
| `glu current` | Latest glucose reading + trend arrow |
| `glu graph` | Last ~12 hours, table format |
| `glu logbook` | Last ~2 weeks, table format |
| `glu tir [graph\|logbook]` | TIR/TBR/TAR/CV/SD/GMI analysis (default: graph) |
| `glu overview` | Compact: current + 12h TIR summary |

### Raw API

| Command | Description |
|---|---|
| `glu json <path>` | Print raw JSON from any LibreLinkUp endpoint |

## Glucose ranges (mg/dL)

| Range | Label | Notes |
|---|---|---|
| `<54` | Very low | Severe hypoglycemia, immediate treatment |
| `54–69` | Low | Hypoglycemia |
| `70–180` | In range | Target window |
| `181–250` | High | Hyperglycemia |
| `>250` | Very high | Severe hyperglycemia |

## Targets

Targets default to the [2019 International Consensus on Time in
Range](https://care.diabetesjournals.org/content/42/8/1593) for non-pregnant adults with
type 1 / type 2 diabetes. Run `glu targets` to see the effective values.

| Metric | Default (consensus) | Meaning |
|---|---|---|
| TIR | ≥70% | Time 70–180 mg/dL |
| TBR | <4% | Time <70 mg/dL |
| `<54` | <1% | Level-2 hypoglycemia |
| TAR | <25% | Time >180 mg/dL |
| `>250` | <5% | Level-2 hyperglycemia |
| CV | ≤36% | Glucose stability |
| GMI | <7% | Estimated A1C (no formal consensus; mirrors the A1C goal) |

### Overriding targets

Create `~/.config/glu/targets.json` and set any subset — the rest stay at the consensus
default. For example, stricter personal goals:

```json
{
  "tirMin": 80,
  "cvMax": 33,
  "gmiMax": 6.8
}
```

Keys: `tirMin`, `tbrMax`, `tbrVeryLowMax`, `tarMax`, `tarVeryHighMax`, `cvMax`, `gmiMax`.

## Trend arrows

`↓↓` falling fast · `↓` falling · `→` stable · `↑` rising · `↑↑` rising fast

## Credentials & security

- Email/password and session tokens are stored in **macOS Keychain** under the service name `glu`.
- They never touch disk in plaintext.
- Inspect them with: `security find-generic-password -s glu -a token -w`
- Wipe them with: `security delete-generic-password -s glu -a token` (and similarly for `email`, `password`, `patient-id`, `patient-name`, `account-hash`, `api-url`, `token-expires`).

## Disclaimer

This tool is **not** affiliated with, endorsed by, or supported by Abbott Laboratories. "FreeStyle Libre" and "LibreLinkUp" are trademarks of Abbott. The LibreLinkUp API is unofficial; this tool may break if Abbott changes it.

This is **not** a medical device. Do not use it to make treatment decisions. Always cross-check with your sensor and consult your healthcare provider.

## License

MIT
