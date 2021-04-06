//
// ~~~ Gizmo ~~~
// ~~~ Original creator https://github.com/joelsfoster/ ~~~
// ~~~ Please use with permission, always happy to see you succeed! ~~~
//

const express = require('express')
const bodyParser = require('body-parser')
const ccxt = require('ccxt')
const dotenv = require('dotenv')
const fs = require('fs');

//
// === Setup, config, and exchange initialization ===
//

// Use .env file for private keys
dotenv.config()

// Start app with bodyParser
const app = express().use(bodyParser.json())
const PORT = process.env.PORT

//Host UI in public folder
app.use(express.static('public'));

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})

// Ensure all TradingView webhooks contain the AUTH_ID to authorize trades to be made
const AUTH_ID = process.env.AUTH_ID

// Set the exchange according to the CCXT ID https://github.com/ccxt/ccxt/wiki/Manual
const EXCHANGE = process.env.EXCHANGE
TICKER_BASE = process.env.TICKER_BASE
TICKER_QUOTE = process.env.TICKER_QUOTE
const TICKER = TICKER_BASE + '/' + TICKER_QUOTE
TEST_MODE = process.env.TEST_MODE == 'false' ? false : true
const EXCHANGE_TESTNET_API_KEY = process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_KEY'] ? process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_KEY'] : null
const EXCHANGE_TESTNET_API_SECRET = process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_SECRET'] ? process.env[EXCHANGE.toUpperCase() + '_TESTNET_API_SECRET'] : null
const EXCHANGE_LIVE_API_KEY = process.env[EXCHANGE.toUpperCase() + '_API_KEY'] ? process.env[EXCHANGE.toUpperCase() + '_API_KEY'] : null
const EXCHANGE_LIVE_API_SECRET = process.env[EXCHANGE.toUpperCase() + '_API_SECRET'] ? process.env[EXCHANGE.toUpperCase() + '_API_SECRET'] : null
const apiKey = TEST_MODE ? EXCHANGE_TESTNET_API_KEY : EXCHANGE_LIVE_API_KEY
const apiSecret = TEST_MODE ? EXCHANGE_TESTNET_API_SECRET : EXCHANGE_LIVE_API_SECRET
tradeRecord = {}

// Instantiate the exchange
const exchange = new ccxt['bybit']({
  apiKey: apiKey,
  secret: apiSecret
})

// Handle authentication in test mode
if (TEST_MODE) {
  exchange.urls['api'] = exchange.urls['test']
  console.log("Currently TESTING on", EXCHANGE)
  if (!apiKey || !apiSecret) { console.log("WARNING: You didn't set an API key and secret for this env") }
} else {
  console.log("Currently LIVE on", EXCHANGE)
  if (!apiKey || !apiSecret) { console.log("WARNING: You didn't set an API key and secret for this env") }
}


//
// === Webhooks ===
//

// Catch the webhook and handle the trade
app.post("/placeTrade", (req, res) => {
  handleTrade(req, res)
})

// For testing the JSON body
app.post("/test", (req, res) => {
  console.log(req.body)
})

//Get Bot Setup
app.get('/getBotSetup', (req, res) => {
  var botSetup = {
    exchange: EXCHANGE,
    ticker_base: TICKER_BASE,
    ticker_quote: TICKER_QUOTE,
    test_mode: TEST_MODE
  };
  res.send(botSetup)
})


//Update Bot Settings
app.post('/updateBotSetup', (req, res) => {
  TICKER_BASE = req.body.ticker_base;
  TICKER_QUOTE = req.body.ticker_quote;
  TEST_MODE = req.body.test_mode;
})

//Get Trade History
app.get('/getTrades', (req, res) => {
  let tradeFile = readTradeHistoryFile()
  if(tradeFile.trades)
  {
    res.send(tradeFile.trades)
  }
})


//Read Trade History Data File
const readTradeHistoryFile = () => {
  if(fs.existsSync('data.json'))
  {
    var file = fs.readFileSync('data.json');
    let tradeHistory = JSON.parse(file);
    return(tradeHistory)

  }else {
    return {trades:[]};
  }

}

//Write Trade History Data File
const writeTradeHistoryFile = (tradeHistoryObj) => {
  let data = JSON.stringify(tradeHistoryObj);

  fs.writeFile('data.json', data, (err) => {
    if (err) throw err;
    console.log('Data written to file');
  });

}


