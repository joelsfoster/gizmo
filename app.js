const express = require('express')
const bodyParser = require('body-parser')
const ccxt = require ('ccxt')
const dotenv = require('dotenv')

//
// === Setup and config ===
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
// === Webhooks and handlers ===
//

// Catch the webhook and handle the trade
app.post("/placeTrade", (req, res) => {
  handleTrade(req, res)
})

// Checks first to see if the webhook carries a valid safety ID
const handleTrade = (req, res) => {
  if (req.body.authId === AUTH_ID) {
    res.status(200).end()
    executeTrade(req.body)
  } else {
    console.log('401 UNAUTHORIZED', req.body)
    res.status(401).end()
  }
}


//
// === Exchange and trades ===
//

// Execute the proper trade via a CCXT promise
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  // ttpp = trailing take profit %, tslp = trailing stop loss %
  // LEVERAGE NEEDS TO MANUALLY BE SET IN BYBIT AS WELL
  const {action, ttpp, tslp, leverage} = json

  // Check balances and use that in the trade
  const balances = await exchange.fetchBalance()
  const tickerDetails = await exchange.fetchTicker(TICKER)
  const quotePrice = tickerDetails.last
  const freeBaseBalance = balances[TICKER_BASE].free
  const usedBaseBalance = balances[TICKER_BASE].used
  const baseContractQty = freeBaseBalance * quotePrice * (leverage * .95) // .95 so we have enough funds
  const usedContractQty = usedBaseBalance * quotePrice * (leverage * 1.05) // 1.05 so we don't leave 'dust' in an open order
  console.log('===')
  console.log('free', TICKER_BASE, freeBaseBalance)
  console.log('used', TICKER_BASE, usedBaseBalance)
  console.log(TICKER, 'price', quotePrice)

  // TODO: set take profit and stop loss

  const shortEntry = async (json) => {
    switch (EXCHANGE) {
      case 'bybit':
        console.log(await exchange.createOrder(TICKER, 'market', 'sell', baseContractQty, quotePrice, {}))
        break
      // Add more exchanges here
    }
  }

  const shortExit = async (json) => {
    if (usedBaseBalance > 0) { // only places command if there's an open position
      switch (EXCHANGE) {
        case 'bybit':
          console.log(await exchange.createOrder(TICKER, 'market', 'buy', usedContractQty, quotePrice, {'reduce_only': true}))
          break
        // Add more exchanges here
      }
    }
  }

  const longEntry = async (json) => {
    switch (EXCHANGE) {
      case 'bybit':
        console.log(await exchange.createOrder(TICKER, 'market', 'buy', baseContractQty, quotePrice, {}))
        break
      // Add more exchanges here
    }
  }

  const longExit = async (json) => {
    if (usedBaseBalance > 0) { // only places command if there's an open position
      switch (EXCHANGE) {
        case 'bybit':
          console.log(await exchange.createOrder(TICKER, 'market', 'sell', usedContractQty, quotePrice, {'reduce_only': true}))
          break
        // Add more exchanges here
      }
    }
  }

  // Decides what action to take with the received signal
  const tradeParser = async (json) => {
    switch (action) {
      case 'short_entry':
        console.log('SHORT ENTRY', json)
        shortEntry(json)
        break
      case 'short_exit':
        console.log('SHORT EXIT', json)
        shortExit(json)
        break
      case 'long_entry':
        console.log('LONG ENTRY', json)
        longEntry(json)
        break
      case 'long_exit':
        console.log('LONG EXIT', json)
        longExit(json)
        break
      default:
        console.log('Invalid action')
    }
  }

  tradeParser(json) // Executes the correct trade
}
