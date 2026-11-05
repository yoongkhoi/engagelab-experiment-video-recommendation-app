# Video validation

Purpose: keep only videos that can be played.

Activation: after each search.

Inputs: tool results.

Outputs: videos with an https URL and a non-blank title.

Rules: drop http URLs, blank titles, and ids that were not in the tool result. Do not fill missing metadata.

Failure: an empty valid list produces an honest empty reply.

Example: a result with http:// is discarded even if the title looks relevant.
