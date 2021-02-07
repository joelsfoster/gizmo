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

// Catch the webhook and handle the Bollinger Band signal
app.post("/bbSignal", (req, res) => {
  handleBbSignal(req, res)
})


// Checks first to see if the webhook carries a valid safety ID
const handleTrade = (req, res) => {
  let json = req.body
  if (json.auth_id === AUTH_ID) {
    if (json.current_direction) { currentDirection = json.current_direction } // When using activation direction
    executeTrade(json)
    res.status(200).end()
  } else {
    console.log('401 UNAUTHORIZED', json)
    res.status(401).end()
  }
}

// Bollinger Band signals. Checks first to see if the webhook carries a valid safety ID
const handleBbSignal = (req, res) => {
  let json = req.body
  if (json.auth_id === AUTH_ID) {
    if (json.bb_signal == 'basis_breached') { bbNextTradeApproved = true }
    if (json.bb_signal == 'lower_bound_breached') { bbNextLongApproved = true }
    if (json.bb_signal == 'upper_bound_breached') { bbNextShortApproved = true }
    if (json.bb_signal == 'activate') {
      bbNextTradeApproved = true
      bbNextLongApproved = false
      bbNextShortApproved = false
    }
    console.log('bbNextTradeApproved:', bbNextTradeApproved, 'bbNextLongApproved:', bbNextLongApproved, 'bbNextShortApproved:', bbNextShortApproved)
    res.status(200).end()
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
    try {
      await exchange.v2_private_post_position_trading_stop({
        symbol: TICKER_BASE + TICKER_QUOTE,
        trailing_stop: Math.round(trailingStopLossTarget * 100) / 100
      })
    } catch { return console.log('ERROR SETTING TRAILING STOP LOSS') }
  } else { return }
}


//
// === Trade execution ===
//

// Stores the last trade action so we don't get repeats
let lastTradeAction = undefined

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

// When using activation direction
let currentDirection = undefined

// When using Bollinger Band signals. Middle band has to be touched to allow the next trade. The next long/short is approved if the lower/upper bands are breached
let bbNextTradeApproved = undefined
let bbNextLongApproved = undefined
let bbNextShortApproved = undefined

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
    try {
      console.log('closing unfilled orders...')
      await exchange.cancelAllOrders(TICKER)
    } catch { return console.log('ERROR CLOSING UNFILLED ORDERS') }
  } else { return }
}

