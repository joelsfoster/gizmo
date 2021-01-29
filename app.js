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

// Stores the last trade action so we don't get repeats
let lastTradeAction

// Retrieve balances from the exchange
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
    console.log('initializing', limit_cancel_time_seconds, 'second delay...')
    let limitCancelTimeMilliSeconds = limit_cancel_time_seconds * 1000
    return await new Promise(resolve => setTimeout(resolve, limitCancelTimeMilliSeconds));
  } else { return }
}

// If using limit orders, close unfilled limit orders
const cancelUnfilledLimitOrders = async (orderType, limit_cancel_time_seconds) => {
  if (orderType == 'limit' && limit_cancel_time_seconds) {
    console.log('closing unfilled orders...')
    await exchange.cancelAllOrders(TICKER)
  } else { return }
}

// Execute the proper trade
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  try {
    // ltpp = limit take profit %, mtpp = market take profit %, slp = stop loss %, tslp = trailing stop loss %
    // IMPORTANT: LEVERAGE NEEDS TO MANUALLY BE SET IN BYBIT AS WELL!!!
    let {action, override, order_type, limit_backtrace_percent, limit_cancel_time_seconds, ltpp, mtpp, slp, tslp, leverage} = json
    ltpp = parseFloat(ltpp * .01) // To percent
    mtpp = parseFloat(mtpp * .01) // To percent
    slp = parseFloat(slp * .01) // To percent
    tslp = parseFloat(tslp * .01) // To percent
    limit_backtrace_percent = parseFloat(limit_backtrace_percent * .01) // To percent

    // Check balances and use that in the trade
    let { balances, tickerDetails, quotePrice, freeBaseBalance, usedBaseBalance } = await getBalances()
    let freeContractQty = freeBaseBalance * quotePrice * leverage * .95 // .95 so we have enough funds
    let usedContractQty = usedBaseBalance * quotePrice * leverage
    let orderType = (order_type == 'market' || 'limit') ? order_type : undefined
    let limitTakeProfitPrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? quotePrice * (1 - ltpp) : quotePrice * (1 + ltpp)
    let limitOrderQuotePrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? quotePrice * (1 - limit_backtrace_percent) : quotePrice * (1 + limit_backtrace_percent)
    let orderQuotePrice = orderType == 'market' ? quotePrice : limitOrderQuotePrice // Limit orders are placed at a different price than market orders

    // console.log('orderType:', orderType, 'action:', action, 'limitTakeProfitPrice:', limitTakeProfitPrice, 'shortPrice:', quotePrice * (1 - ltpp), 'longPrice:', quotePrice * (1 + ltpp))

    // Parse params according to each exchanges' API
    const handleTradeParams = () => {
      // const timeInForce = orderType == 'limit' ? 'PostOnly' : '' // Maybe need this?
      switch (EXCHANGE) {
        case 'bybit':
          if (action == 'long_entry' || action == 'reverse_short_to_long') {
            return {
              'take_profit': mtpp ? (orderQuotePrice * (1 + mtpp)) : undefined,
              'stop_loss': slp ? (orderQuotePrice * (1 - slp)) : undefined,
              // 'time_in_force': timeInForce
            }
          } else if (action == 'short_entry' || action == 'reverse_long_to_short') {
            return {
              'take_profit': mtpp ? (orderQuotePrice * (1 - mtpp)) : undefined,
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

    const shortEntry = async (isReversal) => {
      console.log('firing off shortEntry...')
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            let orderQty = isReversal ? usedContractQty * 2 : freeContractQty // Fully reverse position
            await exchange.createOrder(TICKER, orderType, 'sell', orderQty, orderQuotePrice, tradeParams)
            .then( () => setBybitTslp(trailingStopLossTarget) )
            break
          // Add more exchanges here
        }
      }
    }

    const shortMarketExit = async () => {
      console.log('firing off shortMarketExit...')
      if (orderType == 'limit') { // All unfilled orders closed by now. Can have an open position or not
        let refreshedBalances = await getBalances()
        let refreshedQuotePrice = refreshedBalances.quotePrice
        let refreshedUsedContractQty = refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage
        let refreshedFreeContractQty = refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage
        if (refreshedUsedContractQty > refreshedFreeContractQty) { // If open position, close it
          switch (EXCHANGE) {
            case 'bybit':
              tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
              tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
              await exchange.createOrder(TICKER, 'market', 'buy', refreshedUsedContractQty, refreshedQuotePrice, tradeParams)
              break
            // Add more exchanges here
          }
        } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
      } else if (orderType == 'market' && usedContractQty > freeContractQty) {
        switch (EXCHANGE) {
          case 'bybit':
            tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
            tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
            await exchange.createOrder(TICKER, 'market', 'buy', usedContractQty, quotePrice, tradeParams)
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const setShortLimitExit = async () => {
      console.log('firing off setShortLimitExit...')
      let refreshedBalances = await getBalances() // Once an order is placed, we need the new usedContractQty to know for setting the limit exit
      let refreshedQuotePrice = refreshedBalances.quotePrice
      let refreshedUsedContractQty = refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage
      let exitOrderContractQty = freeContractQty > refreshedUsedContractQty ? freeContractQty : refreshedUsedContractQty
      if (limitTakeProfitPrice && refreshedUsedContractQty > 0) {
        console.log('setting limit exit at', limitTakeProfitPrice + '...')
        switch (EXCHANGE) {
          case 'bybit':
            tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
            await exchange.createOrder(TICKER, 'limit', 'buy', exitOrderContractQty, limitTakeProfitPrice, tradeParams)
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'LIMIT EXIT ORDER CANCELED, MAYBE NO POSIITON TO PLACE IT ON?') }
    }

    const longEntry = async (isReversal) => {
      console.log('firing off longEntry...')
      if (orderType) {
        switch (EXCHANGE) {
          case 'bybit':
            let orderQty = isReversal ? usedContractQty * 2 : freeContractQty // Fully reverse position
            await exchange.createOrder(TICKER, orderType, 'buy', orderQty, orderQuotePrice, tradeParams)
            .then( () => setBybitTslp(trailingStopLossTarget) )
            break
          // Add more exchanges here
        }
      }
    }

    const longMarketExit = async () => {
      console.log('firing off longMarketExit...')
      if (orderType == 'limit') { // All unfilled orders closed by now. Can have an open position or not
        let refreshedBalances = await getBalances()
        let refreshedQuotePrice = refreshedBalances.quotePrice
        let refreshedUsedContractQty = refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage
        let refreshedFreeContractQty = refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage
        if (refreshedUsedContractQty > refreshedFreeContractQty) { // If open position, close it
          switch (EXCHANGE) {
            case 'bybit':
              tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
              tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
              await exchange.createOrder(TICKER, 'market', 'sell', refreshedUsedContractQty, refreshedQuotePrice, tradeParams)
              break
            // Add more exchanges here
          }
        } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
      } else if (orderType == 'market' && usedContractQty > freeContractQty) {
        switch (EXCHANGE) {
          case 'bybit':
            tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
            tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
            await exchange.createOrder(TICKER, 'market', 'sell', usedContractQty, quotePrice, tradeParams)
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const setLongLimitExit = async () => {
      console.log('firing off setLongLimitExit...')
      let refreshedBalances = await getBalances() // Once an order is placed, we need the new usedContractQty to know for setting the limit exit
      let refreshedQuotePrice = refreshedBalances.quotePrice
      let refreshedUsedContractQty = refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage
      let refreshedFreeContractQty = refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage
      let exitOrderContractQty = freeContractQty > refreshedUsedContractQty ? freeContractQty : refreshedUsedContractQty
      if (limitTakeProfitPrice && refreshedUsedContractQty > 0) {
        console.log('setting limit exit at', limitTakeProfitPrice + '...')
        switch (EXCHANGE) {
          case 'bybit':
            tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
            await exchange.createOrder(TICKER, 'limit', 'sell', exitOrderContractQty, limitTakeProfitPrice, tradeParams)
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'LIMIT EXIT ORDER CANCELED, MAYBE NO POSITION TO PLACE IT ON?') }
    }

    // TODO: DRY on refreshedBalances refreshedQuotePrice refreshedFreeContractQty refreshedUsedContractQty
    // TODO figure out why ".02" limit_backtrace_percent works but not "2", im place orders at a way different entry price?
    // TODO handle "override" orders e.g. red dot (closes) -> red x (closes) -> yellow x all in the same run


    // Decides what action to take with the received signal
    const tradeParser = async () => {
      let isReversal = usedBaseBalance > freeBaseBalance ? true : false // Used in reversal actions
      if (lastTradeAction !== action || override) { // Prevents repeat actions but lets you override if desired
        lastTradeAction = action // Prevents repeat actions
        switch (action) {
          case 'short_entry':
            console.log('SHORT ENTRY')
            await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
            .then( () => shortEntry() )
            .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
            .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
            .then( () => setShortLimitExit() )
            .catch( (error) => console.log(error) )
            break
          case 'short_exit':
            console.log('SHORT MARKET EXIT')
            await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
            .then( () => shortMarketExit() )
            .catch( (error) => console.log(error) )
            break
          case 'long_entry':
            console.log('LONG ENTRY')
            await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
            .then( () => longEntry() )
            .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
            .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
            .then( () => setLongLimitExit() )
            .catch( (error) => console.log(error) )
            break
          case 'long_exit':
            console.log('LONG MARKET EXIT')
            await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
            .then( () => longMarketExit() )
            .catch( (error) => console.log(error) )
            break
          case 'reverse_short_to_long':
            console.log('REVERSE SHORT TO LONG, REVERSAL=' + isReversal)
            if (orderType == 'limit' && isReversal) { // If a limit order reversal, market close current order and open a new limit order
              await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
              .then( () => shortMarketExit() )
              .then( () => longEntry() )
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setLongLimitExit() )
              .catch( (error) => console.log(error) )
            } else {
              await longEntry(isReversal) // If no position, just open one. If using market orders, reverse position in one action to save on fees.
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setLongLimitExit() )
              .catch( (error) => console.log(error) )
            }
            break
          case 'reverse_long_to_short':
            console.log('REVERSE LONG TO SHORT, REVERSAL=' + isReversal)
            if (orderType == 'limit' && isReversal) { // If a limit order reversal, market close current order and open a new limit order
              await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
              .then( () => longMarketExit() )
              .then( () => shortEntry() )
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setShortLimitExit() )
              .catch( (error) => console.log(error) )
            } else {
              await shortEntry(isReversal) // If no position, just open one. If using market orders, reverse position in one action to save on fees.
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setShortLimitExit() )
              .catch( (error) => console.log(error) )
            }
            break
          default:
            console.log('Invalid action')
        }
      } else { console.log('ACTION NOT TAKEN, REPEAT OF LAST ACTION')}
    }

    tradeParser() // Executes the correct trade
  } catch(error) {
    console.log('EXECUTETRADE ERROR:', error)
  }
}
