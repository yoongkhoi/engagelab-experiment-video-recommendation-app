# Account context

Purpose: read interests and feedback supplied by the backend.

Activation: ranking a signed-in recommendation. Not used for calculations or invalid input.

Inputs: preference names and feedback rows.

Outputs: score adjustments. No new preference is written.

Rules: guest context stays on the guest key. Do not infer interests from gender.

Failure: missing account context leaves ranking based on the current search.

Example: a food interest is used only when the request is a video recommendation.
