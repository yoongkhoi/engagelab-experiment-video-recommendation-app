# Intent understanding

Purpose: decide whether the user wants a video, a calculation, an image, a general answer, a follow-up, or a clarification.

Activation: every request, before any tool call.

Inputs: the current message and a short conversation history.

Outputs: one intent: VIDEO_SEARCH, IMAGE_REQUEST, GENERAL_QUESTION, CALCULATION, VIDEO_REFINEMENT, CLARIFICATION, INVALID_INPUT, or UNSUPPORTED_REQUEST.

Rules: topics such as Formula 1, nature, food, movies, travel, sports, and technology are search subjects, not intents. Do not search Pixabay for arithmetic, ordinary questions, or text that has no recognizable request.

Failure: if the message is ambiguous, ask the model once. Do not guess a video query.

Example: "Find me F1 videos" is VIDEO_SEARCH. "1+1-1=?" is CALCULATION. "abcdefgh" is INVALID_INPUT.
