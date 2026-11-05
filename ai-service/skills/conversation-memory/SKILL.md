# Conversation memory

Purpose: resolve follow-up requests inside one conversation.

Activation: VIDEO_REFINEMENT and vague requests such as "find me some videos".

Inputs: recent user and assistant messages for this conversation id only.

Outputs: a topic or preference used for this reply. It is not saved as an account interest.

Rules: do not copy a guest conversation onto an account. A new conversation starts without the previous summary.

Failure: if the history has no topic, ask what kind of video the user wants instead of searching a generic catalog.

Example: "I prefer shorter videos" can lower the duration limit later in the same conversation.
