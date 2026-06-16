# pi-recap

Author: JNRuan

A pi extension that keeps a running recap of your conversation visible above the editor. It extracts recent context with recency bias, surfaces compaction summaries so earlier context isn't lost, and auto-refreshes on a configurable interval or on demand via `/recap`.

## Install

```bash
# Direct from git (optionally pin to a release tag)
pi install git:github.com/JNRuan/pi-recap

# Or clone and install locally
pi install ./pi-recap
```

## Usage

```
/recap                         Force-refresh the recap now
/recap on                     Enable auto-refresh
/recap off                    Disable auto-refresh
/recap model provider/model    Set the model used for recaps
/recap messages 20            Set how many recent messages to summarize
/recap config                 Show current recap settings
```

## Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (per project):

```json
{
  "piRecap": {
    "provider": "",
    "model": "",
    "effort": "low",
    "intervalMs": 300000,
    "wordLimit": 100,
    "recentMessageLimit": 20
  }
}
```

| Key                  | Default          | Description                                         |
| -------------------- | ---------------- | --------------------------------------------------- |
| `provider`           | `""`             | Model provider for recap                            |
| `model`              | `""`             | Model ID for recap                                  |
| `effort`             | `"low"`          | Reasoning effort (`low`, `medium`, `high`)          |
| `intervalMs`         | `300000` (5 min) | Auto-refresh interval; `0` disables                 |
| `wordLimit`          | `100`            | Max words in the recap                              |
| `recentMessageLimit` | `20`             | Recent visible user/assistant messages to summarize |

## Behavior

- **Loading:** an animated Braille spinner (⠋⠙⠹…) is shown while the recap is being generated.
- **Idle-aware:** the recap clears when a new prompt or turn starts and reappears after the configured idle delay.
- **Task-oriented:** the recap focuses on the recent high-level task/current state and next useful step from the last 20 visible messages by default, not file lists or tool-call logs.
- **Setup warning:** if `provider` or `model` is unset, pi-recap warns on load and waits for `/recap model provider/model`.
- **Auto-refresh:** runs after 5 minutes of continuous idle time, or on demand with `/recap`.
- **Session resume:** automatically generates a recap when resuming or forking a session once a model is configured.