// Checks first to see if the webhook carries a valid safety ID
const handleTrade = (req, res) => {
  let json = req.body
  tradeRecord = json
  if (json.auth_id === AUTH_ID) {
    executeTrade(json)

    //Update TradeHistory File
    tradeHistoryFile = readTradeHistoryFile()
    tradeRecord.tradeTime = new Date()
    console.log(tradeRecord)
    tradeHistoryFile.trades.push(tradeRecord)
    writeTradeHistoryFile(tradeHistoryFile)

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
    console.log('setting TSLP after retracement of', trailingStopLossTarget + '...')
    try {
      await exchange.v2_private_post_position_trading_stop({
        symbol: TICKER_BASE + TICKER_QUOTE,
        trailing_stop: Math.round(trailingStopLossTarget * 100) / 100
      })
    } catch { return console.log('ERROR SETTING TSLP, MAYBE NO OPEN POSITION?') }
  } else { return }
}


//
// === Trade execution ===
//

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

// Important for determining reversal logic
let lastTradeDirection = undefined

// If limit order, wait this many seconds until next async function
const limitOrderFillDelay = async (orderType, limit_cancel_time_seconds) => {
  if (orderType == 'limit' && limit_cancel_time_seconds) {
    console.log('initializing', limit_cancel_time_seconds, 'second delay...')
    let limitCancelTimeMilliSeconds = limit_cancel_time_seconds * 1000
    return await new Promise(resolve => setTimeout(resolve, limitCancelTimeMilliSeconds));
  } else { return }
}

// If using limit orders, close unfilled limit orders
const cancelUnfilledLimitOrders = async () => {
  try {
    console.log('closing unfilled orders...')
    await exchange.cancelAllOrders(TICKER)
  } catch (error) { return console.log('ERROR CLOSING UNFILLED ORDERS') }
}

