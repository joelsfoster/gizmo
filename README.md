# Gizmo
Crypto trading bot using the CCXT library and TradingView webhooks

## How it works

First, create alerts in TradingView using your desired signals. Requires a paid TradingView account. Ensure these alerts have "webhook" checked on, and is pointing to the correct endpoint of `{webhook_url}/placeTrade`.

Then, set your environment variables:
- PORT - Required. e.g. 80. TradingView only sends webhook alerts to ports 80 and 443.
- TEST_MODE - Required. 'true' if using the exchanges testnet, 'false' if live.
- EXCHANGE - Required. e.g. 'bybit', uses [CCXT's exchange IDs](https://github.com/ccxt/ccxt/wiki/Manual).
- TICKER_BASE - Required. e.g. 'ETH', the base currency you're trading.
- TICKER_QUOTE - Required. The quote currency you're trading. On ByBit, use 'USD' for inverse perpetuals and 'USDT' for USDT pairs.
- AUTH_ID - Required. Set a security code needed to be included in webhook payloads to be accepted.
- {EXCHANGE}_API_KEY - Required for live runs. Example: 'BYBIT_API_KEY=XXXXXXXXXXX'.
- {EXCHANGE}_API_SECRET - Required for live runs. Example: 'BYBIT_API_SECRET=XXXXXXXXXXX'
- {EXCHANGE}_TESTNET_API_KEY - Required for test runs. Example: 'BYBIT_TESTNET_API_KEY=XXXXXXXXXXX'
- {EXCHANGE}_TESTNET_API_SECRET - Required for test runs. Example: 'BYBIT_TESTNET_API_SECRET=XXXXXXXXXXX'

**You must ensure your leverage settings on the exchange match your webhooks' leverage settings!**

Once environment variables are set up, simply run the bot using `node app.js` and watch trades get placed based on your webhooks.


## TradingView webhook formatting

{
"auth_id": "XXXXXXXXXX",
"action": "reverse_long_to_short",
"order_type": "limit",
"limit_backtrace_percent": "0.05",
"limit_cancel_time_seconds": "10",
"mtpp": "0.3",
"slp": "0.3",
"leverage": "2"
}

- auth_id - Required (string). The security code needed for the webhook to be accepted.
- action - Required (string). The action that will be triggered.
  - short_entry - Open short.
  - short_exit - Close short and any open TP/SL positions.
  - long_entry - Open long.
  - long_exit - Close long and any open TP/SL positions.
  - reverse_short_to_long - Closes short position (if present) and any open TP/SL positions, and opens a long. It is recommended to use this instead of "long_entry" as it is more flexible and does the same thing even if there is no open position to reverse.
  - reverse_long_to_short - Closes long position (if present) and any open TP/SL positions, and opens a short. It is recommended to use this instead of "short_entry" as it is more flexible and does the same thing even if there is no open position to reverse.
  - set_new_tslp - Sets a new TSLP based off the current price.
- override - Optional (boolean), defaults to false. If true, will allow your webhook to be placed even if the last action was the same. Useful if you enter in the same direction multiple times.
- override_ltpp - Optional (boolean), defaults to false. If true, if you have an open position and another entry call comes in, the new call's ltpp will replace your old position's ltpp. CURRENTLY BROKEN, WILL ALWAYS BE TRUE UNTIL I FIX IT!!
- order_type - Required (string). "market" or "limit".
- trailing_limit_entry - Optional (boolean), defaults to false. When true and using limit orders, and a limit entry is placed (according to the `limit_backtrace_percent`), the bot will check every `limit_cancel_time_seconds` if the order has been filled. If not, it will recreate the order at a new price (according to `limit_backtrace_percent`) relative to the new current price. It will do this `trailing_limit_entry_attempts` times, or until 90% of your stack has been used.
- trailing_limit_entry_attempts - Optional (integer), defaults to 1 (will not retry). Number of times a `trailing_limit_entry` will retry until it fills.
- limit_backtrace_percent - Required (string) if using limit orders. Percent backtrace from current price where to set the limit order. E.g. if price is currently $1000 and you set this value to ".05", limit order will be placed at $999.50 if you're going long or $1000.50 if you're going short.
- limit_cancel_time_seconds - Required (string) if using limit orders. Number of seconds the placed limit order has to fill, or else it will be canceled. When using `trailing_limit_entry`, this denotes the time the bot will wait to fill an open limit order before cancelling it and recreating it at a price closer to the current price.
- ltpp - Optional (array of floats). An array of percentages e.g. [0.2, 0.4] = .002% and .004%. Take profit percentage using a limit order, "0.3" means an unfilled limit exit order will be placed at (current price * (1 + .3%)) if long or (current price * (1 - .3%)) if short. For each number in this array, an exit target will be placed using evenly distributed portions of your position, e.g. if there are 2 numbers in the array, 50% will be exited at each target.
- mtpp - Optional (string). Take profit percentage using a market order, "0.3" means a take profit market exit will immediately trigger after winning .3%. Inferior to `ltpp` because this kind of exit incurs fees and can result in slippage.
- slp - Optional (string). Stop loss percentage, "0.3" means trigger a market exit stop loss after losing .3%.
- tslp - Optional (string). Trailing stop loss percentage, "1" means 1%, so if you enter a long at $1000 it sets a TSL at $990. When the price rises to $1012, that TSL will drag up to $1002.
- leverage - Required (string). What leverage you're using, "2" means 2x leverage. *NEEDS TO MATCH THE LEVERAGE SETTINGS YOU'VE MANUALLY CONFIGURED ON THE EXCHANGE.*


## IMPORTANT! Current limitations

- Reversal actions will always 'market exit' active positions. If your order type is 'limit', the reversal entry will be a limit entry
- Due to a bug in the CCXT library, limit entries do not work with USDT pairs! They only work with inverse pairs.
- When using USDT pairs on ByBit, due to a bug in the CCXT library, currently only these USDT pairs are available:

BTC/USDT
ETH/USDT
LINK/USDT
BCH/USDT
LTC/USDT
XTZ/USDT

These are not working:
BNB/USDT
ADA/USDT
DOGE/USDT
XRP/USDT
DOT/USDT
UNI/USDT
SOL/USDT
MATIC/USDT
ETC/USDT
FIL/USDT
EOS/USDT
AAVE/USDT
SUSHI/USDT
XEM/USDT
