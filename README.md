# pi-recap

Author: JNRuan

A Pi extension that keeps a task-oriented Recap of the recent conversation visible above the editor. It uses recent visible messages and compaction summaries to restore task continuity, with manual refresh and optional Auto Recap after an Idle Delay.

Requires Pi 0.80.10 or newer.

## Install

```bash
# Direct from git (optionally pin to a release tag)
pi install git:github.com/JNRuan/pi-recap

# Or clone and install locally
pi install ./pi-recap
```

## Usage

```text
/recap                                Refresh the Recap now
/recap settings                       Open staged interactive settings
/recap auto on|off                    Enable or disable Auto Recap
/recap model provider/model|none      Set or clear the Recap Model
/recap thinking level                 Set the Recap Thinking Level
/recap delay seconds                  Set the positive Idle Delay
/recap messages count                 Set Recent Messages
/recap words count                    Set Maximum Words
/recap config                         Show the effective global configuration
```

`/recap settings` opens a TUI menu for Recap Model, Recap Thinking Level, Auto Recap, Idle Delay, Recent Messages, and Maximum Words. Changes remain in a draft until Save; Escape discards them. Typed setters persist immediately and remain available outside TUI mode.

## Configuration

Configuration is read only from the global `piRecap` object in `~/.pi/agent/settings.json`. Project-local `piRecap` settings are ignored.

```json
{
  "piRecap": {
    "recapModel": null,
    "thinkingLevel": "low",
    "autoRecapEnabled": true,
    "idleDelaySeconds": 300,
    "wordLimit": 100,
    "recentMessageLimit": 20
  }
}
```

| Key                  | Default | Description                                                                     |
| -------------------- | ------- | ------------------------------------------------------------------------------- |
| `recapModel`         | `null`  | Recap Model as `{ "provider": "...", "id": "..." }`, or `null`                  |
| `thinkingLevel`      | `"low"` | Recap Thinking Level: `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max` |
| `autoRecapEnabled`   | `true`  | Whether inactivity can trigger Auto Recap                                       |
| `idleDelaySeconds`   | `300`   | Positive Idle Delay before Auto Recap                                           |
| `wordLimit`          | `100`   | Maximum Words in generated Recaps                                               |
| `recentMessageLimit` | `20`    | Recent visible user and assistant messages used for a Recap                     |

Existing global `provider`, `model`, and `intervalSeconds` values are migrated when settings are next saved. A legacy delay of `0` disables Auto Recap while retaining the default 300-second Idle Delay. The obsolete `effort` field is dropped, and new saves normalize `piRecap` to the schema above.

## Breaking changes in 0.5.0

- The `--recap-*` CLI flags have been removed. Use the global settings, `/recap settings`, or the typed setters above.
- `/recap on` and `/recap off` are now `/recap auto on` and `/recap auto off`.
- `/recap interval` is now `/recap delay`, and `/recap recent` is now `/recap messages`.
- The legacy `effort` key is no longer read. Use `thinkingLevel`.
- Every successful save normalizes `piRecap` to the six documented keys and drops unknown or obsolete keys.

## Behavior

- **Independent model:** the Recap Model and Recap Thinking Level do not change Pi's active model or thinking level.
- **Idle-aware:** Auto Recap requires uninterrupted inactivity for the full Idle Delay. Disabling Auto Recap preserves that delay.
- **Task-oriented:** newer explicit task state takes priority, while older and compacted context remains background.
- **Safe default:** no model call or startup warning occurs while the Recap Model is `null`; manual `/recap` explains that a model must be configured.
- **Shared generation:** manual refresh, session resume or fork, compaction, and Auto Recap use the same validation and generation path.
- **Failure behavior:** failed refreshes leave the previous successful Recap visible and report relevant manual-generation errors.
