# Takken Drill for Business

**AI judges study effort. A person approves. PayPal pays employees directly.**

Real-estate companies in Japan must have at least one licensed *Takken* (宅地建物取引士) holder for every five employees, and only licensed staff may explain key contract terms to customers. Companies therefore pay their employees' exam fees and course costs — yet in 2025 only 18.7% of 245,462 candidates passed, and most company-funded candidates never seriously studied.

Takken Drill for Business changes the deal:

- Employees who **study genuinely** get the exam fee reimbursed, **pass or fail**.
- Employees who **pass** get a bonus.
- Employees who did not study pay the fee themselves.

An AI reads each employee's study log and proposes who gets what, with written reasons. An HR admin approves with one click, and the money goes **straight from the company's PayPal Business account to the employee's PayPal**. The app never holds the money.

## For judges: try the live demo

**Live demo:** https://takken-drill-business.shihovjk.workers.dev (real Claude API, PayPal **sandbox**; all people are fictional). Switch the language with **EN** in the header.

| Role | Email | Password |
|---|---|---|
| HR admin | `admin@demo.takken-drill.com` | `demoiijyan` |
| Employee A (Misaki Suzuki: studied genuinely, passed) | `e02@demo.takken-drill.com` | same |
| Employee B (Kenta Sato: memorized answers) | `e01@demo.takken-drill.com` | same |

What to try:

1. **Admin:** press **Judge with AI**. Claude reads 25 employees' study logs and returns an effort score, pass chance, flags and a proposed award for each, plus a company report.
2. **Admin:** open an employee row in the grid (AG Grid) to read the AI's reasons. Then **Approve & pay with PayPal**, **Edit amount**, **Send follow-up** or **Confirm self-pay**.
3. **Admin:** after paying, the status changes when PayPal's payout webhook arrives. The payout goes to a sandbox personal account.
4. **Employee:** study in the drill. Every answer is recorded and feeds the next judgement. The **支給 (Award)** tab shows the confirmed award, the AI's reasons, and **Log in with PayPal** to register where money is received.

Notes:

- The demo study log is moved to "now" every day, so the 8-week window always has data.
- The AI runs only when the button is pressed, and at most 20 times a day for the demo company. If the limit is reached, try again the next day (JST).
- To run everything locally without any account, see [Offline demo](#offline-demo-no-accounts-needed).

## What the AI actually does (at runtime)

The only inputs are **accuracy** and **seconds per question**, over the last 8 weeks. Rules on those numbers are easy to game; the AI judges the *combination* and the *change over time*:

| Pattern | Accuracy | Sec / question | What a time-only rule says | What the AI says |
|---|---|---|---|---|
| Memorized answers | 88% | 9 s | Pay (703 min studied) | Follow up: reading a 4-choice question takes over a minute |
| Clicking through | 35% | 10 s | Pay (692 min studied) | Follow up: close to random guessing (25%) |
| Last-minute spike | 61% | 59 s | Don't pay (237 min) | Follow up, with the reason: 7 quiet weeks, then a burst in the last week |
| Genuine study | 70–80% | 70–110 s | Pay | Pay, with the improvement trend in the reason |

- **Per-employee judgement:** Claude (`claude-haiku-4-5` by default) returns structured JSON: effort score, pass probability, flags with evidence, a recommendation, proposed amounts, and reasons in Japanese and English ([`supabase/functions/_shared/ai.ts`](supabase/functions/_shared/ai.ts)).
- **Company report:** a second call summarizes the whole company and lists who needs a follow-up. Only pseudonymous references are sent to the AI; no names.
- **Guard rails:**
  - The server clamps every AI amount to the company's award rules ([`award.ts`](supabase/functions/_shared/core/award.ts)).
  - If the AI fails, the award waits for a human.
  - Employees see the AI's reasons only after an admin confirms their award.
- **Cost control:**
  - The AI runs only when the admin presses **Judge with AI**.
  - Identical input reuses the stored result instead of calling the API (hash cache).
  - There is a daily cap per company, and the cheapest current model is the default.

## How PayPal is used (sandbox)

| Purpose | PayPal API |
|---|---|
| Company → employee awards | **Payouts API**, sent from the company's own PayPal Business app. `sender_batch_id` prevents double payment |
| Payout results | **Webhooks**, registered automatically on the company's app, verified with `verify-webhook-signature` and handled once |
| Employee's receiving account | **Log in with PayPal**. Payouts go to the verified PayPal ID (`recipient_type: PAYPAL_ID`), not a typed email |
| The company's monthly fee for the app | **Subscriptions API** + JS SDK subscription button + `BILLING.SUBSCRIPTION.*` webhooks |

Payment methods are swappable ([`supabase/functions/_shared/payout/`](supabase/functions/_shared/payout/)):

- The approval flow (AI proposal → admin confirms) never depends on how money is sent.
- `payroll_csv` exports approved awards for a payroll system instead. In Japan, such awards may be taxable as salary.
- A bank-transfer provider can be added the same way.

## Architecture

```
React + TypeScript + AG Grid (Vite, Cloudflare Workers static assets)
   │  Supabase Auth (email + password, invitations)
   │  Postgres with row-level security (company isolation, consent before any answer is recorded)
   ▼
Supabase Edge Functions (Deno)
   dashboard        accuracy & speed per employee (shared code with the AI)
   evaluate         Claude: per-employee judgement + company report
   awards           confirm / edit / self-pay / exam result / follow-up message
   payout           PayoutProvider: PayPal Payouts or payroll CSV
   paypal-webhook   payout + subscription events
   paypal-connect   company connects its own PayPal app (secret stored AES-GCM encrypted)
   paypal-identity  Log in with PayPal for employees
   subscription     monthly fee (PayPal Subscriptions)
   invite           invite employees
   demo-refresh     keeps the public demo current
```

Pure logic shared by the browser and the functions lives in [`supabase/functions/_shared/core`](supabase/functions/_shared/core):

- accuracy and speed metrics
- exam constants and the pass-pace diagnosis
- award clamping
- today's tasks for employees

### Employee study app

Employees study in the full takken-drill.com study app (drill, review, schedule, stats, mock exams), served from [`public/study/`](public/study/) inside the employee screen.

- [`scripts/import-study-app.py`](scripts/import-study-app.py) copies it from the takken-drill.com source and removes ads, plans and login. Run `python3 scripts/import-study-app.py <path to prototype>`.
- [`public/study/bridge.js`](public/study/bridge.js) reports every answer to the surrounding app, which records it in `attempts`.
- Each answer has a `mode`: `four` (timed 4-choice drill), `ox` (one true/false statement) or `mock` (mock exam, no per-question time). Only `four` answers count for seconds per question; `ox` answers do not count for accuracy.

## Try it

### Offline demo (no accounts needed)

```bash
npm install
npm run dev   # http://localhost:5180
```

- With no Supabase settings, the app runs entirely in the browser with 25 fictional employees.
- AI results are pre-written samples, labelled **Sample result**, and PayPal is simulated.

### Full setup (real AI + PayPal sandbox)

1. **Supabase project.** Create one, then run `supabase link` and `supabase db push`. This applies [`supabase/migrations`](supabase/migrations).
2. **Edge Function secrets.** Copy [`supabase/functions/.env.example`](supabase/functions/.env.example) to `supabase/functions/.env`, fill it in, then run `supabase secrets set --env-file supabase/functions/.env`.
3. **Deploy the functions.** Run `supabase functions deploy`. `paypal-webhook` and `demo-refresh` run without JWT verification (see [`supabase/config.toml`](supabase/config.toml)).
4. **PayPal sandbox** ([developer.paypal.com](https://developer.paypal.com)):
   - **This app's REST app:** enable *Log in with PayPal* (email + PayPal account ID). Create a product and a monthly plan, and set `PAYPAL_PLAN_ID`. Add a webhook to `…/functions/v1/paypal-webhook` for `BILLING.SUBSCRIPTION.*` and `PAYMENT.SALE.COMPLETED`, and set `PAYPAL_WEBHOOK_ID`.
   - **The company's REST app:** this can be a second sandbox business account with *Payouts* enabled. Enter its client ID and secret in the app under **PayPal**. The payout webhook is registered automatically.
5. **Demo data.** Copy `.env.example` to `.env`, fill it in, and run `node scripts/seed.ts --supabase`. `DEMO_PAYEE_EMAIL` is a sandbox *personal* account that receives the demo payouts.
6. **Frontend.** Set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_PAYPAL_CLIENT_ID`, then run `npm run build` and deploy `dist/` as static files (the live demo uses Cloudflare Workers connected to this repository; build command `npm run build`, output `dist`, `NODE_VERSION=22`).

### Tests

```bash
npm test            # metrics, exam rules, award clamping
npx tsc -b          # frontend types
cd supabase/functions && npx deno check */index.ts
```

## Data and privacy

- **Exam questions:** the practice questions are the authors' own original questions ([`src/data/questions.json`](src/data/questions.json)), based on laws as of October 2026. No past exam questions are included in this repository; the study app loads them, and mock exams 2–5, from takken-drill.com when it opens.
- **Demo people:** all employees in the demo are fictional ([`scripts/seed.ts`](scripts/seed.ts)).
- **Consent:** employees must consent before any answer is recorded, and can see the AI's reasoning about them.

## Sources

- Real Estate Transaction Improvement Organization (RETIO), *Results of the 2025 (Reiwa 7) Takken exam*: 245,462 candidates, 18.7% pass rate, ¥8,200 exam fee.

## License

[MIT](LICENSE)
