//
// ~~~ Gizmo ~~~
// ~~~ Original creator https://github.com/joelsfoster/ ~~~
// ~~~ Please use with permission, always happy to see you succeed! ~~~
//

const express = require('express')
const bodyParser = require('body-parser')
const ccxt = require ('ccxt')
const dotenv = require('dotenv')

//
// === Setup, config, and exchange initialization ===
//

// Use .env file for private keys
dotenv.config()

// Start app with bodyParser
const app = express().use(bodyParser.json())
const PORT = process.env.PORT

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

// Ensure all TradingView webhooks contain the AUTH_ID to authorize trades to be made
const AUTH_ID = process.env.AUTH_ID

// Set the exchange according to the CCXT ID https://github.com/ccxt/ccxt/wiki/Manual
const EXCHANGE = process.env.EXCHANGE
const TICKER_BASE = process.env.TICKER_BASE
const TICKER_QUOTE = process.env.TICKER_QUOTE
const TICKER = TICKER_BASE + '/' + TICKER_QUOTE
const TEST_MODE = process.env.TEST_MODE == 'false' ? false : true
const EXCHANGE_TESTNET_API_KEY = process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_KEY']
const EXCHANGE_TESTNET_API_SECRET = process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_SECRET']
const EXCHANGE_LIVE_API_KEY = process.env[EXCHANGE.toUpperCase() + '_API_KEY']
const EXCHANGE_LIVE_API_SECRET = process.env[EXCHANGE.toUpperCase() + '_API_SECRET']
const apiKey = TEST_MODE ? EXCHANGE_TESTNET_API_KEY : EXCHANGE_LIVE_API_KEY
const apiSecret = TEST_MODE ? EXCHANGE_TESTNET_API_SECRET : EXCHANGE_LIVE_API_SECRET

// Instantiate the exchange
const exchange = new ccxt[EXCHANGE.toLowerCase()] ({
  apiKey: apiKey,
  secret: apiSecret
})

// Handle authentication in test mode
if (TEST_MODE) {
  exchange.urls['api'] = exchange.urls['test']
  console.log("Currently TESTING at", exchange.urls['test'])
} else {
  console.log("Currently LIVE at", exchange.urls['api'])
}


//
// === Webhooks ===
//

// Catch the webhook and handle the trade
app.post("/placeTrade", (req, res) => {
  handleTrade(req, res)
})

// Checks first to see if the webhook carries a valid safety ID
const handleTrade = (req, res) => {
  if (req.body.auth_id === AUTH_ID) {
    res.status(200).end()
    executeTrade(req.body)
  } else {
    console.log('401 UNAUTHORIZED', req.body)
    res.status(401).end()
  }
}

//
// === Custom exchange methods ===
//

// ByBit's trailing stop losses can only be set on open positions
const setBybitTslp = async (trailingStopLossTarget) => {
  if (trailingStopLossTarget) {
    await exchange.v2_private_post_position_trading_stop({
      symbol: TICKER_BASE + TICKER_QUOTE,
      trailing_stop: Math.round(trailingStopLossTarget * 100) / 100
    })
  }
}

//
// === Trade execution ===
//

