'use strict';
// JavaScript source code
(function () {
    var global = this;
    var queuedEvents = [];
    var propertyId;
    var propertyKey;
    var interval = 3000;
    var collectionEndPoint = "https://collection.microserviceanalytics.com/v1/event";
    var timerId = null;
    var correlationIdPrefix = "";
    var autoStartJourneys = true;
    var currentJourney = null;
    var currentJourneyEndsOnError = true;
    var currentJourneyCreatedScope = false;
    var scopeCorrelationId = null;
    var httpWhitelist = [];
    var httpBlacklist = [];
    var analytics = {
        endJourneyAfterHttpRequest: false,
        journeyCodeOwnedByScope: false
    };

    function scheduleNextUpload() {
        timerId = window.setTimeout(uploadData, interval);
    }

    function uploadData() {
        if (queuedEvents.length === 0) {
            scheduleNextUpload();
            return;
        }
        timerId = null;
        var payload = JSON.stringify({
            ApplicationVersion: "1.0.0.0",
            Source: "javascript",
            Events: queuedEvents
        });
        // do we want to build in some sense of retry on failure
        queuedEvents = [];
        var http = new XMLHttpRequest();
        http.onreadystatechange = function () {
            if (http.readyState === XMLHttpRequest.DONE && timerId == null) {
                scheduleNextUpload();
            }
        };
        http.open("POST", collectionEndPoint, true);
        http.setRequestHeader("af-property-id", propertyId);
        http.setRequestHeader("af-collection-key", propertyKey);
        http.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        http.send(payload);
    }

    function captureEvents() {
        document.body.addEventListener("click", clickBeginAutoJourney, true); // start on capture
        document.body.addEventListener("click", clickEndAutoJourney, false); // end on bubble back through
    }

    function clickBeginAutoJourney(ev) {
        var src = ev.srcElement;
        var journeyCode = src.getAttribute("data-journey-start");
        if (journeyCode) {
            analytics.startNamedJourney(journeyCode);
        }
    }
    function clickEndAutoJourney(ev) {
        if (currentJourney) {
            var src = ev.srcElement;
            var journeyCode = src.getAttribute("data-journey-start");
            var noStop = src.getAttribute("data-journey-noend");
            if (noStop === null && journeyCode && currentJourney.Data.JourneyCode === journeyCode) {
                analytics.endCurrentJourney(journeyCode);
            }
        }
    }
    function errorHandler() {
        //var evt = ev;
    }

    function createCorrelationId() {
        if (scopeCorrelationId) {
            return scopeCorrelationId;
        }
        var correlationId = correlationIdPrefix + uuid.v4();
        if (currentJourney) {
            currentJourney.CorrelationIds.push(correlationId);
        }
        return correlationId;
    }
    function isHttpError(status) {
        return status !== 200;
    }
    // HTTP intercepts
    (function (open) {
        XMLHttpRequest.prototype.open = function () {
            var that = this;
            var correlationId = createCorrelationId();
            this.onreadystatechange = function () {
                if (that.readyState === XMLHttpRequest.DONE && isHttpError(that.status)) {
                    analytics.handleHttpError(that.status, that.response, correlationId);
                }
            };
            open.apply(this, arguments);
            this.setRequestHeader('correlation-id', correlationId);
        };
    })(XMLHttpRequest.prototype.open);
    (function (send) {
        XMLHttpRequest.prototype.send = function () {
            send.apply(this, arguments);
        };
    })(XMLHttpRequest.prototype.send);

    // Options include:
    //   propertyId - required, must match a property ID configured in the portal
    //   propertyKey - required, access key, must match a data access key for the property configured in the portal
    //   interval - optional, defaults to 3000, interval between sending batched client events to the analytic servers
    //   collectionEndPoint - optional, defaults to production servers, url to send events t
    //   correlationIdPrefix - optional, defaults to the property ID, a string to prefix correlation IDs with
    //   autoStartJourneys - optional, defaults to true, when enabled the events listed below trigger the start of a new journey when the source element as an attribute of data-journey. That attribute must name the journey.
    //   httpBlacklist - array of regex's that when matched will exclude those http calls from tracking
    //   httpWhitelist - array of regex's that when matched will include only those http calls in tracking
    // 
    // You can set both a whitelist and a blacklist but you only need one.
    //
    // Supported events for auto started journeys are:
    //   click
    analytics.configure = function (options) {
        propertyId = options.propertyId;
        propertyKey = options.propertyKey;
        if (options.endpoint) {
            collectionEndPoint = options.endpoint;
        }
        if (options.interval) {
            interval = options.interval;
        }
        if (options.collectionEndPoint) {
            collectionEndPoint = options.collectionEndPoint;
        }
        if (options.correlationIdPrefix) {
            correlationIdPrefix = options.correlationIdPrefix;
        }
        else {
            correlationIdPrefix = propertyId + '-';
        }
        if (options.autoStartJourneys) {
            autoStartJourneys = options.autoStartJourneys;
        }
        if (options.httpBlacklist) {
            httpBlacklist = options.httpBlacklist;
        }
        if (options.httpWhitelist) {
            httpWhitelist = options.httpWhitelist;
        }
        if (autoStartJourneys) {
            captureEvents();
        }
        window.addEventListener("error", errorHandler, true);
        window.onerror = errorHandler;
        scheduleNextUpload();
    };
    analytics.beginScope = function () {
        analytics.scopeCorrelationId = correlationIdPrefix + uuid.v4();
    };
    analytics.endScope = function () {
        analytics.scopeCorrelationId = null;
    };

    // shouldBeginsScope defaults to false, endsOnError defaults to true
    analytics.startJourney = function (code, shouldBeginScope, endsOnError) {
        // the scope and journey stuff is wrong. what we want to happen is:
        // 1. user begins journey (auto or manual)
        // 2. journey is marked as begun
        // 3. we collect all correlation-ids that are generated during the journey
        // 4. on journey end we stop collecting the correlation IDs and the journey is queued
        if (endsOnError === undefined) {
            endsOnError = true;
        }
        if (shouldBeginScope === undefined) {
            shouldBeginScope = false;
        }
        currentJourneyCreatedScope = false;
        if (shouldBeginScope && analytics.scopeCorrelationId === null) {
            analytics.beginScope();
            currentJourneyCreatedScope = true;
        }

        currentJourneyEndsOnError = endsOnError;
        currentJourney = {
            EventType: 'journey',
            EventStartDateTime: new Date().toISOString(),
            EventEndDateTime: null,
            CorrelationIds: [],
            Data: {
                JourneyCode: code,
                EndedWithError: false
            }
        };

        if (analytics.scopeCorrelationId) {
            currentJourney.CorrelationIds.push(analytics.scopeCorrelationId);
        }
    };
    analytics.endJourney = function (endedWithError) {
        if (currentJourneyCreatedScope) {
            analytics.endScope();
        }

        if (currentJourney) {
            currentJourney.EventEndDateTime = new Date().toISOString();
            if (endedWithError === true) {
                currentJourney.Data.EndedWithError = true;
            }
            queuedEvents.push(currentJourney);
            currentJourney = null;
        }
    };
    analytics.handleJavaScriptError = function (exception) {
        if (currentJourney && currentJourneyEndsOnError) {
            analytics.endJourney(true);
        }
        var stackFrames = [];
        var parsedStackFrames = ErrorStackParser.parse(exception);
        for (var stackIndex = 0; stackIndex < parsedStackFrames.length; stackIndex++) {
            stackFrames.push({
                Filename: parsedStackFrames[stackIndex].fileName,
                Line: parsedStackFrames[stackIndex].lineNumber,
                Column: parsedStackFrames[stackIndex].columnNumber,
                Assembly: null,
                Class: null,
                Method: null
            });
        }
        var errorEvent = {
            EventType: "error",
            EventStartDateTime: new Date().toISOString(),
            EventEndDateTime: null,
            CorrelationIds: [],
            Data: {
                StackFrames: stackFrames,
                Message: exception.message,
                ExceptionType: exception.name ? exception.name : "javascript"
            }
        };

        queuedEvents.push(errorEvent);
    };
    analytics.handleHttpError = function () {
        if (currentJourney && currentJourneyEndsOnError) {
            analytics.endJourney(true);
        }
    };

    global.microserviceAnalytics = analytics;
}).call(this);