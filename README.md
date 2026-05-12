# pi-recap

Author: JNRuan

A pi extension that keeps a running recap of your conversation visible below the editor. It extracts recent context with recency bias, surfaces compaction summaries so earlier context isn't lost, and auto-refreshes on a configurable interval or on demand via `/recap`.

## Install

```bash
# Direct from git (pin to a release tag)
pi install git:github.com/JNRuan/pi-recap@v0.3.0

# Or clone and install locally
pi install ./pi-recap
```

## Usage

```
/recap                         Force-refresh the recap now
/recap on                     Enable auto-refresh
/recap off                    Disable auto-refresh
/recap model provider/model    Set the model used for recaps
/recap config                 Show current recap settings
```

## Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (per project):

```json
{
  "piRecap": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "effort": "low",
    "intervalMs": 180000,
    "wordLimit": 100
  }
}
```

| Key          | Default                      | Description                                |
| ------------ | ---------------------------- | ------------------------------------------ |
| `provider`   | _(none — uses active model)_ | Model provider for recap                   |
| `model`      | _(none — uses active model)_ | Model ID for recap                         |
| `effort`     | `"low"`                      | Reasoning effort (`low`, `medium`, `high`) |
| `intervalMs` | `180000` (3 min)             | Auto-refresh interval; `0` disables        |
| `wordLimit`  | `100`                        | Max words in the recap                     |

## CLI Flags

```
--recap-provider <name>     Provider override
--recap-model <id>          Model override
--recap-effort <level>      Reasoning effort (low | medium | high)
--recap-interval <ms>       Auto-refresh interval in ms (0 = disabled)
```

## Behavior

- **Loading:** an animated Braille spinner (⠋⠙⠹…) is shown while the recap is being generated.
- **Idle-aware:** the recap clears immediately when you start typing and reappears once the agent is idle.
- **Auto-refresh:** runs every 3 minutes while idle, or on demand with `/recap`.
- **Session resume:** automatically generates a recap when resuming or forking a session.
