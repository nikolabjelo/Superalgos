﻿exports.newTradingSimulation = function newTradingSimulation(bot, logger, UTILITIES) {

    const FULL_LOG = true;
    const LOG_FILE_CONTENT = false;
    const ONE_DAY_IN_MILISECONDS = 24 * 60 * 60 * 1000;
    const MODULE_NAME = "Trading Simulation -> " + bot.SESSION.name;
    
    const GMT_SECONDS = ':00.000 GMT+0000';

    let thisObject = {
        finalize: finalize,
        runSimulation: runSimulation 
    };

    let utilities = UTILITIES.newCloudUtilities(bot, logger);

    return thisObject;

    function finalize() {
        thisObject = undefined
    }

    function runSimulation(
        chart,
        dataDependencies,
        timeFrame,
        timeFrameLabel,
        currentDay,
        variable,
        exchangeAPI,
        callback,
        callBackFunction) {

        try {
            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> Entering function."); }
            let processingDailyFiles
            if (timeFrame > global.dailyFilePeriods[0][0]) {
                processingDailyFiles = false
            } else {
                processingDailyFiles = true
            }

            let recordsArray = [];
            let conditionsArray = [];
            let strategiesArray = [];
            let tradesArray = [];

            let tradingSystem = bot.TRADING_SYSTEM 

            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> bot.VALUES_TO_USE.timeRange.initialDatetime = " + bot.VALUES_TO_USE.timeRange.initialDatetime); }
            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> bot.VALUES_TO_USE.timeRange.finalDatetime = " + bot.VALUES_TO_USE.timeRange.finalDatetime); }

            let timerToCloseStage = 0

            /* Stop Loss Management */
            const MIN_STOP_LOSS_VALUE = 1 // We can not let the stop be zero to avoid division by 0 error or infinity numbers as a result.
            const MAX_STOP_LOSS_VALUE = Number.MAX_SAFE_INTEGER

            /* Take Profit Management */
            const MIN_TAKE_PROFIT_VALUE = 1 // We can not let the buy order be zero to avoid division by 0 error or infinity numbers as a result.
            const MAX_TAKE_PROFIT_VALUE = Number.MAX_SAFE_INTEGER

            /* Variables for this executioin only */
            let takePositionNow = false
            let closePositionNow = false

            /* In some cases we need to know if we are positioned at the last candle of the calendar day, for that we need these variables. */
            let lastInstantOfTheDay = 0
            if (currentDay) {
                lastInstantOfTheDay = currentDay.valueOf() + ONE_DAY_IN_MILISECONDS - 1;
            }

            if (variable.isInitialized !== true) { 

                variable.isInitialized = true

                variable.initial = {}   // Everything in here means the status at the begining of the episode.
                variable.current = {}   // Everything in here means that is happening right now.
                variable.last = {}      // Everything in here means that it already happened.
                variable.minimun = {}   // Everything in here means the minimun in the whole episode.
                variable.maximun = {}   // Everything in here means the maximun in the whole episode.
                variable.previous = {}  // Everything in here means the the value that was current before a new current value was set.
                variable.distance = {}  // Everything in here means the distance, measured in periods to whatever happened in the past, usually events.

                variable.episode = {    // An Episode represents each execution of the Simulation
                    baseAsset: bot.VALUES_TO_USE.baseAsset,
                    quotedAsset: bot.VALUES_TO_USE.quotedAsset,
                    marketBaseAsset: bot.market.baseAsset,
                    marketQuotedAsset: bot.market.quotedAsset,
                    profitLoss: 0,
                    tradesCount: 0,
                    fails: 0,
                    hits: 0,
                    hitRatio: 0,
                    periods: 0,
                    days: 0,
                    ROI: 0,
                    anualizedRateOfReturn: 0
                }

                variable.previous.balance.baseAsset = 0
                variable.previous.balance.quotedAsset = 0

                inializeCurrentStrategy()
                initializeCurrentPosition() 

                variable.current.balance.baseAsset = bot.VALUES_TO_USE.initialBalanceA
                variable.current.balance.quotedAsset = bot.VALUES_TO_USE.initialBalanceB

                variable.initial.balance.baseAsset = bot.VALUES_TO_USE.initialBalanceA
                variable.minimum.balance.baseAsset = bot.VALUES_TO_USE.minimumBalanceA
                variable.maximum.balance.baseAsset = bot.VALUES_TO_USE.maximumBalanceA

                variable.initial.balance.quotedAsset = bot.VALUES_TO_USE.initialBalanceB
                variable.minimum.balance.quotedAsset = bot.VALUES_TO_USE.minimumBalanceB
                variable.maximum.balance.quotedAsset = bot.VALUES_TO_USE.maximumBalanceB

                variable.last.position = {
                    profitLoss: 0,
                    ROI: 0
                }

                variable.distance.toEvent = {
                    triggerOn: 0,
                    triggerOff: 0,
                    takePosition: 0,
                    closePosition: 0
                }

                variable.announcements = []

            } 

            function inializeCurrentStrategy() {
                variable.current.strategy = {
                    index: -1,
                    stage: 'No Stage',
                    begin: 0,
                    end: 0,
                    status: 0,
                    number: 0,
                    beginRate: 0,
                    endRate: 0,
                    situationName: ''
                }
            }

            function initializeCurrentPosition() {
                variable.current.position = {
                    begin: 0,
                    end: 0,
                    rate: 0,
                    size: 0,
                    stopLoss: 0,
                    takeProfit: 0,
                    status: 0,
                    profit: 0,
                    exitType: 0,
                    beginRate: 0,
                    endRate: 0,
                    periods: 0,
                    situationName: '',
                    stopLossPhase: -1,
                    stopLossStage: 'No Stage',
                    takeProfitPhase: -1,
                    takeProfitStage: 'No Stage'
                }
            }

            /* Main Array and Maps */
            let propertyName = 'at' + timeFrameLabel.replace('-', '');
            let candles = chart[propertyName].candles
            let currentChart = chart[propertyName]

            /* Last Candle */
            let lastCandle = candles[candles.length - 1];

            /* Main Simulation Loop: We go thourgh all the candles at this time period. */
            let currentCandleIndex

            /* For Loop Level heartbeat */
            let loopingDay
            let previousLoopingDay

            initializeLoop()

            function initializeLoop() {
                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> initializeLoop -> Entering function."); }

                /* Estimate Initial Candle */

                let firstEnd = candles[0].end
                let targetEnd = bot.VALUES_TO_USE.timeRange.initialDatetime.valueOf()
                let diff = targetEnd - firstEnd
                let amount = diff / timeFrame

                currentCandleIndex = Math.trunc(amount)
                if (currentCandleIndex < 0) { currentCandleIndex = 0 }
                if (currentCandleIndex > candles.length - 1) {
                    /* This will happen when the bot.VALUES_TO_USE.timeRange.initialDatetime is beyond the last candle available, meaning that the dataSet needs to be updated with more up-to-date data. */
                    currentCandleIndex = candles.length - 1
                }

                loop()
            }

            function loop() {

                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Entering function."); }
                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Processing candle # " + currentCandleIndex); }

                let announcementsToBeMade = []
                let candle = candles[currentCandleIndex];

                /* Not processing while out of user-defined time range */

                if (candle.end < bot.VALUES_TO_USE.timeRange.initialDatetime.valueOf()) {
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Skipping Candle before the bot.VALUES_TO_USE.timeRange.initialDatetime."); }
                    controlLoop();
                    return
                }
                if (candle.begin > bot.VALUES_TO_USE.timeRange.finalDatetime.valueOf()) {
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Skipping Candle after the bot.VALUES_TO_USE.timeRange.finalDatetime."); }
                    afterLoop();
                    return
                }

                /* Here we update at the chart data structure the objects for each product representing where we are currently standing at the simulation loop */
                if (processingDailyFiles) {
                    for (let j = 0; j < global.dailyFilePeriods.length; j++) {

                        let mapKey = dailyFilePeriods[j][1]
                        let propertyName = 'at' + mapKey.replace('-', '');
                        let thisChart = chart[propertyName]

                        for (let k = 0; k < dataDependencies.length; k++) {
                            let dataDependencyNode = dataDependencies[k] 
                            if (dataDependencyNode.referenceParent.code.codeName !== 'Multi-Period-Daily') { continue }
                            let singularVariableName = dataDependencyNode.referenceParent.parentNode.code.singularVariableName
                            let pluralVariableName = dataDependencyNode.referenceParent.parentNode.code.pluralVariableName
                            let currentElement = getElement(thisChart[pluralVariableName], candle, 'Daily' + '-' + mapKey + '-' + pluralVariableName)
                            thisChart[singularVariableName] = currentElement
                        }
                    }
                }

                /* Finding the Current Element on Market Files */
                for (let j = 0; j < global.marketFilesPeriods.length; j++) {

                    let mapKey = marketFilesPeriods[j][1]
                    let propertyName = 'at' + mapKey.replace('-', '');
                    let thisChart = chart[propertyName]

                    for (let k = 0; k < dataDependencies.length; k++) {
                        let dataDependencyNode = dataDependencies[k]
                        if (dataDependencyNode.referenceParent.code.codeName !== 'Multi-Period-Market') {continue}
                        let singularVariableName = dataDependencyNode.referenceParent.parentNode.code.singularVariableName
                        let pluralVariableName = dataDependencyNode.referenceParent.parentNode.code.pluralVariableName
                        let currentElement = getElement(thisChart[pluralVariableName], candle, 'Market' + '-' + mapKey + '-' + pluralVariableName)
                        thisChart[singularVariableName] = currentElement
                    }
                }

                /* Finding the Current Element on Single Files */
                function isItInside(elementWithTimestamp, elementWithBeginEnd) {
                    if (elementWithTimestamp.timestamp >= elementWithBeginEnd.begin && elementWithTimestamp.timestamp <= elementWithBeginEnd.end) {
                        return true
                    } else {
                        return false
                    }
                }

                let propertyName = 'atAnyTimeFrame' 
                let thisChart = chart[propertyName]

                for (let k = 0; k < dataDependencies.length; k++) {
                    let dataDependencyNode = dataDependencies[k]
                    if (dataDependencyNode.referenceParent.code.codeName !== 'Single-File') { continue }
                    let singularVariableName = dataDependencyNode.referenceParent.parentNode.code.singularVariableName
                    let pluralVariableName = dataDependencyNode.referenceParent.parentNode.code.pluralVariableName
                    let elementArray = thisChart[pluralVariableName]
                    let currentElement
                    if (elementArray !== undefined) {
                        currentElement = elementArray[elementArray.length - 1]
                    }
                    thisChart[singularVariableName] = currentElement
                }

                /* While we are processing the previous day. */
                let positionedAtYesterday = false
                if (currentDay) {
                    positionedAtYesterday = (candle.end < currentDay.valueOf())
                }

                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Candle Begin @ " + (new Date(candle.begin)).toLocaleString()) }
                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Candle End @ " + (new Date(candle.end)).toLocaleString()) }

                let ticker = {
                    bid: candle.close,
                    ask: candle.close,
                    last: candle.close
                }

                /* We will produce a simulation level heartbeat in order to inform the user this is running. */

                loopingDay = new Date(Math.trunc(candle.begin / ONE_DAY_IN_MILISECONDS) * ONE_DAY_IN_MILISECONDS)
                if (loopingDay.valueOf() !== previousLoopingDay) {

                    let processingDate = loopingDay.getUTCFullYear() + '-' + utilities.pad(loopingDay.getUTCMonth() + 1, 2) + '-' + utilities.pad(loopingDay.getUTCDate(), 2);

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Simulation " + bot.sessionKey + " Loop # " + currentCandleIndex + " @ " + processingDate) }

                    /*  Telling the world we are alive and doing well */
                    let fromDate = new Date(bot.VALUES_TO_USE.timeRange.initialDatetime.valueOf())
                    let lastDate = new Date(bot.VALUES_TO_USE.timeRange.finalDatetime.valueOf())

                    let currentDateString = loopingDay.getUTCFullYear() + '-' + utilities.pad(loopingDay.getUTCMonth() + 1, 2) + '-' + utilities.pad(loopingDay.getUTCDate(), 2);
                    let currentDate = new Date(loopingDay)
                    let percentage = global.getPercentage(fromDate, currentDate, lastDate)
                    bot.processHeartBeat(currentDateString, percentage)

                    if (global.areEqualDates(currentDate, new Date()) === false) {
                        logger.newInternalLoop(bot.codeName, bot.process, currentDate, percentage);
                    }
                }
                previousLoopingDay = loopingDay.valueOf()

                variable.episode.periods++;
                variable.episode.days = variable.episode.periods * timeFrame / ONE_DAY_IN_MILISECONDS;

                if (processingDailyFiles) {

                    /* We skip the candle at the head of the market because currentCandleIndex has not closed yet. */
                    let candlesPerDay = ONE_DAY_IN_MILISECONDS / timeFrame
                    if (currentCandleIndex === candles.length - 1) {
                        if ((candles.length < candlesPerDay) || (candles.length > candlesPerDay && candles.length < candlesPerDay * 2)) {
                            /*We are at the head of the market, thus we skip the last candle because it has not close yet. */
                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Skipping Candle because it is the last one and has not been closed yet."); }
                            controlLoop();
                            return
                            /* Note here that in the last candle of the first day or the second day it will use an incomplete candle and partially calculated indicators.
                                if we skip these two variable.episode.periods, then there will be a hole in the file since the last period will be missing. */
                        }
                    }

                } else { // We are processing Market Files
                    if (currentCandleIndex === candles.length - 1) {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Skipping Candle because it is the last one and has not been closed yet."); }
                        controlLoop();
                        return
                    }
                }

                let conditions = new Map;       // Here we store the conditions values that will be use in the simulator for decision making.
                let formulas = new Map;
                let conditionsArrayRecord = []; // These are the records that will be saved in a file for the plotter to consume.
                let conditionsArrayValues = []; // Here we store the conditions values that will be written on file for the plotter.
                let formulasErrors = []; // Here we store the errors produced by all phase formulas.
                let formulasValues = []; // Here we store the values produced by all phase formulas.

                /* We define and evaluate all conditions to be used later during the simulation loop. */

                conditionsArrayRecord.push(candle.begin);
                conditionsArrayRecord.push(candle.end);

                for (let j = 0; j < tradingSystem.strategies.length; j++) {

                    let strategy = tradingSystem.strategies[j];

                    let positionSize = 0
                    let positionRate = 0

                    /* Continue with the rest of the formulas and conditions */

                    let triggerStage = strategy.triggerStage

                    if (triggerStage !== undefined) {

                        if (triggerStage.triggerOn !== undefined) {

                            for (let k = 0; k < triggerStage.triggerOn.situations.length; k++) {

                                let situation = triggerStage.triggerOn.situations[k];

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = j + '-' + 'triggerStage' + '-' + 'triggerOn' + '-' + k + '-' + m;

                                    if (condition.javascriptCode !== undefined) {
                                        newCondition(key, condition.javascriptCode, chart);
                                    }
                                }
                            }
                        }

                        if (triggerStage.triggerOff !== undefined) {

                            for (let k = 0; k < triggerStage.triggerOff.situations.length; k++) {

                                let situation = triggerStage.triggerOff.situations[k];

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = j + '-' + 'triggerStage' + '-' + 'triggerOff' + '-' + k + '-' + m;

                                    if (condition.javascriptCode !== undefined) {
                                        newCondition(key, condition.javascriptCode, chart);
                                    }
                                }
                            }
                        }

                        if (triggerStage.takePosition !== undefined) {

                            for (let k = 0; k < triggerStage.takePosition.situations.length; k++) {

                                let situation = triggerStage.takePosition.situations[k];

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = j + '-' + 'triggerStage' + '-' + 'takePosition' + '-' + k + '-' + m;

                                    if (condition.javascriptCode !== undefined) {
                                        newCondition(key, condition.javascriptCode, chart);
                                    }
                                }
                            }
                        }
                    }

                    let openStage = strategy.openStage

                    if (openStage !== undefined) {

                        /* Default Values*/
                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            positionSize = variable.current.balance.baseAsset;
                            positionRate = candle.close;
                        } else {
                            positionSize = variable.current.balance.quotedAsset;
                            positionRate = candle.close;
                        }

                        let initialDefinition = openStage.initialDefinition

                        if (initialDefinition !== undefined) {

                            if (variable.current.position.size !== 0) {
                                positionSize = variable.current.position.size
                            } else {
                                if (initialDefinition.positionSize !== undefined) {
                                    if (initialDefinition.positionSize.formula !== undefined) {
                                        try {
                                            positionSize = eval(initialDefinition.positionSize.formula.code);
                                        } catch (err) {
                                            initialDefinition.positionSize.formula.error = err.message
                                        }
                                        if (isNaN(positionSize)) {
                                            if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                                                positionSize = variable.current.balance.baseAsset;
                                            } else {
                                                positionSize = variable.current.balance.quotedAsset;
                                            }
                                        } else {
                                            if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                                                if (positionSize > variable.current.balance.baseAsset) { positionSize = variable.current.balance.baseAsset }
                                            } else {
                                                if (positionSize > variable.current.balance.quotedAsset) { positionSize = variable.current.balance.quotedAsset }
                                            }
                                        }
                                    }
                                }
                            }

                            if (variable.current.position.rate !== 0) {
                                positionRate = variable.current.position.rate
                            } else {
                                if (initialDefinition.positionRate !== undefined) {
                                    if (initialDefinition.positionRate.formula !== undefined) {
                                        try {
                                            positionRate = eval(initialDefinition.positionRate.formula.code);
                                        } catch (err) {
                                            initialDefinition.positionRate.formula.error = err.message
                                        }
                                        if (isNaN(positionRate)) {
                                            if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                                                positionRate = candle.close;
                                            } else {
                                                positionRate = candle.close;
                                            }
                                        }
                                    }
                                }
                            }

                            if (initialDefinition.stopLoss !== undefined) {

                                for (let p = 0; p < initialDefinition.stopLoss.phases.length; p++) {

                                    let phase = initialDefinition.stopLoss.phases[p];

                                    /* Evaluate Formula */
                                    let formulaValue
                                    let formulaError = ''

                                    if (phase.formula !== undefined) {
                                        try {
                                            formulaValue = eval(phase.formula.code);
                                            if (formulaValue === Infinity) {
                                                formulaError = "Formula evaluates to Infinity."
                                                formulaValue = MAX_STOP_LOSS_VALUE
                                                if (stopLossStage === 'Open Stage') {
                                                    formulaError = "WARNING: Formula evaluates to Infinity."
                                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> initialDefinition.stopLoss -> MAX_STOP_LOSS_VALUE -> formulaError = " + formulaError); }
                                                }
                                            }
                                        } catch (err) {
                                            if (phase.formula.code.indexOf('previous') > 0 && err.message.indexOf('of undefined') > 0) {
                                                /*
                                                    We are not going to set an error for the casess we are using previous and the error is that the indicator is undefined.
                                                */
                                            } else {
                                                formulaError = err.message
                                            }
                                        }
                                        if (isNaN(formulaValue)) { formulaValue = 0; }
                                        if (formulaValue < MIN_STOP_LOSS_VALUE) {
                                            formulaValue = MIN_STOP_LOSS_VALUE
                                            if (stopLossStage === 'Open Stage') {
                                                formulaError = "WARNING: Formula is evaluating below the MIN_STOP_LOSS_VALUE."
                                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> initialDefinition.stopLoss -> MIN_STOP_LOSS_VALUE -> formulaError = " + formulaError); }
                                            }
                                        }

                                        formulasErrors.push('"' + formulaError + '"')
                                        formulasValues.push(formulaValue)
                                        let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + p;
                                        formulas.set(key, formulaValue)
                                    }

                                    /* next phase event */
                                    let nextPhaseEvent = phase.nextPhaseEvent;
                                    if (nextPhaseEvent !== undefined) {

                                        for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                            let situation = nextPhaseEvent.situations[k];

                                            for (let m = 0; m < situation.conditions.length; m++) {

                                                let condition = situation.conditions[m];
                                                let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + p + '-' + k + '-' + m;

                                                if (condition.javascriptCode !== undefined) {
                                                    newCondition(key, condition.javascriptCode, chart);
                                                }
                                            }
                                        }
                                    }

                                    /* move to phase events */
                                    for (let n = 0; n < phase.moveToPhaseEvents.length; n++) {
                                        let moveToPhaseEvent = phase.moveToPhaseEvents[n];
                                        if (moveToPhaseEvent !== undefined) {

                                            for (let k = 0; k < moveToPhaseEvent.situations.length; k++) {

                                                let situation = moveToPhaseEvent.situations[k];

                                                for (let m = 0; m < situation.conditions.length; m++) {

                                                    let condition = situation.conditions[m];
                                                    let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + p + '-' + n + '-' + k + '-' + m;

                                                    if (condition.javascriptCode !== undefined) {
                                                        newCondition(key, condition.javascriptCode, chart);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }

                            if (initialDefinition.takeProfit !== undefined) {

                                for (let p = 0; p < initialDefinition.takeProfit.phases.length; p++) {

                                    let phase = initialDefinition.takeProfit.phases[p];

                                    /* Evaluate Formula */
                                    let formulaValue
                                    let formulaError = ''

                                    if (phase.formula !== undefined) {
                                        try {
                                            formulaValue = eval(phase.formula.code);
                                            if (formulaValue === Infinity) {
                                                formulaValue = MAX_TAKE_PROFIT_VALUE
                                                if (takeProfitStage === 'Open Stage') {
                                                    formulaError = "WARNING: Formula evaluates to Infinity."
                                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> initialDefinition.takeProfit -> MAX_TAKE_PROFIT_VALUE -> formulaError = " + formulaError); }
                                                }
                                            }
                                        } catch (err) {
                                            if (phase.formula.code.indexOf('previous') > 0 && err.message.indexOf('of undefined') > 0) {
                                                /*
                                                    We are not going to set an error for the casess we are using previous and the error is that the indicator is undefined.
                                                */
                                            } else {
                                                formulaError = err.message
                                            }
                                        }
                                        if (isNaN(formulaValue)) { formulaValue = 0; }
                                        if (formulaValue < MIN_TAKE_PROFIT_VALUE) {
                                            formulaValue = MIN_TAKE_PROFIT_VALUE
                                            if (takeProfitStage === 'Open Stage') {
                                                formulaError = "WARNING: Formula is evaluating below the MIN_TAKE_PROFIT_VALUE."
                                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> initialDefinition.takeProfit -> MIN_TAKE_PROFIT_VALUE -> formulaError = " + formulaError); }
                                            }
                                        }

                                        formulasErrors.push('"' + formulaError + '"')
                                        formulasValues.push(formulaValue)
                                        let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + p;
                                        formulas.set(key, formulaValue)
                                    }

                                    /* next phase event */
                                    let nextPhaseEvent = phase.nextPhaseEvent;
                                    if (nextPhaseEvent !== undefined) {

                                        for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                            let situation = nextPhaseEvent.situations[k];

                                            for (let m = 0; m < situation.conditions.length; m++) {

                                                let condition = situation.conditions[m];
                                                let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + p + '-' + k + '-' + m;

                                                if (condition.javascriptCode !== undefined) {
                                                    newCondition(key, condition.javascriptCode, chart);
                                                }
                                            }
                                        }
                                    }

                                    /* move to phase events */
                                    for (let n = 0; n < phase.moveToPhaseEvents.length; n++) {
                                        let moveToPhaseEvent = phase.moveToPhaseEvents[n];
                                        if (moveToPhaseEvent !== undefined) {

                                            for (let k = 0; k < moveToPhaseEvent.situations.length; k++) {

                                                let situation = moveToPhaseEvent.situations[k];

                                                for (let m = 0; m < situation.conditions.length; m++) {

                                                    let condition = situation.conditions[m];
                                                    let key = j + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + p + '-' + n + '-' + k + '-' + m;

                                                    if (condition.javascriptCode !== undefined) {
                                                        newCondition(key, condition.javascriptCode, chart);
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        strategy.positionSize = positionSize
                        strategy.positionRate = positionRate
                    }

                    let manageStage = strategy.manageStage

                    if (manageStage !== undefined) {

                        if (manageStage.stopLoss !== undefined) {

                            for (let p = 0; p < manageStage.stopLoss.phases.length; p++) {

                                let phase = manageStage.stopLoss.phases[p];

                                /* Evaluate Formula */
                                let formulaValue
                                let formulaError = ''

                                if (phase.formula !== undefined) {
                                    try {
                                        formulaValue = eval(phase.formula.code);
                                        if (formulaValue === Infinity) {
                                            formulaError = ""
                                            formulaValue = MAX_STOP_LOSS_VALUE
                                            if (stopLossStage === 'Manage Stage') {
                                                formulaError = "WARNING: Formula evaluates to Infinity."
                                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> manageStage.stopLoss -> MAX_STOP_LOSS_VALUE -> formulaError = " + formulaError); }
                                            }
                                        }
                                    } catch (err) {
                                        if (phase.formula.code.indexOf('previous') > 0 && err.message.indexOf('of undefined') > 0) {
                                            /*
                                                We are not going to set an error for the casess we are using previous and the error is that the indicator is undefined.
                                            */
                                        } else {
                                            formulaError = err.message
                                        }
                                    }
                                    if (isNaN(formulaValue)) { formulaValue = 0; }
                                    if (formulaValue < MIN_STOP_LOSS_VALUE) {
                                        formulaValue = MIN_STOP_LOSS_VALUE
                                        if (stopLossStage === 'Manage Stage') {
                                            formulaError = "WARNING: Formula is evaluating below the MIN_STOP_LOSS_VALUE."
                                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> manageStage.stopLoss -> MIN_STOP_LOSS_VALUE -> formulaError = " + formulaError); }
                                        }
                                    }

                                    formulasErrors.push('"' + formulaError + '"')
                                    formulasValues.push(formulaValue)
                                    let key = j + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + p;
                                    formulas.set(key, formulaValue)
                                }

                                /* next phase event */
                                let nextPhaseEvent = phase.nextPhaseEvent;
                                if (nextPhaseEvent !== undefined) {

                                    for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                        let situation = nextPhaseEvent.situations[k];

                                        for (let m = 0; m < situation.conditions.length; m++) {

                                            let condition = situation.conditions[m];
                                            let key = j + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + p + '-' + k + '-' + m;

                                            if (condition.javascriptCode !== undefined) {
                                                newCondition(key, condition.javascriptCode, chart);
                                            }
                                        }
                                    }
                                }

                                /* move to phase events */
                                for (let n = 0; n < phase.moveToPhaseEvents.length; n++) {
                                    let moveToPhaseEvent = phase.moveToPhaseEvents[n];
                                    if (moveToPhaseEvent !== undefined) {

                                        for (let k = 0; k < moveToPhaseEvent.situations.length; k++) {

                                            let situation = moveToPhaseEvent.situations[k];

                                            for (let m = 0; m < situation.conditions.length; m++) {

                                                let condition = situation.conditions[m];
                                                let key = j + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + p + '-' + n + '-' + k + '-' + m;

                                                if (condition.javascriptCode !== undefined) {
                                                    newCondition(key, condition.javascriptCode, chart);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        if (manageStage.takeProfit !== undefined) {

                            for (let p = 0; p < manageStage.takeProfit.phases.length; p++) {

                                let phase = manageStage.takeProfit.phases[p];

                                /* Evaluate Formula */
                                let formulaValue
                                let formulaError = ''

                                if (phase.formula !== undefined) {
                                    try {
                                        formulaValue = eval(phase.formula.code);
                                        if (formulaValue === Infinity) {
                                            formulaError = "Formula evaluates to Infinity."
                                            formulaValue = MAX_TAKE_PROFIT_VALUE
                                            if (takeProfitStage === 'Manage Stage') {
                                                formulaError = "WARNING: Formula evaluates to Infinity."
                                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> manageStage.takeProfit -> MAX_TAKE_PROFIT_VALUE -> formulaError = " + formulaError); }
                                            }
                                        }
                                    } catch (err) {
                                        if (phase.formula.code.indexOf('previous') > 0 && err.message.indexOf('of undefined') > 0) {
                                            /*
                                                We are not going to set an error for the casess we are using previous and the error is that the indicator is undefined.
                                            */
                                        } else {
                                            formulaError = err.message
                                        }
                                    }
                                    if (isNaN(formulaValue)) { formulaValue = 0; }
                                    if (formulaValue < MIN_TAKE_PROFIT_VALUE) {
                                        formulaValue = MIN_TAKE_PROFIT_VALUE
                                        if (takeProfitStage === 'Manage Stage') {
                                            formulaError = "WARNING: Formula is evaluating below the MIN_TAKE_PROFIT_VALUE."
                                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[WARN] runSimulation -> loop -> manageStage.takeProfit -> MIN_TAKE_PROFIT_VALUE -> formulaError = " + formulaError); }
                                        }
                                    }

                                    formulasErrors.push('"' + formulaError + '"')
                                    formulasValues.push(formulaValue)
                                    let key = j + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + p;
                                    formulas.set(key, formulaValue)
                                }

                                /* next phase event */
                                let nextPhaseEvent = phase.nextPhaseEvent;
                                if (nextPhaseEvent !== undefined) {

                                    for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                        let situation = nextPhaseEvent.situations[k];

                                        for (let m = 0; m < situation.conditions.length; m++) {

                                            let condition = situation.conditions[m];
                                            let key = j + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + p + '-' + k + '-' + m;

                                            if (condition.javascriptCode !== undefined) {
                                                newCondition(key, condition.javascriptCode, chart);
                                            }
                                        }
                                    }
                                }

                                /* move to phase events */
                                for (let n = 0; n < phase.moveToPhaseEvents.length; n++) {
                                    let moveToPhaseEvent = phase.moveToPhaseEvents[n];
                                    if (moveToPhaseEvent !== undefined) {

                                        for (let k = 0; k < moveToPhaseEvent.situations.length; k++) {

                                            let situation = moveToPhaseEvent.situations[k];

                                            for (let m = 0; m < situation.conditions.length; m++) {

                                                let condition = situation.conditions[m];
                                                let key = j + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + p + '-' + n + '-' + k + '-' + m;

                                                if (condition.javascriptCode !== undefined) {
                                                    newCondition(key, condition.javascriptCode, chart);
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }

                    function newCondition(key, node, chart) {

                        let condition;
                        let value

                        try {
                            value = eval(node.code);
                        } catch (err) {
                            /*
                                One possible error is that the conditions references a .previous that is undefined. For this
                                reason and others, we will simply set the value to false.
                            */
                            value = false

                            if (node.code.indexOf('previous') > -1 && err.message.indexOf('of undefined') > -1 ||
                                node.code.indexOf('chart') > -1 && err.message.indexOf('of undefined') > -1
                            ) {
                                /*
                                    We are not going to set an error for the casess we are using previous and the error is that the indicator is undefined.
                                */
                            } else {
                                node.error = err.message + " @ " + (new Date(candle.begin)).toLocaleString()
                            }
                        }

                        condition = {
                            key: key,
                            value: value
                        };

                        conditions.set(condition.key, condition);

                        if (condition.value) {
                            conditionsArrayValues.push(1);
                        } else {
                            conditionsArrayValues.push(0);
                        }
                    }
                }

                /* Trigger On Conditions */
                if (
                    variable.current.strategy.stage === 'No Stage' &&
                    variable.current.strategy.index === -1
                ) {
                    let minimumBalance
                    let maximumBalance
                    let balance

                    if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                        balance = variable.current.balance.baseAsset
                        minimumBalance = variable.minimum.balance.baseAsset
                        maximumBalance = variable.maximum.balance.baseAsset
                    } else {
                        balance = variable.current.balance.quotedAsset
                        minimumBalance = variable.minimum.balance.quotedAsset
                        maximumBalance = variable.maximum.balance.quotedAsset
                    }
                    
                    let stopRunningDate = new Date(candle.begin)
                    if (balance <= minimumBalance) {
                        tradingSystem.error = "Min Balance @ " + stopRunningDate.toLocaleString()
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> " + tradingSystem.error ); }
                        afterLoop()
                        return
                    }

                    if (balance >= maximumBalance) {
                        tradingSystem.error = "Max Balance @ " + stopRunningDate.toLocaleString()
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> " + tradingSystem.error); }
                        afterLoop()
                        return
                    }

                    /*
                    Here we need to pick a strategy, or if there is not suitable strategy for the current
                    market conditions, we pass until the next period.
                
                    To pick a new strategy we will evaluate what we call the trigger on. Once we enter
                    into one strategy, we will ignore market conditions for others. However there is also
                    a strategy trigger off which can be hit before taking a position. If hit, we would
                    be outside a strategy again and looking for the condition to enter all over again.
            
                    */

                    for (let j = 0; j < tradingSystem.strategies.length; j++) {

                        let strategy = tradingSystem.strategies[j];

                        let triggerStage = strategy.triggerStage

                        if (triggerStage !== undefined) {

                            if (triggerStage.triggerOn !== undefined) {

                                for (let k = 0; k < triggerStage.triggerOn.situations.length; k++) {

                                    let situation = triggerStage.triggerOn.situations[k];
                                    let passed = true;

                                    for (let m = 0; m < situation.conditions.length; m++) {

                                        let condition = situation.conditions[m];
                                        let key = j + '-' + 'triggerStage' + '-' + 'triggerOn' + '-' + k + '-' + m;

                                        let value = false
                                        if (conditions.get(key) !== undefined) {
                                            value = conditions.get(key).value;
                                        }

                                        if (value === false) { passed = false; }
                                    }

                                    if (passed) {

                                        variable.current.strategy.stage = 'Trigger Stage';
                                        checkAnnouncements(triggerStage)

                                        variable.current.strategy.index = j;
                                        variable.current.strategy.begin = candle.begin;
                                        variable.current.strategy.beginRate = candle.min;
                                        variable.current.strategy.endRate = candle.min; // In case the strategy does not get exited
                                        variable.current.strategy.situationName = situation.name

                                        variable.distance.toEvent.triggerOn = 1;

                                        checkAnnouncements(triggerStage.triggerOn)

                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Switching to Trigger Stage because conditions at Trigger On Event were met."); }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                     
                }

                /* Trigger Off Condition */
                if (variable.current.strategy.stage === 'Trigger Stage') {

                    let strategy = tradingSystem.strategies[strategyIndex];

                    let triggerStage = strategy.triggerStage

                    if (triggerStage !== undefined) {

                        if (triggerStage.triggerOff !== undefined) {

                            for (let k = 0; k < triggerStage.triggerOff.situations.length; k++) {

                                let situation = triggerStage.triggerOff.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = variable.current.strategy.index + '-' + 'triggerStage' + '-' + 'triggerOff' + '-' + k + '-' + m;

                                    let value = false
                                    if (conditions.get(key) !== undefined) {
                                        value = conditions.get(key).value;
                                    }

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    variable.current.strategy.number = variable.current.strategy.index
                                    variable.current.strategy.end = candle.end;
                                    variable.current.strategy.endRate = candle.min;
                                    variable.current.strategy.status = 1; // This means the strategy is closed, i.e. that has a begin and end.
                                    variable.current.strategy.stage = 'No Stage';
                                    variable.current.strategy.index = -1;

                                    variable.distance.toEvent.triggerOff = 1;

                                    checkAnnouncements(triggerStage.triggerOff)

                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Switching to No Stage because conditions at the Trigger Off Event were met."); }
                                    break;
                                }
                            }
                        }
                    }
                }

                /* Take Position Condition */
                if (variable.current.strategy.stage === 'Trigger Stage') {

                    let strategy = tradingSystem.strategies[strategyIndex];

                    let triggerStage = strategy.triggerStage

                    if (triggerStage !== undefined) {

                        if (triggerStage.takePosition !== undefined) {

                            for (let k = 0; k < triggerStage.takePosition.situations.length; k++) {

                                let situation = triggerStage.takePosition.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = variable.current.strategy.index + '-' + 'triggerStage' + '-' + 'takePosition' + '-' + k + '-' + m;

                                    let value = false
                                    if (conditions.get(key) !== undefined) {
                                        value = conditions.get(key).value;
                                    }

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    variable.current.strategy.stage = 'Open Stage';
                                    checkAnnouncements(strategy.openStage)

                                    variable.current.position.stopLossStage = 'Open Stage';
                                    variable.current.position.takeProfitStage = 'Open Stage';
                                    variable.current.position.stopLossPhase = 0;
                                    variable.current.position.takeProfitPhase = 0;

                                    takePositionNow = true
                                    variable.current.position.situationName = situation.name
                                    
                                    checkAnnouncements(triggerStage.takePosition)

                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Conditions at the Take Position Event were met."); }
                                    break;
                                }
                            }
                        }
                    }
                }

                /* Stop Loss Management */
                if (
                    (variable.current.strategy.stage === 'Open Stage' || variable.current.strategy.stage === 'Manage Stage') &&
                    takePositionNow !== true
                ) {

                    checkStopPhases()
                    calculateStopLoss();

                }

                function checkStopPhases() {

                    let strategy = tradingSystem.strategies[strategyIndex];

                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let parentNode
                    let j = variable.current.strategy.index
                    let stageKey
                    let initialDefinitionKey = ''
                    let p

                    if (stopLossStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.stopLoss !== undefined) {
                                parentNode = openStage.initialDefinition
                                initialDefinitionKey = '-' + 'initialDefinition'
                                stageKey = 'openStage'
                                p = variable.current.position.stopLossPhase
                            }
                        }
                    }

                    if (stopLossStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.stopLoss !== undefined) {
                            parentNode = manageStage
                            stageKey = 'manageStage'
                            p = variable.current.position.stopLossPhase - 1
                        }
                    }

                    if (parentNode !== undefined) {
                        let phase = parentNode.stopLoss.phases[p];

                        /* Check the next Phase Event. */
                        let nextPhaseEvent = phase.nextPhaseEvent;
                        if (nextPhaseEvent !== undefined) {

                            for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                let situation = nextPhaseEvent.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = j + '-' + stageKey + initialDefinitionKey + '-' + 'stopLoss' + '-' + p + '-' + k + '-' + m;

                                    let value = false
                                    if (conditions.get(key) !== undefined) {
                                        value = conditions.get(key).value;
                                    }

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    variable.current.position.stopLossPhase++;
                                    variable.current.position.stopLossStage = 'Manage Stage'
                                    if (takeProfitPhase > 0) {
                                        variable.current.strategy.stage = 'Manage Stage'
                                        checkAnnouncements(manageStage, 'Take Profit')
                                    }

                                    checkAnnouncements(nextPhaseEvent)
                                    return;
                                }
                            }
                        }

                        /* Check the Move to Phase Events. */
                        for (let n = 0; n < phase.moveToPhaseEvents.length; n++) {
                            let moveToPhaseEvent = phase.moveToPhaseEvents[n];
                            if (moveToPhaseEvent !== undefined) {

                                for (let k = 0; k < moveToPhaseEvent.situations.length; k++) {

                                    let situation = moveToPhaseEvent.situations[k];
                                    let passed = true;

                                    for (let m = 0; m < situation.conditions.length; m++) {

                                        let condition = situation.conditions[m];
                                        let key = j + '-' + stageKey + initialDefinitionKey + '-' + 'stopLoss' + '-' + p + '-' + n + '-' + k + '-' + m;

                                        let value = false
                                        if (conditions.get(key) !== undefined) {
                                            value = conditions.get(key).value;
                                        }

                                        if (value === false) { passed = false; }
                                    }

                                    if (passed) {

                                        let moveToPhase = moveToPhaseEvent.referenceParent
                                        if (moveToPhase !== undefined) {
                                            for (let q = 0; q < parentNode.stopLoss.phases.length; q++) {
                                                if (parentNode.stopLoss.phases[q].id === moveToPhase.id) {
                                                    variable.current.position.stopLossPhase = q + 1
                                                }
                                            }
                                        } else {
                                            moveToPhaseEvent.error = "This Node needs to reference a Phase."
                                            continue
                                        }

                                        variable.current.position.stopLossStage = 'Manage Stage'
                                        if (takeProfitPhase > 0) {
                                            variable.current.strategy.stage = 'Manage Stage'
                                            checkAnnouncements(manageStage, 'Take Profit')
                                        }
                                       
                                        checkAnnouncements(moveToPhaseEvent)
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }

                function calculateStopLoss() {

                    let strategy = tradingSystem.strategies[strategyIndex];
                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let phase
                    let key

                    if (stopLossStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.stopLoss !== undefined) {
                                phase = openStage.initialDefinition.stopLoss.phases[stopLossPhase];
                                key = variable.current.strategy.index + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'stopLoss' + '-' + (stopLossPhase);
                            }
                        }
                    }

                    if (stopLossStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.stopLoss !== undefined) {
                            phase = manageStage.stopLoss.phases[stopLossPhase - 1];
                            key = variable.current.strategy.index + '-' + 'manageStage' + '-' + 'stopLoss' + '-' + (stopLossPhase - 1);
                        }
                    }

                    if (phase !== undefined) {
                        if (phase.formula !== undefined) {
                            let previousValue = variable.current.position.stopLoss

                            variable.current.position.stopLoss = formulas.get(key)

                            if (stopLoss !== previousValue) {
                                checkAnnouncements(phase, variable.current.position.stopLoss)
                            }
                        }
                    }
                }

                /* Take Profit Management */
                if (
                    (variable.current.strategy.stage === 'Open Stage' || variable.current.strategy.stage === 'Manage Stage') &&
                    takePositionNow !== true
                ) {

                    checkTakeProfitPhases();
                    calculateTakeProfit();

                }

                function checkTakeProfitPhases() {

                    let strategy = tradingSystem.strategies[strategyIndex];

                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let parentNode
                    let j = variable.current.strategy.index
                    let stageKey
                    let initialDefinitionKey = ''
                    let p

                    if (takeProfitStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.takeProfit !== undefined) {
                                parentNode = openStage.initialDefinition
                                initialDefinitionKey = '-' + 'initialDefinition'
                                stageKey = 'openStage'
                                p = variable.current.position.takeProfitPhase
                            }
                        }
                    }

                    if (takeProfitStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.takeProfit !== undefined) {
                            parentNode = manageStage
                            stageKey = 'manageStage'
                            p = variable.current.position.takeProfitPhase - 1
                        }
                    }

                    if (parentNode !== undefined) {
                        let phase = parentNode.takeProfit.phases[p];
                        if (phase === undefined) {return} // trying to jump to a phase that does not exists.

                        /* Check the next Phase Event. */
                        let nextPhaseEvent = phase.nextPhaseEvent;
                        if (nextPhaseEvent !== undefined) {

                            for (let k = 0; k < nextPhaseEvent.situations.length; k++) {

                                let situation = nextPhaseEvent.situations[k];
                                let passed = true;

                                for (let m = 0; m < situation.conditions.length; m++) {

                                    let condition = situation.conditions[m];
                                    let key = j + '-' + stageKey + initialDefinitionKey + '-' + 'takeProfit' + '-' + p + '-' + k + '-' + m;

                                    let value = false
                                    if (conditions.get(key) !== undefined) {
                                        value = conditions.get(key).value;
                                    }

                                    if (value === false) { passed = false; }
                                }

                                if (passed) {

                                    variable.current.position.takeProfitPhase++;
                                    variable.current.position.takeProfitStage = 'Manage Stage'
                                    if (stopLossPhase > 0) {
                                        variable.current.strategy.stage = 'Manage Stage'
                                        checkAnnouncements(manageStage, 'Stop')
                                    }

                                    checkAnnouncements(nextPhaseEvent)
                                    return;
                                }
                            }
                        }

                        /* Check the Move to Phase Events. */
                        for (let n = 0; n < phase.moveToPhaseEvents.length; n++) {
                            let moveToPhaseEvent = phase.moveToPhaseEvents[n];
                            if (moveToPhaseEvent !== undefined) {

                                for (let k = 0; k < moveToPhaseEvent.situations.length; k++) {

                                    let situation = moveToPhaseEvent.situations[k];
                                    let passed = true;

                                    for (let m = 0; m < situation.conditions.length; m++) {

                                        let condition = situation.conditions[m];
                                        let key = j + '-' + stageKey + initialDefinitionKey + '-' + 'takeProfit' + '-' + p + '-' + n + '-' + k + '-' + m;

                                        let value = false
                                        if (conditions.get(key) !== undefined) {
                                            value = conditions.get(key).value;
                                        }

                                        if (value === false) { passed = false; }
                                    }

                                    if (passed) {

                                        let moveToPhase = moveToPhaseEvent.referenceParent
                                        if (moveToPhase !== undefined) {
                                            for (let q = 0; q < parentNode.takeProfit.phases.length; q++) {
                                                if (parentNode.takeProfit.phases[q].id === moveToPhase.id) {
                                                    variable.current.position.takeProfitPhase = q + 1
                                                }
                                            }
                                        } else {
                                            moveToPhaseEvent.error = "This Node needs to reference a Phase."
                                            continue
                                        }

                                        variable.current.position.takeProfitStage = 'Manage Stage'
                                        if (stopLossPhase > 0) {
                                            variable.current.strategy.stage = 'Manage Stage'
                                            checkAnnouncements(manageStage, 'Stop')
                                        }

                                        checkAnnouncements(moveToPhaseEvent)
                                        return;
                                    }
                                }
                            }
                        }
                    }
                }

                function calculateTakeProfit() {

                    let strategy = tradingSystem.strategies[strategyIndex];
                    let openStage = strategy.openStage
                    let manageStage = strategy.manageStage
                    let phase
                    let key

                    if (takeProfitStage === 'Open Stage' && openStage !== undefined) {
                        if (openStage.initialDefinition !== undefined) {
                            if (openStage.initialDefinition.takeProfit !== undefined) {
                                phase = openStage.initialDefinition.takeProfit.phases[takeProfitPhase];
                                key = variable.current.strategy.index + '-' + 'openStage' + '-' + 'initialDefinition' + '-' + 'takeProfit' + '-' + (takeProfitPhase);
                            }
                        }
                    }

                    if (takeProfitStage === 'Manage Stage' && manageStage !== undefined) {
                        if (manageStage.takeProfit !== undefined) {
                            phase = manageStage.takeProfit.phases[takeProfitPhase - 1];
                            key = variable.current.strategy.index + '-' + 'manageStage' + '-' + 'takeProfit' + '-' + (takeProfitPhase - 1);
                        }
                    }

                    if (phase !== undefined) {
                        if (phase.formula !== undefined) {

                            let previousValue = variable.current.position.stopLoss

                            variable.current.position.takeProfit = formulas.get(key)

                            if (takeProfit !== previousValue) {
                                checkAnnouncements(phase, variable.current.position.takeProfit)
                            }
                        }
                    }
                }

                /* Keeping Position Counters Up-to-date */
                if (
                    (variable.current.strategy.stage === 'Open Stage' || variable.current.strategy.stage === 'Manage Stage')
                ) {

                    if (takePositionNow === true) {
                        variable.current.position.periods = 0
                    }

                    variable.current.position.periods++;
                    variable.positionDays = variable.current.position.periods * timeFrame / ONE_DAY_IN_MILISECONDS;

                } else {
                    variable.current.position.periods = 0
                    variable.positionDays = 0
                }

                /* Keeping Distance Counters Up-to-date */
                if (
                    variable.distance.toEvent.triggerOn > 0 // with this we avoind counting before the first event happens.
                ) {
                    variable.distance.toEvent.triggerOn++;
                }

                if (
                    variable.distance.toEvent.triggerOff > 0 // with this we avoind counting before the first event happens.
                ) {
                    variable.distance.toEvent.triggerOff++;
                }

                if (
                    variable.distance.toEvent.takePosition > 0 // with this we avoind counting before the first event happens.
                ) {
                    variable.distance.toEvent.takePosition++;
                }

                if (
                    variable.distance.toEvent.closePosition > 0 // with this we avoind counting before the first event happens.
                ) {
                    variable.distance.toEvent.closePosition++;
                }

                /* Checking if Stop or Take Profit were hit */
                if (
                    (variable.current.strategy.stage === 'Open Stage' || variable.current.strategy.stage === 'Manage Stage') &&
                    takePositionNow !== true
                ) {
                    let strategy = tradingSystem.strategies[strategyIndex];

                    /* Checking what happened since the last execution. We need to know if the Stop Loss
                        or our Take Profit were hit. */

                    /* Stop Loss condition: Here we verify if the Stop Loss was hitted or not. */

                    if ((variable.episode.baseAsset === variable.episode.marketBaseAsset && candle.max >= variable.current.position.stopLoss) || (variable.episode.baseAsset !== variable.episode.marketBaseAsset && candle.min <= variable.current.position.stopLoss)) {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Stop Loss was hit."); }
                        /*
                        Hit Point Validation

                        This prevents misscalculations when a formula places the stop loss in this case way beyond the market price.
                        If we take the stop loss value at those situation would be a huge distortion of facts.
                        */

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            if (stopLoss < candle.min) {
                                variable.current.position.stopLoss = candle.min
                            }
                        } else {
                            if (stopLoss > candle.max) {
                                variable.current.position.stopLoss = candle.max
                            }
                        }

                        let slippedStopLoss = variable.current.position.stopLoss

                        /* Apply the Slippage */
                        let slippageAmount = slippedStopLoss * bot.VALUES_TO_USE.slippage.stopLoss / 100

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            slippedStopLoss = slippedStopLoss + slippageAmount
                        } else {
                            slippedStopLoss = slippedStopLoss - slippageAmount
                        }

                        closeRate = slippedStopLoss;

                        variable.current.strategy.stage = 'Close Stage';
                        checkAnnouncements(strategy.closeStage, 'Stop')

                        variable.current.position.stopLossStage = 'No Stage';
                        variable.current.position.takeProfitStage = 'No Stage';
                        variable.current.position.end = candle.end;
                        variable.current.position.status = 1;
                        variable.current.position.exitType = 1;
                        variable.current.position.endRate = closeRate;

                        closePositionNow = true;
                    }

                    /* Take Profit condition: Here we verify if the Take Profit was hit or not. */

                    if ((variable.episode.baseAsset === variable.episode.marketBaseAsset && candle.min <= variable.current.position.takeProfit) || (variable.episode.baseAsset !== variable.episode.marketBaseAsset && candle.max >= variable.current.position.takeProfit)) {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Take Profit was hit."); }
                        /*
                        Hit Point Validation:

                        This prevents misscalculations when a formula places the take profit in this case way beyond the market price.
                        If we take the stop loss value at those situation would be a huge distortion of facts.
                        */

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            if (takeProfit > candle.max) {
                                variable.current.position.takeProfit = candle.max
                            }
                        } else {
                            if (takeProfit < candle.min) {
                                variable.current.position.takeProfit = candle.min
                            }
                        }

                        let slippedTakeProfit = variable.current.position.takeProfit
                        /* Apply the Slippage */
                        let slippageAmount = slippedTakeProfit * bot.VALUES_TO_USE.slippage.takeProfit / 100

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            slippedTakeProfit = slippedTakeProfit + slippageAmount
                        } else {
                            slippedTakeProfit = slippedTakeProfit - slippageAmount
                        }

                        closeRate = slippedTakeProfit;

                        variable.current.strategy.stage = 'Close Stage';
                        checkAnnouncements(strategy.closeStage, 'Take Profit')

                        variable.current.position.stopLossStage = 'No Stage';
                        variable.current.position.takeProfitStage = 'No Stage';

                        variable.current.position.end = candle.end;
                        variable.current.position.status = 1;
                        variable.current.position.exitType = 2;
                        variable.current.position.endRate = closeRate;

                        closePositionNow = true;

                    }
                }

                /* Taking a Position */
                if (
                    takePositionNow === true
                ) {
                    takePositionNow = false
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionNow -> Entering code block."); }

                    /* Inicializing this counter */
                    variable.distance.toEvent.takePosition = 1;

                    /* Position size and rate */
                    let strategy = tradingSystem.strategies[strategyIndex];

                    variable.current.position.size = strategy.positionSize;
                    variable.current.position.rate = strategy.positionRate;

                    /* We take what was calculated at the formula and apply the slippage. */
                    let slippageAmount = variable.current.position.rate * bot.VALUES_TO_USE.slippage.positionRate / 100

                    if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                        variable.current.position.rate = variable.current.position.rate - slippageAmount
                    } else {
                        variable.current.position.rate = variable.current.position.rate + slippageAmount
                    }

                    /* Update the trade record information. */
                    variable.current.position.begin = candle.begin;
                    variable.current.position.beginRate = variable.current.position.rate;

                    /* Check if we need to execute. */
                    if (currentCandleIndex > candles.length - 10) { /* Only at the last candles makes sense to check if we are in live mode or not.*/
                        /* Check that we are in LIVE MODE */
                        if (bot.startMode === "Live") {
                            /* We see if we need to put the actual order at the exchange. */
                            if (variable.executionContext !== undefined) {
                                switch (variable.executionContext.status) {
                                    case "Without a Position": { // We need to put the order because It was not put yet.
                                        if (strategy.openStage !== undefined) {
                                            if (strategy.openStage.openExecution !== undefined) {
                                                putOpeningOrder()
                                                return
                                            }
                                        }
                                        break
                                    }
                                    case "Position Closed": { // Waiting for a confirmation that the position was closed.
                                        if (strategy.openStage !== undefined) {
                                            if (strategy.openStage.openExecution !== undefined) {
                                                putOpeningOrder()
                                                return
                                            }
                                        }
                                        break
                                    }
                                    case "Taking Position": { // Waiting for a confirmation that the position was taken.
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionNow -> Exiting code block because status is Taking Position."); }
                                        break
                                    }
                                    case "In a Position": { // This should mean that we already put the order at the exchange.
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionNow -> Exiting code block because status is In a Position."); }
                                        break
                                    }
                                }
                            } else { // The context does not exist so it means we are not in a position.
                                if (strategy.openStage !== undefined) {
                                    if (strategy.openStage.openExecution !== undefined) {
                                        putOpeningOrder()
                                        return
                                    }
                                }
                            }
                        } else {
                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionNow -> Not trading live."); }
                        }
                    } else {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionNow -> Not the last closed candle."); }
                    }

                    takePositionAtSimulation()
                    return

                    function putOpeningOrder() {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> Entering function."); }

                        /* We wont take a position unless we are withing the bot.VALUES_TO_USE.timeRange.initialDatetime and the bot.VALUES_TO_USE.timeRange.finalDatetime range */
                        if (bot.VALUES_TO_USE.timeRange.initialDatetime !== undefined) {
                            if (candle.end < bot.VALUES_TO_USE.timeRange.initialDatetime.valueOf()) {
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> Not placing the trade at the exchange because current candle ends before the start date.  -> bot.VALUES_TO_USE.timeRange.initialDatetime = " + bot.VALUES_TO_USE.timeRange.initialDatetime); }
                                takePositionAtSimulation()
                                return;
                            }
                        }

                        /*We wont take a position if we are past the final datetime */
                        if (bot.VALUES_TO_USE.timeRange.finalDatetime !== undefined) {
                            if (candle.begin > bot.VALUES_TO_USE.timeRange.finalDatetime.valueOf()) {
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> putOpeningOrder -> Not placing the trade at the exchange because current candle begins after the end date. -> bot.VALUES_TO_USE.timeRange.finalDatetime = " + bot.VALUES_TO_USE.timeRange.finalDatetime); }
                                takePositionAtSimulation()
                                return;
                            }
                        }

                        /* Mechanism to avoid putting the same order over and over again at different executions of the simulation engine. */
                        if (variable.executionContext !== undefined) {
                            if (variable.executionContext.periods !== undefined) {
                                if (variable.episode.periods <= variable.executionContext.periods) {
                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> Not placing the trade at the exchange because it was already placed at a previous execution."); }
                                    takePositionAtSimulation()
                                    return;
                                }
                            }
                        }

                        /* We are not going to place orders based on outdated information. The next filter prevents firing orders when backtesting. */
                        if (currentDay) {
                            let today = new Date(Math.trunc((new Date().valueOf()) / ONE_DAY_IN_MILISECONDS) * ONE_DAY_IN_MILISECONDS)
                            let processDay = new Date(Math.trunc(currentDay.valueOf() / ONE_DAY_IN_MILISECONDS) * ONE_DAY_IN_MILISECONDS)
                            if (today.valueOf() !== processDay.valueOf()) {
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> Not placing the trade at the exchange because the current candle belongs to the previous day and that is considered simulation and not live trading."); }
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> today = " + today); }
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> processDay = " + processDay); }
                                takePositionAtSimulation()
                                return;
                            }
                        }

                        let orderPrice
                        let amountA
                        let amountB
                        let orderSide
 

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            orderSide = "sell"

                            orderPrice = variable.current.position.rate  

                            amountA = variable.current.position.size * orderPrice
                            amountB = variable.current.position.size
 
                        } else {
                            orderSide = "buy"

                            orderPrice = variable.current.position.rate  

                            amountA = variable.current.position.size
                            amountB = variable.current.position.size / orderPrice

                        }

                        variable.executionContext = {
                            status: "Taking Position",
                            periods: variable.episode.periods,
                        }

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> Ready to create order."); }
                        exchangeAPI.createOrder(bot.market, orderSide, orderPrice, amountA, amountB, onOrderCreated)

                        function onOrderCreated(err, order) {
                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> Entering function."); }

                            try {
                                switch (err.result) {
                                    case global.DEFAULT_OK_RESPONSE.result: {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> DEFAULT_OK_RESPONSE "); }
                                        variable.executionContext = {
                                            status: "In a Position",
                                            periods: variable.episode.periods,
                                            amountA: amountA,
                                            amountB: amountB,
                                            orderId: order.id
                                        }
                                        takePositionAtSimulation()
                                        return;
                                    }
                                    case global.DEFAULT_FAIL_RESPONSE.result: {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> DEFAULT_FAIL_RESPONSE "); }
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[ERROR] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> Message = " + err.message); }
                                        strategy.openStage.openExecution.error = err.message
                                        afterLoop()
                                        return;
                                    }
                                    case global.DEFAULT_RETRY_RESPONSE.result: {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> DEFAULT_RETRY_RESPONSE "); }
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[ERROR] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> Message = " + err.message); }
                                        strategy.openStage.openExecution.error = err.message
                                        afterLoop()
                                        return;
                                    }
                                }
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[ERROR] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> Unexpected Response -> Message = " + err.message); }
                                callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                                return

                            } catch (err) {
                                logger.write(MODULE_NAME, "[ERROR] runSimulation  -> loop -> putOpeningOrder -> onOrderCreated ->  err = " + err.stack);
                                callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                                return
                            }
                        }
                    }

                    function takePositionAtSimulation() {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionAtSimulation -> Entering function."); }

                        /* Continue with the simulation */
                        calculateTakeProfit();
                        calculateStopLoss();

                        variable.previous.balance.baseAsset = variable.current.balance.baseAsset;
                        variable.previous.balance.quotedAsset = variable.current.balance.quotedAsset;

                        variable.last.position.profitLoss = 0;
                        variable.last.position.ROI = 0;

                        let feePaid = 0

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {

                            feePaid = variable.current.position.size * variable.current.position.rate * bot.VALUES_TO_USE.feeStructure.taker / 100

                            variable.current.balance.quotedAsset = variable.current.balance.quotedAsset + variable.current.position.size * variable.current.position.rate - feePaid;
                            variable.current.balance.baseAsset = variable.current.balance.baseAsset - variable.current.position.size;
                        } else {

                            feePaid = variable.current.position.size / variable.current.position.rate * bot.VALUES_TO_USE.feeStructure.taker / 100

                            variable.current.balance.baseAsset = variable.current.balance.baseAsset + variable.current.position.size / variable.current.position.rate - feePaid;
                            variable.current.balance.quotedAsset = variable.current.balance.quotedAsset - variable.current.position.size;
                        }

                        addRecord();
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> takePositionAtSimulation -> Exiting Loop Body after taking position at simulation."); }
                        controlLoop();
                        return
                    }
                }

                if (closePositionNow === true) {

                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Closing a Position -> Entering code block."); }

                    closePositionNow = false

                    /* Inicializing this counter */
                    variable.distance.toEvent.closePosition = 1;

                    /* Position size and rate */
                    let strategy = tradingSystem.strategies[strategyIndex];

                    if (currentCandleIndex > candles.length - 10) { /* Only at the last candles makes sense to check if we are in live mode or not.*/
                        /* Check that we are in LIVE MODE */
                        if (bot.startMode === "Live") {
                            /* We see if we need to put the actual order at the exchange. */
                            if (variable.executionContext !== undefined) {
                                switch (variable.executionContext.status) {
                                    case "Without a Position": { // No way to close anything at the exchange.
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Closing a Position -> Exiting code block because status is Without a Position."); }
                                        break
                                    }
                                    case "In a Position": { // This should mean that we already put the order at the exchange.
                                        if (strategy.closeStage !== undefined) {
                                            if (strategy.closeStage.closeExecution !== undefined) {
                                                putClosingOrder()
                                                return
                                            }
                                        }
                                        break
                                    }
                                    case "Closing Position": { // Waiting for a confirmation that the position was taken.
                                        if (strategy.closeStage !== undefined) {
                                            if (strategy.closeStage.closeExecution !== undefined) {
                                                putClosingOrder()
                                                return
                                            }
                                        }
                                        break
                                    }

                                    case "Position Closed": { //  
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Closing a Position -> Exiting code block because status is Position Closed."); }
                                        break
                                    }
                                }
                            }
                        }
                    } else {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Closing a Position -> Not within the last 10 candles."); }
                    }

                    closePositionAtSimulation()
                    return

                    function putClosingOrder() {

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> putClosingOrder -> Entering function."); }

                        /* Mechanism to avoid putting the same order over and over again at different executions of the simulation engine. */
                        if (variable.executionContext !== undefined) {
                            if (variable.executionContext.periods !== undefined) {
                                if (variable.episode.periods <= variable.executionContext.periods) {
                                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putClosingOrder -> Exiting function because this closing was already submited at a previous execution."); }
                                    closePositionAtSimulation()
                                    return;
                                }
                            }
                        }

                        let orderPrice
                        let amountA
                        let amountB
                        let orderSide

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            orderSide = "buy"

                            orderPrice = ticker.last + 100; // This is provisional and totally arbitrary, until we have a formula on the designer that defines this stuff.

                            amountA =  variable.current.balance.quotedAsset 
                            amountB = variable.current.balance.quotedAsset / orderPrice

                        } else {
                            orderSide = "sell"

                            orderPrice = ticker.last - 100; // This is provisional and totally arbitrary, until we have a formula on the designer that defines this stuff.

                            amountA = variable.current.balance.baseAsset * orderPrice
                            amountB = variable.current.balance.baseAsset

                        }

                        variable.executionContext = {
                            status: "Closing Position",
                            periods: variable.episode.periods,
                        }

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putClosingOrder -> About to close position at the exchange."); }
                        exchangeAPI.createOrder(bot.market, orderSide, orderPrice, amountA, amountB, onOrderCreated)

                        function onOrderCreated(err, order) {
                            if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putClosingOrder -> onOrderCreated -> Entering function."); }

                            try {
                                switch (err.result) {
                                    case global.DEFAULT_OK_RESPONSE.result: {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putClosingOrder -> onOrderCreated -> DEFAULT_OK_RESPONSE "); }
                                        variable.executionContext = {
                                            status: "Position Closed",
                                            periods: variable.episode.periods,
                                            amountA: amountA,
                                            amountB: amountB,
                                            orderId: order.id
                                        }
                                        closePositionAtSimulation()
                                        return;
                                    }
                                    case global.DEFAULT_FAIL_RESPONSE.result: {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putClosingOrder -> onOrderCreated -> DEFAULT_FAIL_RESPONSE "); }
                                        /* We will assume that the problem is temporary, and expect that it will work at the next execution.*/
                                        strategy.closeStage.closeExecution.error = err.message
                                        afterLoop()
                                        return;
                                    }
                                    case global.DEFAULT_RETRY_RESPONSE.result: {
                                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> putOpeningOrder -> onOrderCreated -> DEFAULT_RETRY_RESPONSE "); }
                                        strategy.closeStage.closeExecution.error = err.message
                                        afterLoop()
                                        return;
                                    }
                                }
                                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[ERROR] runSimulation -> loop -> putClosingOrder -> onOrderCreated -> Unexpected Response -> Message = " + err.message); }
                                callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                                return

                            } catch (err) {
                                logger.write(MODULE_NAME, "[ERROR] runSimulation  -> loop -> putClosingOrder -> onOrderCreated ->  err = " + err.stack);
                                callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                                return
                            }
                        }
                    }

                    function closePositionAtSimulation() {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> closePositionAtSimulation -> Entering function."); }

                        variable.episode.tradesCount++;

                        let feePaid = 0

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            strategy.positionSize = variable.current.balance.quotedAsset / closeRate;
                            strategy.positionRate = closeRate;

                            feePaid = variable.current.balance.quotedAsset / closeRate * bot.VALUES_TO_USE.feeStructure.taker / 100

                            variable.current.balance.baseAsset = variable.current.balance.baseAsset + variable.current.balance.quotedAsset / closeRate - feePaid;
                            variable.current.balance.quotedAsset = 0;
                        } else {
                            strategy.positionSize = variable.current.balance.baseAsset * closeRate;
                            strategy.positionRate = closeRate;

                            feePaid = variable.current.balance.baseAsset * closeRate * bot.VALUES_TO_USE.feeStructure.taker / 100

                            variable.current.balance.quotedAsset = variable.current.balance.quotedAsset + variable.current.balance.baseAsset * closeRate - feePaid;
                            variable.current.balance.baseAsset = 0;
                        }

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            variable.last.position.profitLoss = variable.current.balance.baseAsset - variable.previous.balance.baseAsset;
                            variable.last.position.ROI = variable.last.position.profitLoss * 100 / variable.current.position.size;
                            if (isNaN(lastTradeROI)) { variable.last.position.ROI = 0; }
                            variable.episode.profitLoss = variable.current.balance.baseAsset - variable.initial.balance.baseAsset;
                        } else {
                            variable.last.position.profitLoss = variable.current.balance.quotedAsset - variable.previous.balance.quotedAsset;
                            variable.last.position.ROI = variable.last.position.profitLoss * 100 / variable.current.position.size;
                            if (isNaN(lastTradeROI)) { variable.last.position.ROI = 0; }
                            variable.episode.profitLoss = variable.current.balance.quotedAsset - variable.initial.balance.quotedAsset;
                        }

                        variable.current.position.lastTradeROI = variable.last.position.ROI;

                        if (variable.last.position.profitLoss > 0) {
                            variable.episode.hits++;
                        } else {
                            variable.episode.fails++;
                        }

                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            variable.episode.ROI = (variable.initial.balance.baseAsset + variable.episode.profitLoss) / variable.initial.balance.baseAsset - 1;
                            variable.episode.hitRatio = variable.episode.hits / variable.episode.tradesCount;
                            variable.anualizedRateOfReturn = variable.episode.ROI / variable.episode.days * 365;
                        } else {
                            variable.episode.ROI = (variable.initial.balance.quotedAsset + variable.episode.profitLoss) / variable.initial.balance.quotedAsset - 1;
                            variable.episode.hitRatio = variable.episode.hits / variable.episode.tradesCount;
                            variable.anualizedRateOfReturn = variable.episode.ROI / variable.episode.days * 365;
                        }

                        addRecord();

                        variable.current.position.stopLoss = 0;
                        variable.current.position.takeProfit = 0;

                        variable.current.position.rate = 0;
                        variable.current.position.size = 0;

                        timerToCloseStage = candle.begin
                        variable.current.position.stopLossStage = 'No Stage';
                        variable.current.position.takeProfitStage = 'No Stage';
                        variable.current.position.stopLossPhase = -1;
                        variable.current.position.takeProfitPhase = -1;

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> closePositionAtSimulation -> Exiting Loop Body after closing position at simulation."); }
                        controlLoop();
                        return
                    }
                }

                /* Closing the Closing Stage */
                if (variable.current.strategy.stage === 'Close Stage') {
                    if (candle.begin - 5 * 60 * 1000 > timerToCloseStage) {

                        variable.current.strategy.number = variable.current.strategy.index
                        variable.current.strategy.end = candle.end;
                        variable.current.strategy.endRate = candle.min;
                        variable.current.strategy.status = 1; // This means the strategy is closed, i.e. that has a begin and end.

                        variable.current.strategy.index = -1;
                        variable.current.strategy.stage = 'No Stage';

                        timerToCloseStage = 0
                        variable.distance.toEvent.triggerOff = 1;

                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Closing the Closing Stage -> Exiting Close Stage."); }
                    } else {
                        if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Closing the Closing Stage -> Waiting for timer."); }
                    }
                }

                /* Not a buy or sell condition */

                addRecord();
                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> Exiting Loop Body after adding a record."); }
                controlLoop();
                return

                function addRecord() {
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> loop -> addRecord -> Entering function."); }
                    let simulationRecord;

                    if (variable.current.balance.baseAsset === Infinity) {
                        variable.current.balance.baseAsset = Number.MAX_SAFE_INTEGER
                    }

                    if (variable.current.balance.quotedAsset === Infinity) {
                        variable.current.balance.quotedAsset = Number.MAX_SAFE_INTEGER
                    }

                    simulationRecord = {
                        begin: candle.begin,
                        end: candle.end,
                        balanceBaseAsset: variable.current.balance.baseAsset,
                        balanceQuotedAsset: variable.current.balance.quotedAsset,
                        accumulatedProfitLoss: variable.episode.profitLoss,
                        lastTradeProfitLoss: variable.last.position.profitLoss,
                        stopLoss: variable.current.position.stopLoss,
                        tradesCount: variable.episode.tradesCount,
                        hits: variable.episode.hits,
                        fails: variable.episode.fails,
                        hitRatio: variable.episode.hitRatio,
                        ROI: variable.episode.ROI,
                        periods: variable.episode.periods,
                        days: variable.episode.days,
                        anualizedRateOfReturn: variable.anualizedRateOfReturn,
                        positionRate: variable.current.position.rate,
                        lastTradeROI: variable.last.position.ROI,
                        strategy: variable.current.strategy.index,
                        takeProfit: variable.current.position.takeProfit,
                        stopLossPhase: variable.current.position.stopLossPhase,
                        takeProfitPhase: variable.current.position.takeProfitPhase,
                        positionSize: variable.current.position.size,
                        initialBalanceA: variable.initial.balance.baseAsset,
                        minimumBalanceA: variable.minimum.balance.baseAsset,
                        maximumBalanceA: variable.maximum.balance.baseAsset,
                        initialBalanceB: variable.initial.balance.quotedAsset,
                        minimumBalanceB: variable.minimum.balance.quotedAsset,
                        maximumBalanceB: variable.maximum.balance.quotedAsset,
                        baseAsset: '"' + variable.episode.baseAsset + '"',
                        quotedAsset: '"' + variable.episode.quotedAsset + '"',
                        marketBaseAsset: '"' + variable.episode.marketBaseAsset + '"',
                        marketQuotedAsset: '"' + variable.episode.marketQuotedAsset +  '"' ,
                        positionPeriods: variable.current.position.periods,
                        positionDays: variable.positionDays,
                        distanceToEventTriggerOn: variable.distance.toEvent.triggerOn,
                        distanceToEventTriggerOff: variable.distance.toEvent.triggerOff,
                        distanceToEventTakePosition: variable.distance.toEvent.takePosition,
                        distanceToEventClosePosition: variable.distance.toEvent.closePosition
                    }

                    recordsArray.push(simulationRecord);

                    /* Prepare the information for the Conditions File */

                    conditionsArrayRecord.push(strategyIndex);
                    conditionsArrayRecord.push(stopLossPhase);
                    conditionsArrayRecord.push(takeProfitPhase);
                    conditionsArrayRecord.push(conditionsArrayValues);
                    conditionsArrayRecord.push(formulasErrors);
                    conditionsArrayRecord.push(formulasValues);

                    conditionsArray.push(conditionsArrayRecord);

                    /* 
                    Lets see if there will be an open strategy ...
                    Except if we are at the head of the market (remember we skipped the last candle for not being closed.)
                    */
                    if (variable.current.strategy.begin !== 0 && variable.current.strategy.end === 0 && currentCandleIndex === candles.length - 2 && lastCandle.end !== lastInstantOfTheDay) {
                        variable.current.strategy.status = 2; // This means the strategy is open, i.e. that has a begin but no end.
                        variable.current.strategy.end = candle.end
                    }
                    
                    /* Prepare the information for the Strategies File*/
                    if (variable.current.strategy.begin !== 0 && variable.current.strategy.end !== 0)            
                    {
                        let currentStrategyRecord = {
                            begin: variable.current.strategy.begin,
                            end: variable.current.strategy.end,
                            status: variable.current.strategy.status,
                            number: variable.current.strategy.number,
                            beginRate: variable.current.strategy.beginRate,
                            endRate: variable.current.strategy.endRate,
                            situationName: variable.current.strategy.situationName
                        }

                        strategiesArray.push(currentStrategyRecord );

                        inializeCurrentStrategy()                        
                    }

                    /* 
                    Lets see if there will be an open trade ...
                    Except if we are at the head of the market (remember we skipped the last candle for not being closed.)
                    */
                    if (variable.current.position.begin !== 0 && variable.current.position.end === 0 && currentCandleIndex === candles.length - 2 && lastCandle.end !== lastInstantOfTheDay) {
                        variable.current.position.status = 2; // This means the trade is open 
                        variable.current.position.end = candle.end
                        variable.current.position.endRate = candle.close

                        /* Here we will calculate the ongoing variable.episode.ROI */
                        if (variable.episode.baseAsset === variable.episode.marketBaseAsset) {
                            variable.current.position.lastTradeROI = (variable.current.position.rate - candle.close) / variable.current.position.rate * 100
                        } else {
                            variable.current.position.lastTradeROI = (candle.close - variable.current.position.rate) / variable.current.position.rate * 100
                        }
                    }

                    /* Prepare the information for the Trades File */
                    if (variable.current.position.begin !== 0 && variable.current.position.end !== 0) { 

                        let currentPositionRecord = {
                            begin: variable.current.position.begin,
                            end: variable.current.position.end,
                            status: variable.current.position.status,
                            lastTradeROI: variable.current.position.lastTradeROI,
                            exitType: variable.current.position.exitType,
                            beginRate: variable.current.position.beginRate,
                            endRate: variable.current.position.endRate,
                            situationName: variable.current.position.situationName
                        }

                        tradesArray.push(currentPositionRecord);

                        initializeCurrentPosition()
                    }

                    makeAnnoucements() // After everything at the simulation level was done, we will do the annoucements that are pending.
                }

                function checkAnnouncements(node, value) {
                    /*
                    Value is an optional parameter that represents the value that the announcement is monitoring for change (for numeric values only).
                    If we do receive this value, we will only make the annoucement if the variance is grater than the user pre-defined value
                    for this variance.
                    */

                    if (node.announcements !== undefined) {
                        for (let i = 0; i < node.announcements.length; i++) {
                            let announcement = node.announcements[i]
                            let key = node.type + "-" + announcement.name + "-" + announcement.id

                            let lastPeriodAnnounced = -1
                            let newAnnouncementRecord = {}

                            for (let j = 0; j < variable.announcements.length; j++) {
                                let announcementRecord = variable.announcements[j]
                                if (announcementRecord.key === key) {
                                    lastPeriodAnnounced = announcementRecord.periods
                                    newAnnouncementRecord = announcementRecord
                                    break
                                }
                            }

                            if (variable.episode.periods > lastPeriodAnnounced) {

                                if (isNaN(value) === false) {
                                    /* The Value Variation is what tells us how much the value already announced must change in order to annouce it again. */
                                    let valueVariation

                                    let code = announcement.code
                                    valueVariation = code.valueVariation

                                    if (newAnnouncementRecord.value !== undefined && valueVariation !== undefined) {
                                        let upperLimit = newAnnouncementRecord.value + newAnnouncementRecord.value * valueVariation / 100
                                        let lowerLimit = newAnnouncementRecord.value - newAnnouncementRecord.value * valueVariation / 100
                                        if (value > lowerLimit && value < upperLimit) {
                                            /* There is not enough variation to announce this again. */
                                            return
                                        }
                                    }
                                }

                                /*
                                We store the announcement temporarily at an Array to differ its execution, becasue we need to evaulate its formula
                                and at this point in time the potential variables used at the formula are still not set.
                                */
                                announcement.value = value
                                announcementsToBeMade.push(announcement)

                                /* Next, we will remmeber this announcement was already done, so that it is not announced again in further processing of the same day. */
                                if (newAnnouncementRecord.periods !== undefined) {
                                    newAnnouncementRecord.periods = variable.episode.periods
                                    newAnnouncementRecord.value = value
                                } else {
                                    newAnnouncementRecord = {
                                        key: key,
                                        periods: variable.episode.periods,
                                        value: value
                                    }
                                    variable.announcements.push(newAnnouncementRecord)
                                }
                            }
                        }
                    }
                }

                function makeAnnoucements() {
                    /* Here we go through all the annoucements that need to be done during this loop, and we just do them. */
                    for (let i = 0; i < announcementsToBeMade.length; i++) {
                        announcement = announcementsToBeMade[i]
                        /* Here we check if there is a formula attached to the annoucement, we evaluate it to get the annoucement text. */
                        let formulaValue
                        if (announcement.formula !== undefined) {
                            try {
                                let value = announcement.value
                                formulaValue = eval(announcement.formula.code);
                            } catch (err) {
                                announcement.formula.error = err.message
                            }
                        }
                        announcement.formulaValue = formulaValue

                        if (bot.SESSION.socialBots !== undefined) {
                            bot.SESSION.socialBots.announce(announcement)
                        }
                    }
                }
            }



            function controlLoop() {
                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> controlLoop -> Entering function."); }

                /* Checking if we should continue processing this loop or not.*/
                if (bot.STOP_SESSION === true) {
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> controlLoop -> We are going to stop here bacause we were requested to stop processing this session."); }
                    console.log("[INFO] runSimulation -> controlLoop -> We are going to stop here bacause we were requested to stop processing this session.")
                    afterLoop()
                    return
                }

                if (global.STOP_TASK_GRACEFULLY === true) {
                    if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> controlLoop -> We are going to stop here bacause we were requested to stop processing this task."); }
                    console.log("[INFO] runSimulation -> controlLoop -> We are going to stop here bacause we were requested to stop processing this task.")
                    afterLoop()
                    return
                }

                currentCandleIndex++
                if (currentCandleIndex < candles.length) {
                    setImmediate(loop) // This will execute the next loop in the next iteration of the NodeJs event loop allowing for other callbacks to be executed.
                } else {
                    afterLoop()
                }
            }

            function afterLoop() {
                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> afterLoop -> Entering function."); }

                /*
                Before returning we need to see if we have to record some of our counters at the variable.
                To do that, the condition to be met is that this execution must include all candles of the current day.
                */

                if (FULL_LOG === true) { logger.write(MODULE_NAME, "[INFO] runSimulation -> callback -> recordsArray.length = " + recordsArray.length); }

                callback(tradingSystem, recordsArray, conditionsArray, strategiesArray, tradesArray);
            }

            function getElement(pArray, currentCandle, datasetName) {
                if (pArray === undefined) {return}
                try {
                    let element;
                    for (let i = 0; i < pArray.length; i++) {
                        element = pArray[i];

                        if (currentCandle.end === element.end) { // when there is an exact match at the end we take that element
                            return element
                        } else {
                            if (
                                i > 0 &&
                                element.end > currentCandle.end
                            ) {
                                let previousElement = pArray[i - 1]
                                if (previousElement.end < currentCandle.end) {
                                    return previousElement // If one elements goes into the future of currentCandle, then we stop and take the previous element.
                                } else {
                                    return
                                }
                            }
                            if (
                                i === pArray.length - 1 // If we reach the end of the array, then we return the last element.
                                &&
                                element.end < currentCandle.end
                            ) {
                                return element
                            }
                        }
                    }
                    return
                }
                catch (err) {
                    logger.write(MODULE_NAME, "[ERROR] runSimulation -> getElement -> datasetName = " + datasetName);
                    logger.write(MODULE_NAME, "[ERROR] runSimulation -> getElement -> err = " + err.stack);
                    callBackFunction(global.DEFAULT_FAIL_RESPONSE);
                }
            }
        }
        catch (err) {
            logger.write(MODULE_NAME, "[ERROR] runSimulation -> err = " + err.stack);
            callBackFunction(global.DEFAULT_FAIL_RESPONSE);
        }
    }
};



