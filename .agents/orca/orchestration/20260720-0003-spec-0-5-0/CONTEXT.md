# Recap

A recap restores task continuity when someone returns to a Pi coding session.

## Language

**Recap**:
A high-level, recency-weighted account of completed work, the current goal and state, relevant decisions or unresolved points, and next steps. It restores task continuity rather than reproducing the conversation.
_Avoid_: Status report, conversation transcript

**Recap Model**:
The model selected specifically to produce recaps, independent of Pi’s active session model. It may be unconfigured, in which case no Recap can be generated.
_Avoid_: Active model, session model

**Recap Thinking Level**:
The preferred reasoning depth for the Recap Model, independent of Pi’s active session thinking level. It may be stored before a Recap Model is selected.
_Avoid_: Effort, session thinking level

**Effective Recap Thinking Level**:
The model-supported reasoning depth used for generation after the Recap Thinking Level is validated against the selected Recap Model.
_Avoid_: Requested effort

**Auto Recap**:
A Recap generated after inactivity when automatic generation is enabled. Manual recaps remain available when Auto Recap is disabled.
_Avoid_: Polling recap, interval recap

**Idle Delay**:
The uninterrupted inactivity period required before an Auto Recap begins.
_Avoid_: Interval, refresh rate
