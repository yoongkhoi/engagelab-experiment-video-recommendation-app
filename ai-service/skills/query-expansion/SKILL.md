# Query expansion

Purpose: turn a topic into short Pixabay search phrases.

Activation: when a video search is planned.

Inputs: the user message, prior user messages when the current request is vague, and model keywords.

Outputs: at most four distinct phrases. Formula 1 maps to Formula 1 racing and Formula One race cars.

Rules: keep the user's topic. Do not expand a calculation or a general question into a search.

Failure: if no phrase is available, do not search.

Example: "I like F1" followed by "Find me some videos" uses the earlier Formula 1 topic.
