# Keep recap inference settings independent

Recaps use a dedicated, globally persisted Recap Model and Recap Thinking Level rather than inheriting Pi’s active session values. Recap generation is a separate background-oriented task whose cost, latency, and output should remain predictable when a user changes the model or thinking level used for the interactive coding session; global-only persistence also avoids the same session recapping differently across projects.
