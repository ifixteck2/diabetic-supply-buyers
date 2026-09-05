# ChatGPT Online Orders API Instructions

Use this to add profits, expenses, bills, and monthly settings to the Online Orders portal.

## Verify the GPT Connection

Import the current schema from `https://selldiabetics.com/online-orders-openapi.json` into the GPT's existing Action and keep its API Key / Bearer authentication. No extra routing header is needed for Bearer-token requests.

Run `checkTrackerConnection` first. It must return `ok: true` and `portal: "online_orders"`. Then run `getMonthlyTracker` for the desired month and `getBills`. Only report a save after the write action returns `ok: true`; read the updated records afterward to confirm. Never claim a connection is verified from an unauthenticated 401 response.

Monthly settings updates preserve fields that were not supplied. Full bill payments use the business date in America/New_York; partial-payment actions support an explicit payment date. Existing tracker and bill action names remain compatible.

For local database regression checks, install `@electric-sql/pglite` in a temporary directory, set `PGLITE_TEST_MODULE` to its `dist/index.js`, and run `node --test scripts/tracker-api-postgres.test.js`. These tests exercise the server's actual SQL and authentication middleware using disposable in-memory PostgreSQL tables, never production records.

## Financial Reporting and Corrections

`GET /api/online-monthly-tracker?month=2026-09&history_months=6` returns selected-month `entries`, `settings`, and `history_entries` covering six reporting months. History accepts 1 to 12 months.

`PATCH /api/online-monthly-tracker/{id}` corrects a tracker entry. Send only fields that should change, for example `{"amount":19.72,"category":"Food","description":"Taco Bell"}`. Supported fields match tracker entries, including date and reporting month.

Phone Profit is net of the phone's purchase cost. Entry amounts are totals for the stated quantity. Cash In is not phone profit. Cash Out is separate from expenses. Bill payments are counted from their payment dates and must not also be entered as tracker expenses. The ledger's running total is monthly net movement, not a bank balance. Original long-term commitments are reduced only by payments recorded against those bills; no interest or unrecorded payments are assumed. A monthly bill flag describes frequency; it does not create future installments automatically.

Base URL:
`https://www.selldiabetics.com`

Authentication:
Every request must include this header:

```http
Authorization: Bearer YOUR_ONLINE_ORDERS_API_TOKEN
Content-Type: application/json
```

Do not use the website username/password in ChatGPT. Use only the API token.

## Add Profit

Use this when Mike says something like:
`Made $300 on 2 iPhones from Miami`

```http
POST /api/online-monthly-tracker
```

```json
{
  "month": "2026-09",
  "entry_type": "Phone Profit",
  "entry_date": "2026-09-02",
  "category": "Phone Profit",
  "source": "Miami",
  "phone_model": "iPhone",
  "quantity": 2,
  "amount": 300,
  "description": "Made $300 on 2 iPhones from Miami",
  "notes": ""
}
```

## Add Expense

Use this when Mike says something like:
`Spent $50.44 on Popeyes`

```http
POST /api/online-monthly-tracker
```

```json
{
  "month": "2026-09",
  "entry_type": "Expense",
  "entry_date": "2026-09-02",
  "category": "Food",
  "source": "Popeyes",
  "phone_model": "",
  "quantity": 1,
  "amount": 50.44,
  "description": "Popeyes",
  "notes": ""
}
```

Valid tracker `entry_type` values:
- `Phone Profit`
- `Expense`
- `Cash In`
- `Cash Out`

Rules:
- Always send positive numbers for `amount`.
- The website adds `Phone Profit` and `Cash In`.
- The website subtracts `Expense`, `Cash Out`, and bills marked `Paid`.

## Add Bill

Use this when Mike remembers a bill or a new bill comes in.

```http
POST /api/online-payables
```

```json
{
  "title": "Rent",
  "amount": 2950,
  "due_date": "2026-09-01",
  "category": "Rent",
  "payment_method": "",
  "is_monthly": true,
  "long_term_months": 0,
  "long_term_balance": 0,
  "notes": "Monthly rent"
}
```

## Add Long-Term Balance Bill

```http
POST /api/online-payables
```

```json
{
  "title": "Jose Ordoñez",
  "amount": 10000,
  "due_date": "2026-09-01",
  "category": "Long-Term Balance",
  "payment_method": "",
  "is_monthly": true,
  "long_term_months": 18,
  "long_term_balance": 180000,
  "notes": "Monthly for 18 months"
}
```

## Get Bills

```http
GET /api/online-payables
```

## Mark Bill Paid

```http
PATCH /api/online-payables/BILL_ID/status
```

```json
{
  "status": "Paid"
}
```

When a bill is marked `Paid`, the website deducts it from Monthly Tracker cash flow.

## Add Partial Bill Payment

Use this when Mike says something like:
`Paid $500 toward Jose Ordoñez`

First call `GET /api/online-payables` to find the matching bill ID, then call:

```http
POST /api/online-payables/BILL_ID/payments
```

```json
{
  "amount": 500,
  "payment_date": "2026-09-04",
  "payment_method": "Cash",
  "notes": "Partial payment toward Jose Ordoñez"
}
```

The website adds this to the bill's paid amount and deducts it from Monthly Tracker cash flow. If the total paid reaches the bill amount, the bill becomes `Paid` automatically.

## Mark Bill Unpaid

```http
PATCH /api/online-payables/BILL_ID/status
```

```json
{
  "status": "Unpaid"
}
```

## Delete Bill

```http
DELETE /api/online-payables/BILL_ID
```

## Get Monthly Tracker

```http
GET /api/online-monthly-tracker?month=2026-09
```

## Update Monthly Plan

```http
PATCH /api/online-monthly-tracker/settings
```

```json
{
  "month": "2026-09",
  "monthly_budget": 21150,
  "food_budget": 800,
  "notes": "September 2026 plan"
}
```

## Delete Tracker Entry

```http
DELETE /api/online-monthly-tracker/ENTRY_ID
```

## Custom GPT Action Schema

Import this OpenAPI schema into a Custom GPT Action:

`https://www.selldiabetics.com/online-orders-openapi.json`

Set authentication as API Key:
- Auth type: API Key
- Header name: `Authorization`
- Value: `Bearer YOUR_ONLINE_ORDERS_API_TOKEN`
