# Editing `holdings.json` (no coding knowledge needed)

This file explains `holdings.json` — the file that tells the dashboard what crypto you own. You
don't need to know how to code to edit it. You just need to be careful with the punctuation,
the same way you'd be careful typing an address correctly on a form.

`holdings.json` lives in the main project folder, right next to `server.js`. It stays private —
it's never uploaded anywhere, even if the rest of the project is on GitHub.

## The big picture

Open `holdings.json` in any plain text editor (VS Code, Notepad, TextEdit — anything that doesn't
add its own formatting). You'll see something like this:

```json
{
  "minLiquidityUsd": 2000,
  "holdings": [
    { ... one coin ... },
    { ... another coin ... }
  ]
}
```

- `minLiquidityUsd` — leave this alone. It's a safety filter for small/obscure coins; you don't
  need to touch it.
- `holdings` — a list of every coin you own. Each one is wrapped in its own `{ }` block, and
  blocks are separated by commas.

## One coin, field by field

Here's a made-up example, with what each line actually means — swap in your own numbers:

```json
{
  "symbol": "ETH",
  "name": "Ethereum",
  "platform": "Binance",
  "amount": 1.5,
  "cmcId": 1027,
  "mint": null,
  "fallbackPriceUsd": null,
  "cost": { "usd": 3000 }
}
```

| Field | What to put there |
|---|---|
| `symbol` | The coin's ticker, in capital letters — e.g. `"BTC"`, `"ETH"`, `"SOL"`. |
| `name` | The coin's full name, just for display — e.g. `"Ethereum"`. |
| `platform` | Where you hold it — e.g. `"Binance"`, `"Phantom"`, `"Coinbase"`. Purely a label for you; it doesn't affect any numbers. |
| `amount` | How many coins you own. Decimals are fine, e.g. `1.5`. |
| `cmcId` | A CoinMarketCap ID number, used to look up the live price for well-known coins. See below for how to find it. If you don't have one, write `null` (no quotes). |
| `mint` | A Solana wallet address, used to look up live prices for small/meme coins that aren't on CoinMarketCap. See below. If you don't have one, write `null`. |
| `fallbackPriceUsd` | A backup price (in US dollars, per single coin) the dashboard uses if it can't find a live price any other way. Write a number, or `null` if you don't want a backup. |
| `cost` | How much you originally paid, in total, for the amount you own — used to calculate profit/loss. See below for the two ways to fill this in. |

**A coin only needs one of `cmcId` or `mint` filled in** — whichever applies. The other one, plus
anything that doesn't apply, should be `null`.

### Finding a `cmcId` (for coins listed on CoinMarketCap)

1. Go to the coin's page on [coinmarketcap.com](https://coinmarketcap.com) (e.g. search "Ethereum").
2. Look at the page's web address. It'll contain a number, or you can find the ID by searching
   "[coin name] coinmarketcap id" — for very popular coins this is easy to find.
3. Put that number in `cmcId` (no quotes around it), and leave `mint` as `null`.

### Finding a `mint` address (for small/meme coins, usually on Solana wallets like Phantom)

**Only get this from your own wallet — never from a search engine or a coin's social media.**
Lots of scam tokens copy a popular coin's name, so the only safe source is your own wallet, which
shows the coin you actually hold.

1. Open Phantom (or whichever wallet holds the coin), tap the coin, and look for its address —
   often under a "..." menu, or a link to view it on Solscan.
2. Alternatively, look up your wallet's address on [solscan.io](https://solscan.io), find the coin
   in your token list there, and copy its address from that page.
3. Paste that address into `mint`, in quotes, and leave `cmcId` as `null`.

If you can't find it yet, leave `mint` as `null` and fill in `fallbackPriceUsd` instead — the
dashboard will use that fixed price until you add the real address later.

### Filling in `cost`

This is what you originally paid, used to show your profit or loss. There are two ways to write
it, depending on how you bought the coin:

**If you paid in US dollars directly** (e.g. bought on Binance/Coinbase with a card or bank
transfer), use the simple form — just the total dollar amount you spent on this coin, added up
across every time you bought some:

```json
"cost": { "usd": 500 }
```

**If you bought it using another crypto** (e.g. swapped SOL for a meme coin in Phantom), you may
not know the exact dollar total. Use this longer form instead:

```json
"cost": {
  "solSpent": 2.5,
  "solPriceUsd": 150,
  "estimated": true,
  "date": "2025-06-01"
}
```

- `solSpent` — how much SOL you spent.
- `solPriceUsd` — what SOL was worth in dollars on the day you bought (check your wallet's
  transaction history, or search "SOL price on [date]").
- `estimated` — write `true` if `solPriceUsd` is a rough guess, or `false` once you've confirmed
  the exact price from that day.
- `date` — the date you bought, as `"YYYY-MM-DD"`.

**If you don't know or don't care what you paid**, just write:

```json
"cost": null
```

The dashboard will still show the coin's current value — it just won't show a profit/loss for it.

## Adding a brand-new coin

1. Find an existing entry in the `holdings` list to copy as a starting point.
2. Add a comma after the previous entry's closing `}`.
3. Paste your copy in, and fill in each field as described above.
4. Save the file, then double-check it's still valid by pasting the whole file into
   [jsonlint.com](https://jsonlint.com) — it'll tell you immediately if a comma or quote mark is
   missing.

The most common mistakes are: forgetting a comma between two coins, forgetting to close a quote
mark, or writing `null` in quotes (`"null"`) instead of without quotes (`null`) — these look small
but will stop the whole file from loading.

## Prompt to generate this for you

If you'd rather not hand-write the JSON, copy the prompt below into ChatGPT, Claude, or any AI
chat tool, fill in the blanks with your own information, and paste the result it gives you
straight into `holdings.json`.

```
I need a JSON entry for a file called holdings.json, in this exact format:

{
  "symbol": "TICKER",
  "name": "Full Coin Name",
  "platform": "Where I hold it",
  "amount": 0,
  "cmcId": null,
  "mint": null,
  "fallbackPriceUsd": null,
  "cost": null
}

Rules:
- Fill in "cmcId" with the coin's real CoinMarketCap ID if it's a well-known coin, otherwise leave it null.
- Fill in "mint" only if I give you a real Solana wallet address below — never invent or guess one.
- For "cost", use { "usd": <amount> } if I paid in dollars, or
  { "solSpent": <amount>, "solPriceUsd": <price that day>, "estimated": true/false, "date": "YYYY-MM-DD" }
  if I paid in SOL. Use null if I don't give you cost info.
- Output only the JSON block, nothing else, and use double quotes exactly as shown.

Here's my info:
- Coin ticker/symbol:
- Coin full name:
- Where I hold it (exchange or wallet name):
- How many I own:
- Solana mint address (only if I have one, otherwise say "none"):
- What I paid and how (dollars, or SOL amount + date bought):
```
