# Fix 07 — atomic crew bill settlement

## Problem

The Crew Terminal's bulk **Mark paid** action updated the crew bill, bank-account balance, and bank-transaction ledger in separate requests. A second browser could settle the same pending bill before the first one completed, and any later request failure could leave the three records inconsistent.

## Change

Each selected bill is now settled in one Firestore transaction. The transaction reads the current bill, target account, and a deterministic settlement-ledger document before it writes. It rejects a bill that is no longer pending, whose details changed while the list was open, whose target account is missing, or which already has a settlement movement.

The transaction then marks the bill paid, debits the account, and creates the ledger entry together. Failed bills remain pending and the UI reports their bill numbers and reasons. Only successfully settled bills trigger the derived expense-snapshot rebuild.

## Validation

- `npm run lint`
- `npm run build`
- `git diff --check`

No live bill was settled for testing, so no business record or bank balance was changed during verification.
