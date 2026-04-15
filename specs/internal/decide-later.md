# Decide Later

Decisions deferred during spec cleanup. Revisit when real usage data or implementation context is available.

## Stop-Loss Thresholds (Repair)

Spec: `control-plane/verification-remediation-and-actual-cost-accounting.md`

- [x] Max repair attempts: `100` (locked)
- [ ] Max elapsed repair time — how long (hours/days) can same-scope repair continue before forcing founder decision?
- [ ] Max internal remediation cost — dollar cap on hidden platform cost before stopping silent repair?
- [ ] Non-idempotent side-effect acceleration — how should repeated risky side effects (e.g. duplicate emails, duplicate deploys) accelerate stop-loss?

## Ads Billing

- [ ] Ads deposit minimum amount — what is the minimum founder deposit for ads?
- [ ] Ads balance low-threshold warning — at what balance should the founder be warned?
- [ ] Ads payout/refund policy — can founders withdraw unused ad balance?

## Revenue Fee

Spec: `billing/internal-ledgers-and-unit-economics.md`

- [x] Platform fee on company customer revenue: `15%` (locked)
- [x] Platform fee on ads deposits: `20%` (locked)
- [ ] Per-plan-tier fee adjustments — will higher subscription tiers get lower revenue fees?

## Credit Model

- [ ] Credit expiration policy — do monthly credits expire at the end of the billing cycle or roll over?
- [ ] Credit purchase packs — will founders be able to buy additional credit packs? What sizes/pricing?

## Night Shift

- [ ] Night shift timing — what time zone / hour does the nightly tick fire?
- [ ] Night shift skip notification — should the founder be notified when night shift skips (no appropriate task)?

## Verification

- [ ] Verification timeout — how long can a verification check run before it's considered failed?
- [ ] Human review trigger — under what conditions does a task escalate to human review?

## Keep-Live

- [ ] Keep-live pricing — exact monthly cost for keep-live hosting-only plan?
- [ ] Keep-live included services — any execution allowance or strictly hosting-only?

## Multi-Company

- [ ] Max companies per founder — is there a limit?
- [ ] Night shift fairness algorithm — exact round-robin vs weighted distribution across companies?
