# pi-recap

Author: JNRuan

A pi extension that keeps a running recap of your conversation visible below the editor. It extracts recent context with recency bias, surfaces compaction summaries so earlier context isn't lost, and auto-refreshes on a configurable interval or on demand via `/recap`.

## Install

```bash
pi install ./pi-recap
```

## Usage

```
/recap                         Refresh the recap now
/recap provider/model           Override provider/model for one run
/recap config                   Show current recap settings
```

## Settings

Add to `~/.pi/agent/settings.json` (global) or `.pi/settings.json` (per project):

```json
{
  "piRecap": {
    "provider": "anthropic",
    "model": "claude-sonnet-4-20250514",
    "effort": "low",
    "intervalMs": 300000,
    "wordLimit": 50
  }
}
```

## CLI Flags

```
--recap-provider <name>     Provider override
--recap-model <id>          Model override
--recap-effort <level>      Reasoning effort (low | medium | high)
--recap-interval <ms>       Auto-refresh interval in ms (0 = disabled)
```
