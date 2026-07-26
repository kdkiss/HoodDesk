# HoodDesk AI Analyst TODO

## Completed MVP

- [x] Add session-only AI provider settings for NVIDIA, OpenRouter, OpenAI,
  and Anthropic.
- [x] Keep the user's API key out of Git, logs, and server-side persistence.
- [x] Add a bounded `/api/analyst` proxy that returns structured sections.
- [x] Add token and portfolio analyst panels.
- [x] Ground output in supplied onchain data and label gaps clearly.

## Safety rules

- No financial advice language such as "buy", "sell now", "safe", "guaranteed", or price predictions.
- No fabricated prices, balances, audits, partnerships, or token metadata.
- If required data is missing, the analyst must say what is missing.
- Provider errors must not echo API keys or raw request headers.

## Later

- [x] Add portfolio analyst summaries.
- [ ] Add order explanation summaries before order submission.
- [ ] Add watchlist comparison.
- [ ] Add optional chat once structured summaries prove useful.
