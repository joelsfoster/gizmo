# Gizmo
Crypto trading bot using the CCXT library and TradingView webhooks

## How it works

First, create alerts in TradingView using your desired signals. Requires a paid TradingView account. Ensure these alerts have "webhook" checked on, and is pointing to the correct endpoint of `{webhook_url}/placeTrade`.

Then, set your environment variables:
- PORT - Required. e.g. 80. TradingView only sends webhook alerts to ports 80 and 443.
- TEST_MODE - Required. 'true' if using the exchanges testnet, 'false' if live.
- EXCHANGE - Required. e.g. 'bybit', uses [CCXT's exchange IDs](https://github.com/ccxt/ccxt/wiki/Manual).
- TICKER_BASE - Required. e.g. 'ETH', the base currency you're trading.
- TICKER_QUOTE - Required. e.g. 'USD', the quote currency you're trading.
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

- auth_id - Required. The security code needed for the webhook to be accepted.
- action - Required. The action that will be triggered.
  - short_entry - Open all shorts.
  - short_exit - Close all shorts.
  - long_entry - Open all longs.
  - long_exit - Close all longs.
  - reverse_short_to_long - Closes short positions and opens a long.
  - reverse_long_to_short - Closes long positions and opens a short.
- override - Optional. true or false. If true, will allow your webhook to be placed even if the last action was the same.
- override_ltpp - Optional. true or false. If true, if you have an open position and another entry call comes in, the new call's ltpp will replace your old position's ltpp.
- order_type - Required. "market" or "limit"
- current_direction - Optional. Turns on "activation direction" mode. Subsequent "open position" calls will only fire if they're in the same direction as the current_direction. E.g. You use the 3m chart to define the direction, then use the 1m chart to know when to open trades only in that direction.
- limit_backtrace_percent - Required if using limit orders. Percent backtrace from current price where to set the limit order. E.g. if price is $1000 and you set this value to ".05", limit order will be placed at $999.50 if you're going long or $1000.50 if you're going short
- limit_cancel_time_seconds - Required if using limit orders. Number of seconds the placed limit order has to fill, or else it will be canceled.
- ltpp - Optional. AN ARRAY OF PERCENTAGES e.g. [0.2, 0.4] = .002% and .004%. Take profit percentage using a limit order, "0.3" means an unfilled limit exit order will be placed at (current price * (1 + .3%)) if long or (current price * (1 - .3%)) if short. For each number in this array, we'll look to evenly distrubute our exits, e.g. if there are 2 numbers in the array, 50% will be exited at each target.
- mtpp - Optional. Take profit percentage using a market order, "0.3" means a take profit market exit will immediately trigger after winning .3%
- slp - Optional. Stop loss percentage, "0.3" means trigger market exit stop loss after losing .3%
- tslp - Optional. Trailing stop loss percentage, "1" means 1%, so if you enter a long at $1000 it sets a TSL at $990. When the price rises to $1010, that TSL will drag up to $999.90
- leverage - Required. What leverage you're using, "2" means 2x leverage. NEEDS TO MATCH THE SETTINGS YOU'VE MANUALLY CONFIGURED ON THE EXCHANGE.

### Using Bollinger Band activation techniques

You can send a webhook to `/bbSignal` with the following payload:

{
"auth_id": "XXXXXXXXXX",
"bb_signal": "lower_bound_breached"
}

- bb_signal - Can be "lower_bound_breached", "upper_bound_breached", "basis_breached", or "activate". If the basis is breached, it allows the next trade. If the lower bound is breached and the next trade is allowed, the next long order will fire off (same but opposite for an upper bound breach). Send "activate" to turn this mode on.  


## Current limitations

- Reversal actions will always 'market exit' active positions. If your order type is 'limit', the reversal will be a limit entry
