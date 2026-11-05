# Video discovery

Purpose: retrieve playable Pixabay videos for a video request.

Activation: VIDEO_SEARCH and VIDEO_REFINEMENT only.

Inputs: the resolved search phrases and the requested limit.

Outputs: videos returned by the search tool. No invented ids, titles, or URLs.

Rules: at most three searches. Skip a repeated query. Do not replace an empty result with an unrelated query.

Failure: say that Pixabay did not return a playable video and mention the phrases that were tried.

Example: "Find relaxing nature videos" searches the nature phrase returned for that request.
