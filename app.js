const express = require('express')
const bodyParser = require('body-parser')
const ccxt = require ('ccxt')
const dotenv = require('dotenv')

// Use .env file for private keys
dotenv.config()

// Start app with bodyParser
const app = express().use(bodyParser.json())
const PORT = 80

// Ensure all webhooks contain the TRADE_AUTH_ID to authorize trades to be made
const TRADE_AUTH_ID = process.env.TRADE_AUTH_ID

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
  if (req.body.id == TRADE_AUTH_ID) {
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
  let phemex = new ccxt.phemex ({
    apiKey: process.env.PHEMEX_API_KEY,
    secret: process.env.PHEMEX_API_SECRET
  })

  // Check balances and use that in the trade
  let balances = phemex.fetchBalance()
  let ethBalance = balances['ETH']
  // console.log(ethBalance.free)
  // console.log(ethBalance.used)


  // Decides what action to take with the received signal
  const tradeParser = (json) => {

    // TODO: MAKE THIS WORK!!!
    {action, leverage, takeProfitPercent, stopLossPercent} = json

    // TODO: ALSO NEED AMOUNT IN HERE!!!
    switch (action) {
      case 'short_entry':
        console.log('short_exit', leverage, takeProfitPercent, stopLossPercent)
        // await phemex.createMarketSellOrder ('ETH/USDT', 1) // sell 1 ETH
        break
      case 'short_exit':
        console.log('short_exit', leverage, takeProfit, stopLossPercent)
        // await phemex.createMarketBuyOrder ('ETH/USDT', 1) // buy 1 ETH
        break
      default:
        console.log('Invalid action')
        // await phemex.cancelAllOrders // use this when using leverage
    }
  }
}