// Execute the proper trade via a CCXT promise
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  try {
    // tpp = take profit %, slp = stop loss %, tslp = trailing stop loss %
    // IMPORTANT: LEVERAGE NEEDS TO MANUALLY BE SET IN BYBIT AS WELL!!!
    let {action, order_type, limit_backtrace_percent, limit_cancel_time_seconds, tpp, slp, tslp, leverage} = json
    tpp = parseFloat(tpp * .01) // to percent
    slp = parseFloat(slp * .01) // to percent
    tslp = parseFloat(tslp * .01) // to percent

    // Check balances and use that in the trade
    const balances = await exchange.fetchBalance()
    const tickerDetails = await exchange.fetchTicker(TICKER)
    const quotePrice = tickerDetails.last
    const freeBaseBalance = balances[TICKER_BASE].free
    const usedBaseBalance = balances[TICKER_BASE].used
    const freeContractQty = freeBaseBalance * quotePrice * leverage * .95 // .95 so we have enough funds
    const usedContractQty = usedBaseBalance * quotePrice * leverage
    const orderType = order_type == ('market' || 'limit') ? order_type : undefined

    // Parse params according to each exchanges' API
    const handleTradeParams = () => {
      switch (EXCHANGE) {
        case 'bybit':
          if (action == 'long_entry' || action == 'reverse_short_to_long') {
            return {
              'take_profit': tpp ? (quotePrice * (1 + tpp)) : undefined,
              'stop_loss': slp ? (quotePrice * (1 - slp)) : undefined
            }
          } else if (action == 'short_entry' || action == 'reverse_long_to_short') {
            return {
              'take_profit': tpp ? (quotePrice * (1 - tpp)) : undefined,
              'stop_loss': slp ? (quotePrice * (1 + slp)) : undefined
            }
          } else { return {} }
          break
        // Add more exchanges here
      }
    }

    let tradeParams = handleTradeParams()
    let trailingStopLossTarget = tslp ? quotePrice * tslp : undefined
    console.log('===')
    console.log('free', TICKER_BASE, freeBaseBalance)
    console.log('used', TICKER_BASE, usedBaseBalance)
    console.log(TICKER, 'price', quotePrice)

    // TODO: pass required params when making limit orders (limit order price, and cancel order after n seconds)
    // TODO: make 'set TSL' callback fire only after the 'cancel order after n seconds' time, only if order was filled

    const shortEntry = async (isReversal) => {
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            const orderQty = isReversal ? usedContractQty * 2 : freeContractQty
            console.log(await exchange.createOrder(TICKER, orderType, 'sell', orderQty, quotePrice, tradeParams))
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'ORDER NOT PLACED, MAYBE ORDER ALREADY EXISTS?') }
    }

    const shortExit = async () => {
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
            tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
            console.log(await exchange.createOrder(TICKER, orderType, 'buy', usedContractQty, quotePrice, tradeParams))
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'CLOSE ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const longEntry = async (isReversal) => {
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            const orderQty = isReversal ? usedContractQty * 2 : freeContractQty
            console.log(await exchange.createOrder(TICKER, orderType, 'buy', orderQty, quotePrice, tradeParams))
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'ORDER NOT PLACED, MAYBE ORDER ALREADY EXISTS?') }
    }

    const longExit = async () => {
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
            tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
            console.log(await exchange.createOrder(TICKER, orderType, 'sell', usedContractQty, quotePrice, tradeParams))
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'CLOSE ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    // Decides what action to take with the received signal
    const tradeParser = async () => {
      const isReversal = usedBaseBalance > freeBaseBalance ? true : false // used in reversal actions
      switch (action) {
        case 'short_entry':
          console.log('SHORT ENTRY', json)
          await shortEntry()
          .then(() => setBybitTslp(trailingStopLossTarget))
          .catch((error) => console.log(error))
          break
        case 'short_exit':
          console.log('SHORT EXIT', json)
          await shortExit()
          break
        case 'long_entry':
          console.log('LONG ENTRY', json)
          await longEntry()
          .then(() => setBybitTslp(trailingStopLossTarget))
          .catch((error) => console.log(error))
          break
        case 'long_exit':
          console.log('LONG EXIT', json)
          await longExit()
          break
        case 'reverse_short_to_long':
          console.log('REVERSE SHORT TO LONG, REVERSAL=' + isReversal, json)
          await longEntry(isReversal)
          .then(() => setBybitTslp(trailingStopLossTarget))
          .catch((error) => console.log(error))
          break
        case 'reverse_long_to_short':
          console.log('REVERSE LONG TO SHORT, REVERSAL=' + isReversal, json)
          await shortEntry(isReversal)
          .then(() => setBybitTslp(trailingStopLossTarget))
          .catch((error) => console.log(error))
          break
        default:
          console.log('Invalid action')
      }
    }

    tradeParser() // Executes the correct trade
  } catch(error) {
    console.log('ERROR:', error)
  }
}
