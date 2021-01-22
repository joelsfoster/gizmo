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
  // leverage needs to be set manually on bybit but passed in here for qty calculation
  const {action, ttpp, tslp, leverage} = json

  // Check balances and use that in the trade
  const balances = await exchange.fetchBalance()
  const tickerDetails = await exchange.fetchTicker(TICKER)
  const quotePrice = tickerDetails.last
  const freeBaseBalance = balances[TICKER_BASE].free
  const usedBaseBalance = balances[TICKER_BASE].used
  const baseContractQty = freeBaseBalance * quotePrice * (leverage * .95) // .95 so we have enough funds
  // const usedEthQty = usedEthBalance * quotePrice // "qty" contracts in bybit
  console.log('===')
  console.log('free', TICKER_BASE, freeBaseBalance)
  console.log('used', TICKER_BASE, usedBaseBalance)
  console.log(TICKER, 'price', quotePrice)

  // TODO: set take profit and stop loss
  // TODO: close all positions

  const short = async (json) => {
    console.log(await exchange.createOrder(TICKER, 'market', 'sell', baseContractQty, quotePrice, {}))
  }

  const exit = async (json) => {
    // await exchange.createOrder(TICKER, 'Market', 'Buy', usedEthBalance, undefined, {})
  }

  // Decides what action to take with the received signal
  const tradeParser = async (json) => {
    switch (action) {
      case 'short':
        console.log('SHORT ORDER', json)
        short(json)
        break
      case 'exit':
        console.log('EXIT ORDER', json)
        exit(json)
        break
      default:
        console.log('Invalid action')
    }
  }

  tradeParser(json) // Executes the correct trade
}
