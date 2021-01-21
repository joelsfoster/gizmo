const express = require('express')
const bodyParser = require('body-parser')
const ccxt = require ('ccxt')
const dotenv = require('dotenv')

// Use .env file for private keys
dotenv.config()

// Start app with bodyParser
const app = express().use(bodyParser.json())
const PORT = 80

// Ensure all TradingView webhooks contain the TV_AUTH_ID to authorize trades to be made
const TV_AUTH_ID = process.env.TV_AUTH_ID

// Set the exchange according to the CCXT ID https://github.com/ccxt/ccxt/wiki/Manual
const EXCHANGE = 'bybit'
const TEST_MODE = process.env.TEST_MODE
const EXCHANGE_TESTNET_API_KEY = process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_KEY']
const EXCHANGE_TESTNET_API_SECRET = process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_SECRET']
const EXCHANGE_LIVE_API_KEY = process.env[EXCHANGE.toUpperCase() + '_API_KEY']
const EXCHANGE_LIVE_API_SECRET = process.env[EXCHANGE.toUpperCase() + '_API_SECRET']
let apiKey = TEST_MODE == 'true' ? EXCHANGE_TESTNET_API_KEY : EXCHANGE_LIVE_API_KEY
let apiSecret = TEST_MODE == 'true'? EXCHANGE_TESTNET_API_SECRET : EXCHANGE_LIVE_API_SECRET


//
// === Endpoints ===
//

// On startup
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

// Catch the webhook and handle the trade
app.post("/tradingview", (req, res) => {
  handleTrade(req, res)
})


//
// === Functions ===
//

// Checks first to see if the webhook carries a valid safety ID
const handleTrade = (req, res) => {
  if (req.body.authId === TV_AUTH_ID) {
    res.status(200).end()
    executeTrade(req.body)
  } else {
    res.status(401).end()
  }
}


// Execute the proper trade via a CCXT promise
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  // Instantiate the exchange--I don't know how to preserve this in global memory
  let exchange = new ccxt[EXCHANGE.toLowerCase()] ({
    apiKey: apiKey,
    secret: apiSecret
  })

  // Handle authentication in test mode
  if (TEST_MODE == 'true') {
    exchange.urls['api'] = exchange.urls['test']
  }

  // Check balances and use that in the trade
  const TICKER = 'ETH/USD'
  let balances = await exchange.fetchBalance()
  let ethBalance = balances['ETH']
  // console.log('===')
  // console.log('free ETH', ethBalance.free)
  // console.log('used ETH', ethBalance.used)

  // TODO: retrieve price so we can place a take profit and stop loss


  // Decides what action to take with the received signal
  let tradeParser = (json) => {

    // ttpp = trailing take profit %, tslp = trailing stop loss %
    let {authId, action, ttpp, tslp, leverage} = json

    switch (action) {
      case 'short':
        console.log('SHORT ORDER', json)
        // console.log(await exchange.createMarketSellOrder (TICKER, .5)) // sell .5 ETH
        break
      case 'exit':
        console.log('EXIT ORDER', json)
        // console.log(await exchange.cancelAllOrders(TICKER))
        break
      default:
        console.log('Invalid action')
        // await exchange.cancelAllOrders // use this when using leverage
    }
  }

  tradeParser(json) // Executes the correct trade
}
