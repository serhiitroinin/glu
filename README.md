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

── Targets (personal) ───────────────
  TIR ≥80%:  ✓ PASS
  TBR <5%:   ✓ PASS
  CV <33%:   ✓ PASS
  GMI <6.8%: ✓ PASS
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
   glu setup your@email.com YourLibreLinkUpPassword
   glu login
   ```

   Credentials are written to macOS Keychain (service: `glu`). The login flow handles regional API redirects (eg `api-eu`, `api-us`) and patient discovery automatically.

## Commands

### Auth

| Command | Description |
|---|---|
| `glu setup <email> <password>` | Save LibreLinkUp credentials |
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

These are **personal targets** — deliberately stricter than the published clinical
consensus. They are not the [2019 international consensus on time in
range](https://care.diabetesjournals.org/content/42/8/1593), which recommends, for most
non-pregnant adults, TIR >70%, TBR <4% (<1% below 54 mg/dL), TAR <25%, and CV ≤36%.

| Metric | Personal target | Meaning |
|---|---|---|
| TIR | ≥80% | Time 70–180 mg/dL |
| TBR | <5% | Time <70 mg/dL |
| CV | <33% | Glucose stability |
| GMI | <6.8% | Estimated A1C |

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