// Execute the proper trade
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  try {
    // ltpp = limit take profit %, mtpp = market take profit %, slp = stop loss %, tslp = trailing stop loss %
    // IMPORTANT: LEVERAGE NEEDS TO MANUALLY BE SET IN BYBIT AS WELL!!!
    let {action, current_direction, override, order_type, limit_backtrace_percent, limit_cancel_time_seconds, ltpp, ltp_let_ride_percent, mtpp, slp, tslp, leverage} = json
    ltpp = parseFloat(ltpp * .01) // To percent
    ltp_let_ride_percent = parseFloat(ltp_let_ride_percent * .01) // To percent
    mtpp = parseFloat(mtpp * .01) // To percent
    slp = parseFloat(slp * .01) // To percent
    tslp = parseFloat(tslp * .01) // To percent
    limit_backtrace_percent = parseFloat(limit_backtrace_percent * .01) // To percent

    // Check balances and use that in the trade
    let { balances, tickerDetails, quotePrice, freeBaseBalance, usedBaseBalance } = await getBalances()
    let freeContractQty = Math.floor(freeBaseBalance * quotePrice * leverage * .95) // .95 so we have enough funds
    let usedContractQty = Math.floor(usedBaseBalance * quotePrice * leverage)
    let orderType = (order_type == 'market' || 'limit') ? order_type : undefined
    let limitTakeProfitPrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? quotePrice * (1 - ltpp) : quotePrice * (1 + ltpp)
    let limitOrderQuotePrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? quotePrice * (1 - limit_backtrace_percent) : quotePrice * (1 + limit_backtrace_percent)
    let orderQuotePrice = orderType == 'market' ? quotePrice : limitOrderQuotePrice // Limit orders are placed at a different price than market orders
    let trailingStopLossTarget = tslp ? orderQuotePrice * tslp : undefined
    console.log('===')
    console.log('free', TICKER_BASE, freeBaseBalance)
    console.log('used', TICKER_BASE, usedBaseBalance)
    console.log(TICKER, 'price', quotePrice)

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

    const shortEntry = async (isReversal) => {
      if ((!bbNextTradeApproved || bbNextTradeApproved) && (!bbNextShortApproved || bbNextShortApproved)) { // For when using Bollinger Balds to filter allowable trades
        console.log('firing off shortEntry...')
        let tradeParams = handleTradeParams()
        switch (EXCHANGE) {
          case 'bybit':
            if (orderType == 'market') {
              try {
                let orderQty = isReversal ? usedContractQty + freeContractQty : freeContractQty // If market order, fully reverse position in one action to save on fees
                await exchange.createOrder(TICKER, orderType, 'sell', orderQty, orderQuotePrice, tradeParams)
              } catch { return console.log('ERROR PLACING A SHORT MARKET ENTRY') }
            } else if (orderType == 'limit') { // If limit, position already closed so get new Qty amounts
              let refreshedBalances = await getBalances()
              let refreshedQuotePrice = refreshedBalances.quotePrice
              let refreshedFreeContractQty = Math.floor(refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage * .95) // .95 so we have enough funds
              if (refreshedFreeContractQty > 0) {
                try {
                  await exchange.createOrder(TICKER, orderType, 'sell', refreshedFreeContractQty, refreshedQuotePrice, tradeParams)
                } catch { return console.log('ERROR PLACING A SHORT LIMIT ENTRY') }
              } else { console.log('orderType=' + orderType, 'LIMIT ENTRY ORDER CANCELED, ALREADY AN OPEN POSITION?') }
            }
            break
          // Add more exchanges here
        if (bbNextShortApproved) { bbNextShortApproved = false } // If using Bollinger Bands, set this false after making an allowed trade
        if (bbNextTradeApproved) { bbNextTradeApproved = false } // If using Bollinger Bands, set this false after making an allowed trade
        }
      } else { console.log('USING BOLLINGER BANDS TO FILTER ORDERS, SHORT ENTRY NOT PLACED. bbNextTradeApproved:', bbNextTradeApproved, 'bbNextShortApproved:', bbNextShortApproved) }
    }

    const shortMarketExit = async () => {
      console.log('firing off shortMarketExit...')
      let tradeParams = {} // Can't have TP/SL params on an exit order
      if (orderType == 'limit') { // All unfilled orders closed by now. Can have an open position or not
        let refreshedBalances = await getBalances()
        let refreshedQuotePrice = refreshedBalances.quotePrice
        let refreshedUsedContractQty = Math.floor(refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage * 1.05) // 1.05 to make sure we exit everything
        if (refreshedUsedContractQty > 0) { // If open position, close it
          switch (EXCHANGE) {
            case 'bybit':
              try {
                tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
                tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
                await exchange.createOrder(TICKER, 'market', 'buy', refreshedUsedContractQty, refreshedQuotePrice, tradeParams)
              } catch { return console.log('ERROR PLACING A SHORT MARKET EXIT') }
              break
            // Add more exchanges here
          }
        } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
      } else if (orderType == 'market' && usedContractQty > 0) {
        switch (EXCHANGE) {
          case 'bybit':
            try {
              tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
              tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
              await exchange.createOrder(TICKER, 'market', 'buy', usedContractQty, quotePrice, tradeParams)
            } catch { return console.log('ERROR PLACING A SHORT MARKET EXIT') }
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const setShortLimitExit = async () => {
      console.log('firing off setShortLimitExit...')
      let tradeParams = {} // Can't have TP/SL params on an exit order
      let refreshedBalances = await getBalances() // Once an order is placed, we need the new usedContractQty to know for setting the limit exit
      let refreshedQuotePrice = refreshedBalances.quotePrice
      let refreshedUsedContractQty = Math.floor(refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage)
      let exitOrderContractQty = ltp_let_ride_percent ? ((1 - ltp_let_ride_percent) * refreshedUsedContractQty) : refreshedUsedContractQty // If ltp_let_ride_percent is present, exit some of the position but let the remaining stack ride the trend
      if (currentDirection && (usedContractQty > 0)) { // If using activation direction, and this is an old order, dont set limit
        console.log('Pre-existing activation direction order, no new limit exit set (keeping old limit exit)')
      } else if (limitTakeProfitPrice && refreshedUsedContractQty > 0) {
        console.log('setting limit exit at', limitTakeProfitPrice, 'using', exitOrderContractQty, 'contracts:', ((1 - ltp_let_ride_percent) * 100) + '%', 'of the stack...')
        switch (EXCHANGE) {
          case 'bybit':
            try {
              tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
              await exchange.createOrder(TICKER, 'limit', 'buy', exitOrderContractQty, limitTakeProfitPrice, tradeParams)
            } catch { return console.log('ERROR PLACING A SHORT LIMIT EXIT') }
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'LIMIT EXIT ORDER CANCELED, MAYBE NO POSIITON TO PLACE IT ON?') }
    }

    const longEntry = async (isReversal) => {
      if ((!bbNextTradeApproved || bbNextTradeApproved) && (!bbNextLongApproved || bbNextLongApproved)) { // For when using Bollinger Balds to filter allowable trades
        console.log('firing off longEntry...')
        let tradeParams = handleTradeParams()
        switch (EXCHANGE) {
          case 'bybit':
            if (orderType == 'market') {
              try {
                let orderQty = isReversal ? usedContractQty + freeContractQty : freeContractQty // If market order, fully reverse position in one action to save on fees
                await exchange.createOrder(TICKER, orderType, 'buy', orderQty, orderQuotePrice, tradeParams)
              } catch { return console.log('ERROR PLACING A LONG MARKET ENTRY') }
            } else if (orderType == 'limit') { // If limit, position already closed so get new Qty amounts
              let refreshedBalances = await getBalances()
              let refreshedQuotePrice = refreshedBalances.quotePrice
              let refreshedFreeContractQty = Math.floor(refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage * .95) // .95 so we have enough funds
              if (refreshedFreeContractQty > 0) {
                try {
                  await exchange.createOrder(TICKER, orderType, 'buy', refreshedFreeContractQty, refreshedQuotePrice, tradeParams)
                } catch { return console.log('ERROR PLACING A LONG LIMIT ENTRY') }
              } else { console.log('orderType=' + orderType, 'LIMIT ENTRY ORDER CANCELED, ALREADY AN OPEN POSITION?') }
            }
            break
          // Add more exchanges here
        if (bbNextLongApproved) { bbNextLongApproved = false } // If using Bollinger Bands, set this false after making an allowed trade
        if (bbNextTradeApproved) { bbNextTradeApproved = false } // If using Bollinger Bands, set this false after making an allowed trade
        }
      } else { console.log('USING BOLLINGER BANDS TO FILTER ORDERS, LONG ENTRY NOT PLACED. bbNextTradeApproved:', bbNextTradeApproved, 'bbNextLongApproved:', bbNextLongApproved) }
    }

    const longMarketExit = async () => {
      console.log('firing off longMarketExit...')
      let tradeParams = {} // Can't have TP/SL params on an exit order
      if (orderType == 'limit') { // All unfilled orders closed by now. Can have an open position or not
        let refreshedBalances = await getBalances()
        let refreshedQuotePrice = refreshedBalances.quotePrice
        let refreshedUsedContractQty = Math.floor(refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage * 1.05) // 1.05 to make sure we exit everything
        if (refreshedUsedContractQty > 0) { // If open position, close it
          switch (EXCHANGE) {
            case 'bybit':
              try {
                tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
                tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
                await exchange.createOrder(TICKER, 'market', 'sell', refreshedUsedContractQty, refreshedQuotePrice, tradeParams)
              } catch { return console.log('ERROR PLACING A LONG MARKET EXIT') }
              break
            // Add more exchanges here
          }
        } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
      } else if (orderType == 'market' && usedContractQty > 0) {
        switch (EXCHANGE) {
          case 'bybit':
            try {
              tradeParams.reduce_only = true // In bybit, must make a 'counter order' to close out open positions
              tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
              await exchange.createOrder(TICKER, 'market', 'sell', usedContractQty, quotePrice, tradeParams)
            } catch { return console.log('ERROR PLACING A LONG MARKET EXIT') }
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const setLongLimitExit = async () => {
      console.log('firing off setLongLimitExit...')
      let tradeParams = {} // Can't have TP/SL params on an exit order
      let refreshedBalances = await getBalances() // Once an order is placed, we need the new usedContractQty to know for setting the limit exit
      let refreshedQuotePrice = refreshedBalances.quotePrice
      let refreshedUsedContractQty = Math.floor(refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage)
      let refreshedFreeContractQty = Math.floor(refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage * .95) // .95 so we have enough funds
      let exitOrderContractQty = ltp_let_ride_percent ? ((1 - ltp_let_ride_percent) * refreshedUsedContractQty) : refreshedUsedContractQty // If ltp_let_ride_percent is present, exit some of the position but let the remaining stack ride the trend
      if (currentDirection && (usedContractQty > freeContractQty)) { // If using activation direction, and this is an old order, dont set limit
        console.log('Pre-existing activation direction order, no new limit exit set (keeping old limit exit)')
      } else if (limitTakeProfitPrice && refreshedUsedContractQty > 0) {
        console.log('setting limit exit at', limitTakeProfitPrice, 'using', exitOrderContractQty, 'contracts:', ((1 - ltp_let_ride_percent) * 100) + '%', 'of the stack...')
        switch (EXCHANGE) {
          case 'bybit':
            try {
              tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
              await exchange.createOrder(TICKER, 'limit', 'sell', exitOrderContractQty, limitTakeProfitPrice, tradeParams)
            } catch { return console.log('ERROR PLACING A LONG LIMIT EXIT') }
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'LIMIT EXIT ORDER CANCELED, MAYBE NO POSITION TO PLACE IT ON?') }
    }


    // TODO: setting limit exits still happens on preexisting orders (it sets a new one)

    // TODO: DRY on refreshedBalances refreshedQuotePrice refreshedFreeContractQty refreshedUsedContractQty
    // TODO figure out why ".02" limit_backtrace_percent works but not "2", im place orders at a way different entry price?
    // TODO handle "override" orders e.g. red dot (closes) -> red x (closes) -> yellow x all in the same run


    // Decides what action to take with the received signal
    const tradeParser = async () => {
      let isReversal = usedBaseBalance > freeBaseBalance ? true : false // Used in reversal actions
      if (lastTradeAction !== action || override) { // Prevents repeat actions but lets you override
        lastTradeAction = action // Prevents repeat actions
        switch (action) {
          case 'short_entry':
            console.log('SHORT ENTRY, EXISTING ORDER=' + isReversal)
            if (!currentDirection || currentDirection == 'short') { // Check when using activation direction
              await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
              .then( () => shortEntry() )
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setBybitTslp(trailingStopLossTarget) )
              .then( () => setShortLimitExit() )
              .catch( (error) => console.log(error) )
            } else { console.log('PREVENTED BECAUSE CURRENT DIRECTION =', currentDirection) }
            break
          case 'short_exit':
            console.log('SHORT MARKET EXIT')
            await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
            .then( () => shortMarketExit() )
            .catch( (error) => console.log(error) )
            break
          case 'long_entry':
            console.log('LONG ENTRY, EXISTING ORDER=' + isReversal)
            if (!currentDirection || currentDirection == 'long') { // Check when using activation direction
              await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
              .then( () => longEntry() )
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setBybitTslp(trailingStopLossTarget) )
              .then( () => setLongLimitExit() )
              .catch( (error) => console.log(error) )
            } else { console.log('PREVENTED BECAUSE CURRENT DIRECTION =', currentDirection) }
            break
          case 'long_exit':
            console.log('LONG MARKET EXIT')
            await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
            .then( () => longMarketExit() )
            .catch( (error) => console.log(error) )
            break
          case 'reverse_short_to_long':
            console.log('REVERSE SHORT TO LONG, REVERSAL=' + isReversal)
            if (!currentDirection || currentDirection == 'long') { // Check when using activation direction
              await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
              .then( () => { action == 'limit' ? shortMarketExit() : Promise.resolve() } ) // Market orders conduct exit+entry in one action, while limits use 2 actions
              .then( () => longEntry(isReversal) )
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setBybitTslp(trailingStopLossTarget) )
              .then( () => setLongLimitExit() )
              .catch( (error) => console.log(error) )
            } else { console.log('PREVENTED BECAUSE CURRENT DIRECTION =', currentDirection) }
            break
          case 'reverse_long_to_short':
            console.log('REVERSE LONG TO SHORT, REVERSAL=' + isReversal)
            if (!currentDirection || currentDirection == 'short') { // Check when using activation direction
              await cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds)
              .then( () => { action == 'limit' ? longMarketExit() : Promise.resolve() } ) // Market orders conduct exit+entry in one action, while limits use 2 actions
              .then( () => shortEntry(isReversal) )
              .then( () => limitOrderFillDelay(orderType, limit_cancel_time_seconds) )
              .then( () => cancelUnfilledLimitOrders(orderType, limit_cancel_time_seconds) )
              .then( () => setBybitTslp(trailingStopLossTarget) )
              .then( () => setShortLimitExit() )
              .catch( (error) => console.log(error) )
            } else { console.log('PREVENTED BECAUSE CURRENT DIRECTION =', currentDirection) }
            break
          default:
            console.log('Invalid action (or, you manually set direction:', currentDirection +')')
        }
      } else { console.log('ACTION', action, 'NOT TAKEN, REPEAT OF LAST ACTION (or, you manually set direction:', currentDirection +')') }
    }

    tradeParser() // Executes the correct trade
  } catch(error) {
    console.log('EXECUTETRADE ERROR:', error)
  }
}
