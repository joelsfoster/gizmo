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
  let json = req.body
  if (req.body.auth_id === AUTH_ID) {
    res.status(200).end()
    executeTrade(json)
  } else {
    console.log('401 UNAUTHORIZED', json)
    res.status(401).end()
  }
}

//
// === Custom exchange methods ===
//

// ByBit's trailing stop losses can only be set on open positions
const setBybitTslp = async (trailingStopLossTarget) => {
  if (trailingStopLossTarget && EXCHANGE == 'bybit') {
    await exchange.v2_private_post_position_trading_stop({
      symbol: TICKER_BASE + TICKER_QUOTE,
      trailing_stop: Math.round(trailingStopLossTarget * 100) / 100
    })
  } else { return }
}


//
// === Trade execution ===
//

const getBalances = async () => {
  let balances = await exchange.fetchBalance()
  let tickerDetails = await exchange.fetchTicker(TICKER)
  let quotePrice = tickerDetails.last
  let freeBaseBalance = balances[TICKER_BASE].free
  let usedBaseBalance = balances[TICKER_BASE].used

  return {
    balances: balances,
    tickerDetails: tickerDetails,
    quotePrice: quotePrice,
    freeBaseBalance: freeBaseBalance,
    usedBaseBalance: usedBaseBalance
  }
}

// If limit order, wait this many seconds until next async function
const limitOrderFillDelay = async (orderType, limit_cancel_time_seconds) => {
  if (orderType == 'limit' && limit_cancel_time_seconds) {
    let limitCancelTimeMilliSeconds = limit_cancel_time_seconds * 1000
    return // TODO time delay then get new freeBaseBalance and usedBaseBalance
  } else { return }
}

// If using limit orders, close unfilled limit orders
const cancelUnfilledLimitOrders = async (orderType, limit_cancel_time_seconds) => {
  if (orderType == 'limit' && limit_cancel_time_seconds) {
    // await exchange.cancelAllOrders(TICKER)
  } else { return }
}


// TODO add support for setting TSL on a limit order that has been filled
// TODO add support for limit exit instead of a TP. to do this, place a new reverse limit order at desired exit price
// TODO limitOrderQuotePrice & orderQuotePrice are weird for limit order exit functions

// Stores the last trade action so we don't get repeats
let lastTradeAction

