# Recommendation personalization

Purpose: order retrieved videos using saved interests, favorites, and feedback when the backend supplies them.

Activation: after validation, only for video results.

Inputs: preferences and feedback sent with the request.

Outputs: a ranked subset. Negative feedback removes or lowers a video.

Rules: do not treat a sentence in chat as a permanent account preference. Do not use gender.

Failure: if preferences are empty, rank from the search match alone.

Example: a nature preference raises a nature result above an unrelated result.