// Execute the proper trade
const executeTrade = async (json) => {
  'use strict' // Locally-scoped safety

  try {
    // ltpp = limit take profit %, mtpp = market take profit %, slp = stop loss %, tslp = trailing stop loss %
    // IMPORTANT: LEVERAGE NEEDS TO MANUALLY BE SET IN BYBIT AS WELL!!!
    let {action, override, override_ltpp, order_type, limit_backtrace_percent, limit_cancel_time_seconds, ltpp, mtpp, slp, tslp, leverage} = json
    mtpp = parseFloat(mtpp * .01) // To percent
    slp = parseFloat(slp * .01) // To percent
    tslp = parseFloat(tslp * .01) // To percent
    limit_backtrace_percent = parseFloat(limit_backtrace_percent * .01) // To percent

    override_ltpp = true // TEMPORARY UNTIL I FIX THIS ISSUE!!!!!

    // Check balances and use that in the trade
    let { balances, tickerDetails, quotePrice, freeBaseBalance, usedBaseBalance } = await getBalances()
    let freeContractQty = Math.floor(freeBaseBalance * quotePrice * leverage * .95) // .95 so we have enough funds
    let usedContractQty = Math.floor(usedBaseBalance * quotePrice * leverage)
    let orderType = (order_type == 'market' || 'limit') ? order_type : undefined
    let limitOrderQuotePrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? quotePrice * (1 - limit_backtrace_percent) : quotePrice * (1 + limit_backtrace_percent)
    let orderQuotePrice = orderType == 'market' || !orderType ? quotePrice : limitOrderQuotePrice // Limit orders are placed at a different price than market orders
    let trailingStopLossTarget = tslp ? orderQuotePrice * tslp : undefined
    console.log('===')
    console.log('free', TICKER_BASE, freeBaseBalance)
    console.log('used', TICKER_BASE, usedBaseBalance)
    console.log(TICKER, 'price', quotePrice)
    tradeRecord.enterPrice = quotePrice

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

    const shortEntry = async () => {
        console.log('firing off shortEntry...')
        let tradeParams = handleTradeParams()
        switch (EXCHANGE) {
          case 'bybit':
            if (orderType == 'market') {
              if (usedContractQty > 0) {
                tradeParams = {} // When market reversing, can't have stop losses
                if (mtpp || slp) {
                  console.log('NOTE: Cannot set slp or mtpp with market order reversals. Use tslp and ltpp instead.')
                }
              }
              try {
              let orderQty
              if (lastTradeDirection && lastTradeDirection == 'short' && (action == 'short_entry' || action == 'reverse_long_to_short')) {
                orderQty = freeContractQty // If the last trade was in this same direction, you might have an open position, so this will add to it with your freeContractQty
              } else {
                orderQty = usedContractQty > 0 ? (usedContractQty + freeContractQty) * 1.85 : freeContractQty // If market reversal order, fully reverse position in one action to save on fees
              }
                await exchange.createOrder(TICKER, orderType, 'sell', orderQty, orderQuotePrice, tradeParams)
              .then( () => lastTradeDirection = 'short' )
            } catch {
                console.log('ERROR PLACING A SHORT MARKET ENTRY: Performing emergency exit in case you were reversing')
                await longMarketExit()
                return
              }
            } else if (orderType == 'limit') { // If limit, position already closed so get new Qty amounts
              let refreshedBalances = await getBalances()
              let refreshedQuotePrice = refreshedBalances.quotePrice
              let refreshedFreeContractQty = Math.floor(refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage * .95) // .95 so we have enough funds
              if (refreshedFreeContractQty > 0) {
                try {
                  await exchange.createOrder(TICKER, orderType, 'sell', refreshedFreeContractQty, refreshedQuotePrice, tradeParams)
                .then( () => lastTradeDirection = 'short' )
              } catch { return console.log('ERROR PLACING A SHORT LIMIT ENTRY') }
              } else { console.log('orderType=' + orderType, 'LIMIT ENTRY ORDER CANCELED, ALREADY AN OPEN POSITION?') }
            }
            break
        // Add more exchanges here
        }
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
              } catch (error) { return console.log('ERROR PLACING A SHORT MARKET EXIT') }
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
            } catch (error) { return console.log('ERROR PLACING A SHORT MARKET EXIT') }
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const setShortLimitExit = async (override_ltpp) => {
      if (override_ltpp || (override_ltpp == undefined && freeContractQty > usedContractQty) ) { // If not using override_ltpp, will not set new ltpp targets if a new order comes in when a position is already open
        console.log('firing off setShortLimitExit...')
        let tradeParams = {} // Can't have TP/SL params on an exit order
        let refreshedBalances = await getBalances() // Once an order is placed, we need the new usedContractQty to know for setting the limit exit
        let refreshedQuotePrice = refreshedBalances.quotePrice
        let refreshedUsedContractQty = Math.floor(refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage)
        if (ltpp && ltpp.length > 0) {
            ltpp.forEach( async (limitTakeProfitValue) => { // Passes in the value in the array, e.g. 0.2
            let limitTakeProfitPercent = parseFloat(limitTakeProfitValue * .01) // Convert the value to percent
              let limitTakeProfitPrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? orderQuotePrice * (1 - limitTakeProfitPercent) : orderQuotePrice * (1 + limitTakeProfitPercent) // TP values are based off entry price, not price at time of limit_cancel_time_seconds
            let exitOrderContractQty = Math.floor(refreshedUsedContractQty / ltpp.length) // Evenly distribute limit take profit targets
            if (refreshedUsedContractQty > 0) {
              console.log('setting limit exit at', limitTakeProfitPrice, 'using', exitOrderContractQty, 'contracts: about', ((1 / ltpp.length) * 100) + '%', 'of the stack...')
              switch (EXCHANGE) {
                case 'bybit':
                  try {
                    tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
                    await exchange.createOrder(TICKER, 'limit', 'buy', exitOrderContractQty, limitTakeProfitPrice, tradeParams)
                  } catch (error) { return console.log('ERROR PLACING A SHORT LIMIT EXIT') }
                  break
                // Add more exchanges here
              }
            } else { console.log('orderType=' + orderType, 'LIMIT EXIT ORDER CANCELED, MAYBE NO POSIITON TO PLACE IT ON?') }
          })
        } else { console.log('(Not using limit exits, no limit exits set)') }
      } else { console.log('Not using override_ltpp, and you have an open position: ltpp targets not replaced') }
    }

    const longEntry = async () => {
        console.log('firing off longEntry...')
        let tradeParams = handleTradeParams()
        switch (EXCHANGE) {
          case 'bybit':
            if (orderType == 'market') {
              if (usedContractQty > 0) {
                tradeParams = {} // When market reversing, can't have stop losses
                if (mtpp || slp) {
                  console.log('NOTE: Cannot set slp or mtpp with market order reversals. Use tslp and ltpp instead.')
                }
              }
              try {
              let orderQty
              if (lastTradeDirection && lastTradeDirection == 'long' && (action == 'long_entry' || action == 'reverse_short_to_long')) {
                orderQty = freeContractQty // If the last trade was in this same direction, you might have an open position, so this will add to it with your freeContractQty
              } else {
                orderQty = usedContractQty > 0 ? (usedContractQty + freeContractQty) * 1.85 : freeContractQty // If market reversal order, fully reverse position in one action to save on fees
              }
                await exchange.createOrder(TICKER, orderType, 'buy', orderQty, orderQuotePrice, tradeParams)
              .then( () => lastTradeDirection = 'long' )
            } catch {
                console.log('ERROR PLACING A LONG MARKET ENTRY: Performing emergency exit in case you were reversing')
                await shortMarketExit()
                return
              }
            } else if (orderType == 'limit') { // If limit, position already closed so get new Qty amounts
              let refreshedBalances = await getBalances()
              let refreshedQuotePrice = refreshedBalances.quotePrice
              let refreshedFreeContractQty = Math.floor(refreshedBalances.freeBaseBalance * refreshedQuotePrice * leverage * .95) // .95 so we have enough funds
              if (refreshedFreeContractQty > 0) {
                try {
                  await exchange.createOrder(TICKER, orderType, 'buy', refreshedFreeContractQty, refreshedQuotePrice, tradeParams)
                .then( () => lastTradeDirection = 'long' )
              } catch { return console.log('ERROR PLACING A LONG LIMIT ENTRY') }
              } else { console.log('orderType=' + orderType, 'LIMIT ENTRY ORDER CANCELED, ALREADY AN OPEN POSITION?') }
            }
            break
        // Add more exchanges here
        }
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
              } catch (error) { return console.log('ERROR PLACING A LONG MARKET EXIT') }
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
            } catch (error) { return console.log('ERROR PLACING A LONG MARKET EXIT') }
            break
          // Add more exchanges here
        }
      } else { console.log('orderType=' + orderType, 'MARKET EXIT ORDER CANCELED, MAYBE NO ORDER TO CLOSE?') }
    }

    const setLongLimitExit = async (override_ltpp) => {
      if (override_ltpp || (override_ltpp == undefined && freeContractQty > usedContractQty) ) { // If not using override_ltpp, will not set new ltpp targets if a new order comes in when a position is already open
        console.log('firing off setLongLimitExit...')
        let tradeParams = {} // Can't have TP/SL params on an exit order
        let refreshedBalances = await getBalances() // Once an order is placed, we need the new usedContractQty to know for setting the limit exit
        let refreshedQuotePrice = refreshedBalances.quotePrice
        let refreshedUsedContractQty = Math.floor(refreshedBalances.usedBaseBalance * refreshedQuotePrice * leverage)
        if (ltpp && ltpp.length > 0) {
            ltpp.forEach( async (limitTakeProfitValue) => { // Passes in the value in the array, e.g. 0.2
            let limitTakeProfitPercent = parseFloat(limitTakeProfitValue * .01) // Convert the value to percent
              let limitTakeProfitPrice = (action == 'short_entry' || action == 'short_exit' || action == 'reverse_long_to_short') ? orderQuotePrice * (1 - limitTakeProfitPercent) : orderQuotePrice * (1 + limitTakeProfitPercent) // TP values are based off entry price, not price at time of limit_cancel_time_seconds
            let exitOrderContractQty = Math.floor(refreshedUsedContractQty / ltpp.length) // Evenly distribute limit take profit targets
            if (refreshedUsedContractQty > 0) {
              console.log('setting limit exit at', limitTakeProfitPrice, 'using', exitOrderContractQty, 'contracts: about', ((1 / ltpp.length) * 100) + '%', 'of the stack...')
              switch (EXCHANGE) {
                case 'bybit':
                  try {
                    tradeParams.close_on_trigger = true // In bybit, must make a 'counter order' to close out open positions
                    await exchange.createOrder(TICKER, 'limit', 'sell', exitOrderContractQty, limitTakeProfitPrice, tradeParams)
                  } catch (error) { return console.log('ERROR PLACING A SHORT LIMIT EXIT') }
                  break
                // Add more exchanges here
              }
            } else { console.log('orderType=' + orderType, 'LIMIT EXIT ORDER CANCELED, MAYBE NO POSIITON TO PLACE IT ON?') }
          })
        } else { console.log('(Not using limit exits, no limit exits set)') }
      } else { console.log('Not using override_ltpp, and you have an open position: ltpp targets not replaced') }
    }


    // TODO: setting limit exits still happens on preexisting orders (it sets a new one)

    // TODO: DRY on refreshedBalances refreshedQuotePrice refreshedFreeContractQty refreshedUsedContractQty
    // TODO figure out why ".02" limit_backtrace_percent works but not "2", im place orders at a way different entry price?


    // Decides what action to take with the received signal
    const tradeParser = async () => {
      console.log('lastTradeDirection=' + lastTradeDirection)
      if (action == 'set_new_tslp') {
        console.log('NEW COMMAND: SET NEW TSLP')
        await setBybitTslp(trailingStopLossTarget)
        .catch( (error) => console.log(error) )
      } else {
        switch (action) {
          case 'short_entry':
            if (!lastTradeDirection || lastTradeDirection == 'long' || override) { // Prevents repeat actions but lets you override
              console.log('NEW COMMAND: SHORT ENTRY')
              await shortEntry()
                .then(() => limitOrderFillDelay(orderType, limit_cancel_time_seconds))
                .then(() => cancelUnfilledLimitOrders())
                .then(() => setBybitTslp(trailingStopLossTarget))
              .then( () => setShortLimitExit(override_ltpp) )
                .catch((error) => console.log(error))
            } else { console.log('SHORT ENTRY PREVENTED BECAUSE LAST ENTRY WAS ALSO SHORT') }
            break
          case 'short_exit':
            if (!lastTradeDirection || lastTradeDirection == 'short' || override) { // Prevents repeat actions but lets you override
              console.log('NEW COMMAND: SHORT MARKET EXIT')
              await shortMarketExit()
              .catch( (error) => console.log(error) )
            } else { console.log('SHORT EXIT PREVENTED BECAUSE LAST ENTRY WAS LONG') }
            break
          case 'long_entry':
            if (!lastTradeDirection || lastTradeDirection == 'short' || override) { // Prevents repeat actions but lets you override
              console.log('NEW COMMAND: LONG ENTRY')
              await longEntry()
                .then(() => limitOrderFillDelay(orderType, limit_cancel_time_seconds))
                .then(() => cancelUnfilledLimitOrders())
                .then(() => setBybitTslp(trailingStopLossTarget))
              .then( () => setLongLimitExit(override_ltpp) )
                .catch((error) => console.log(error))
            } else { console.log('LONG ENTRY PREVENTED BECAUSE LAST ENTRY WAS ALSO LONG') }
            break
          case 'long_exit':
            if (!lastTradeDirection || lastTradeDirection == 'long' || override) { // Prevents repeat actions but lets you override
              console.log('NEW COMMAND: LONG MARKET EXIT')
              await longMarketExit()
              .catch( (error) => console.log(error) )
            } else { console.log('LONG EXIT PREVENTED BECAUSE LAST ENTRY WAS SHORT') }
            break
          case 'reverse_short_to_long':
            if (!lastTradeDirection || lastTradeDirection == 'short' || override) { // Prevents repeat actions but lets you override
              console.log('NEW COMMAND: REVERSE SHORT TO LONG')
              await Promise.resolve()
              .then( () => { order_type == 'limit' ? shortMarketExit() : Promise.resolve() } ) // Market orders conduct exit+entry in one action, while limits use 2 actions
                .then(() => longEntry())
                .then(() => limitOrderFillDelay(orderType, limit_cancel_time_seconds))
                .then(() => cancelUnfilledLimitOrders())
                .then(() => setBybitTslp(trailingStopLossTarget))
              .then( () => setLongLimitExit(override_ltpp) )
                .catch((error) => console.log(error))
            } else { console.log('REVERSE SHORT TO LONG PREVENTED BECAUSE LAST ENTRY WAS ALSO LONG') }
            break
          case 'reverse_long_to_short':
            if (!lastTradeDirection || lastTradeDirection == 'long' || override) { // Prevents repeat actions but lets you override
              console.log('NEW COMMAND: REVERSE LONG TO SHORT')
              await Promise.resolve()
              .then( () => { order_type == 'limit' ? longMarketExit() : Promise.resolve() } ) // Market orders conduct exit+entry in one action, while limits use 2 actions
                .then(() => shortEntry())
                .then(() => limitOrderFillDelay(orderType, limit_cancel_time_seconds))
                .then(() => cancelUnfilledLimitOrders())
                .then(() => setBybitTslp(trailingStopLossTarget))
              .then( () => setShortLimitExit(override_ltpp) )
                .catch((error) => console.log(error))
            } else { console.log('REVERSE LONG TO SHORT PREVENTED BECAUSE LAST ENTRY WAS ALSO SHORT') }
            break
          default:
            console.log('Invalid action')
        }
    }
    }

    tradeParser() // Executes the correct trade
  } catch (error) {
    console.log('EXECUTETRADE ERROR:', error)
  }
}