// Execute the proper trade
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  try {
    // tpp = take profit %, slp = stop loss %, tslp = trailing stop loss %
    // IMPORTANT: LEVERAGE NEEDS TO MANUALLY BE SET IN BYBIT AS WELL!!!
    let {action, order_type, limit_backtrace_percent, limit_cancel_time_seconds, tpp, slp, tslp, leverage} = json
    tpp = parseFloat(tpp * .01) // to percent
    slp = parseFloat(slp * .01) // to percent
    tslp = parseFloat(tslp * .01) // to percent
    limit_backtrace_percent = parseFloat(limit_backtrace_percent * .01) // to percent


    // Check balances and use that in the trade
    let { balances, tickerDetails, quotePrice, freeBaseBalance, usedBaseBalance } = await getBalances()
    let freeContractQty = freeBaseBalance * quotePrice * leverage * .95 // .95 so we have enough funds
    let usedContractQty = usedBaseBalance * quotePrice * leverage
    let orderType = order_type == 'market' || 'limit' ? order_type : undefined
    let limitOrderQuotePrice = action == 'short_entry' || 'short_exit' || 'reverse_long_to_short' ? quotePrice * (1 + limit_backtrace_percent) : quotePrice * (1 - limit_backtrace_percent)
    let orderQuotePrice = orderType == 'market' ? quotePrice : limitOrderQuotePrice // limit orders are placed at a different price than market orders

    // Parse params according to each exchanges' API
    const handleTradeParams = () => {
      // const timeInForce = orderType == 'limit' ? 'PostOnly' : '' // Maybe need this?
      switch (EXCHANGE) {
        case 'bybit':
          if (action == 'long_entry' || action == 'reverse_short_to_long') {
            return {
              'take_profit': tpp ? (orderQuotePrice * (1 + tpp)) : undefined,
              'stop_loss': slp ? (orderQuotePrice * (1 - slp)) : undefined,
              // 'time_in_force': timeInForce
            }
          } else if (action == 'short_entry' || action == 'reverse_long_to_short') {
            return {
              'take_profit': tpp ? (orderQuotePrice * (1 - tpp)) : undefined,
              'stop_loss': slp ? (orderQuotePrice * (1 + slp)) : undefined,
              // 'time_in_force': timeInForce
            }
          } else { return {} }
          break
        // Add more exchanges here
      }
    }

    let tradeParams = handleTradeParams()
    let trailingStopLossTarget = tslp ? orderQuotePrice * tslp : undefined
    console.log('===')
    console.log('free', TICKER_BASE, freeBaseBalance)
    console.log('used', TICKER_BASE, usedBaseBalance)
    console.log(TICKER, 'price', quotePrice)

    const shortEntry = async (openOrderExists) => {
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            let orderQty = openOrderExists ? usedContractQty * 2 : freeContractQty // Fully reverse position
            console.log(await exchange.createOrder(TICKER, orderType, 'sell', orderQty, orderQuotePrice, tradeParams))
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
            console.log(await exchange.createOrder(TICKER, orderType, 'buy', usedContractQty, orderQuotePrice, tradeParams))
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'CLOSE ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const longEntry = async (openOrderExists) => {
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            let orderQty = openOrderExists ? usedContractQty * 2 : freeContractQty // Fully reverse position
            console.log(await exchange.createOrder(TICKER, orderType, 'buy', orderQty, orderQuotePrice, tradeParams))
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
            console.log(await exchange.createOrder(TICKER, orderType, 'sell', usedContractQty, orderQuotePrice, tradeParams))
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'CLOSE ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    // Decides what action to take with the received signal
    const tradeParser = async () => {
      let openOrderExists = usedBaseBalance > freeBaseBalance ? true : false // used in reversal actions
      if (action !== lastTradeAction) { // Prevents repeat actions
        switch (action) {
          case 'short_entry':
            console.log('SHORT ENTRY')
            lastTradeAction = action
            await shortEntry()
            .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
            .then( () => cancelUnfilledLimitOrders(orderType) )
            .then( () => setBybitTslp(trailingStopLossTarget) ) // TODO move this into the entry/exit funciton case
            .catch( (error) => console.log(error) )
            break
          case 'short_exit':
            console.log('SHORT EXIT')
            lastTradeAction = action
            await shortExit()
            break
          case 'long_entry':
            console.log('LONG ENTRY')
            lastTradeAction = action
            await longEntry()
            .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
            .then( () => cancelUnfilledLimitOrders(orderType) )
            .then( () => setBybitTslp(trailingStopLossTarget) ) // TODO move this into the entry/exit funciton case
            .catch( (error) => console.log(error) )
            break
          case 'long_exit':
            console.log('LONG EXIT')
            lastTradeAction = action
            await longExit()
            break
          case 'reverse_short_to_long':
            console.log('REVERSE SHORT TO LONG, REVERSAL=' + openOrderExists)
            lastTradeAction = action
            await longEntry(openOrderExists)
            .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
            .then( () => cancelUnfilledLimitOrders(orderType) )
            .then( () => setBybitTslp(trailingStopLossTarget) ) // TODO move this into the entry/exit funciton case
            .catch( (error) => console.log(error) )
            break
          case 'reverse_long_to_short':
            console.log('REVERSE LONG TO SHORT, REVERSAL=' + openOrderExists)
            lastTradeAction = action
            await shortEntry(openOrderExists)
            .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
            .then( () => cancelUnfilledLimitOrders(orderType) )
            .then( () => setBybitTslp(trailingStopLossTarget) ) // TODO move this into the entry/exit funciton case
            .catch( (error) => console.log(error) )
            break
          default:
            console.log('Invalid action')
        }
      } else { console.log('ACTION NOT TAKEN, REPEAT OF LAST ACTION')}
    }

    tradeParser() // Executes the correct trade
  } catch(error) {
    console.log('ERROR:', error)
  }
}
