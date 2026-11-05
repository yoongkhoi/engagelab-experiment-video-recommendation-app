# Response formatting

Purpose: write a short conversational reply.

Activation: after the agent decides to answer or after videos are ranked.

Inputs: the intent, the queries tried, and the validated videos.

Outputs: one or two sentences and follow-up suggestions based on those queries. No chain-of-thought and no raw tag list.

Rules: the sentence names the search only. Do not list video titles. Do not claim a video exists when the list is empty.

Failure: use a plain sentence that the search did not return a playable video.

Example: "I found these on Pixabay for Formula 1 racing." The playable cards are separate. Do not list titles in the sentence. For an image request, answer "No, I can only recommend videos."
