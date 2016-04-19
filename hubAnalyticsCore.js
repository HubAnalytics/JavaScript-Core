'use strict';
// JavaScript source code
(function () {
    var global = this;
    var queuedEvents = [];
    var propertyId;
    var propertyKey;
    var interval = 3000;
    var collectionEndPoint = "https://collection.microserviceanalytics.com/v1/event";
    var correlationIdKey = "correlation-id";
    var correlationEnabled = true;
    var timerId = null;
    var tailCorrelationCookieName = "msatailcorrelation";
    var correlationIdPrefix = "";
    var autoStartJourneys = true;
    var currentJourney = null;
    var currentJourneyEndsOnError = true;
    var currentJourneyCreatedScope = false;
    var corePageViewReportingEnabled = true;
    var scopeCorrelationId = null;
    var isDisabledDueToAuthorizationFailure = false;
    var useTrackingCookies = true;
    var useTrackingLocalStorage = true;
    var userTrackingCookieName = 'msausertracker';
    var sessionTrackingCookieName = 'msasessiontracker';
    var userIdKey = 'msa-user-id';
    var sessionIdKey = 'msa-session-id';
    var httpWhitelist = [];
    var httpBlacklist = [];
    var analytics = {
        endJourneyAfterHttpRequest: false,
        journeyCodeOwnedByScope: false
    };
    
    var userIdProvider = function() {
        var userId;
        if (window) {
            if (useTrackingCookies) {
                userId = getCookie(userTrackingCookieName);
                if (userId) {
                    return userId;
                }
            }
            if (useTrackingLocalStorage) {
                userId = window.localStorage.getItem(userIdKey);
                if (!userId) {
                    userId = uuid.v4();
                    window.localStorage.setItem(userIdKey, userId);
                }
                return userId;
            }            
        }
        return undefined;
    };
    
    var sessionIdProvider = function() {
        var sessionId;
        if (window) {
            if (useTrackingCookies) {
                sessionId = getCookie(sessionTrackingCookieName);
                if (sessionId) {
                    return sessionId;
                }
            }

            if (useTrackingLocalStorage) {
                sessionId = window.sessionStorage.getItem(sessionIdKey);
                if (!sessionId) {
                    sessionId = uuid.v4();
                    window.sessionStorage.setItem(sessionIdKey, sessionId);
                }
                return sessionId;
            }
        }
        return undefined;
    };
    

    function scheduleNextUpload() {
        timerId = setTimeout(uploadData, interval);
    }

    function uploadData() {
        if (queuedEvents.length === 0) {
            scheduleNextUpload();
            return;
        }
        timerId = null;
        var payloadObject = {
            ApplicationVersion: "1.0.0.0",
            Source: "javascript",
            Events: queuedEvents
        };
        if (window) {
            var orientation = window.screen.orientation || window.screen.mozOrientation || window.screen.msOrientation;
            payloadObject.Environment = {
                ScreenWidth: window.screen.width,
                ScreenHeight: window.screen.height,
                ScreenColorDepth: window.screen.colorDepth,
                Orientation: orientation                
            };
        }
        var payload = JSON.stringify(payloadObject);
        // do we want to build in some sense of retry on failure
        queuedEvents = [];
        var http = new XMLHttpRequest();
        http.onreadystatechange = function () {
            if (http.readyState === XMLHttpRequest.DONE && timerId == null) {
                if (http.status === 401) {
                    // property ID / key is invalid, pointless sending further requests
                    // setting the below prevents needless memory consumption
                    isDisabledDueToAuthorizationFailure = true;
                    if (console) {
                        console.warn('HubAnalytics client unauthorised - invalid property ID / key pair');
                    }
                }
                else {
                    scheduleNextUpload();                    
                }
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
    function errorHandler(errorEvent) {
        analytics.handleJavaScriptError(errorEvent.error);
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
    function getOrCreateCorrelationId() {
        var correlationId = analytics.getContextualCorrelationId();
        if (!correlationId) {
            correlationId = createCorrelationId();
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
            var correlationId = getOrCreateCorrelationId();
            var thatonreadystatechange = that.onreadystatechange;
            this.onreadystatechange = function () {
                if (that.readyState === XMLHttpRequest.DONE && isHttpError(that.status)) {
                    analytics.handleHttpError(that.status, that.response, correlationId);
                }
                if (thatonreadystatechange) {
                    thatonreadystatechange();
                }
            };
            open.apply(this, arguments);
            if (correlationEnabled) {
                this.setRequestHeader(correlationIdKey, correlationId);
            }
            var sessionId = sessionIdProvider();
            if (sessionId) {
                this.setRequestHeader(sessionIdKey, sessionId);
            }
            var userId= userIdProvider();
            if (userId) {
                this.setRequestHeader(userIdKey, userId);
            }
        };
    })(XMLHttpRequest.prototype.open);
    (function (send) {
        XMLHttpRequest.prototype.send = function () {
            send.apply(this, arguments);
        };
    })(XMLHttpRequest.prototype.send);
    
    function formatLocalDate() {
        var now = new Date(),
            tzo = -now.getTimezoneOffset(),
            dif = tzo >= 0 ? '+' : '-',
            pad = function(num) {
                var norm = Math.abs(Math.floor(num));
                return (norm < 10 ? '0' : '') + norm;
            };
        return now.getFullYear() 
            + '-' + pad(now.getMonth()+1)
            + '-' + pad(now.getDate())
            + 'T' + pad(now.getHours())
            + ':' + pad(now.getMinutes()) 
            + ':' + pad(now.getSeconds())
            + '.' + pad(now.getMilliseconds())
            + dif + pad(tzo / 60) 
            + ':' + pad(tzo % 60);
    };

    function getCookie(cname) {
        var name = cname + "=";
        var ca = document.cookie.split(';');
        for (var i = 0; i < ca.length; i++) {
            var c = ca[i];
            while (c.charAt(0) == ' ') c = c.substring(1);
            if (c.indexOf(name) == 0) return c.substring(name.length, c.length);
        }
        return null;
    }

    // Options include:
    //   propertyId - required, must match a property ID configured in the portal
    //   propertyKey - required, access key, must match a data access key for the property configured in the portal
    //   correlationEnabled - optional, defaults to true, is correlation information sent
    //   correlationIdKey - optional, defaults to correlation-id, the http header to use to send correlation IDs with
    //   uploadIntervalMs - optional, defaults to 3000, interval between sending batched client events to the analytic servers
    //   collectionEndpoint - optional, defaults to production servers, url to send events t
    //   correlationIdPrefix - optional, defaults to the property ID, a string to prefix correlation IDs with
    //   autoStartJourneys - optional, defaults to true, when enabled the events listed below trigger the start of a new journey when the source element as an attribute of data-journey. That attribute must name the journey.
    //   httpBlacklist - array of regex's that when matched will exclude those http calls from tracking
    //   httpWhitelist - array of regex's that when matched will include only those http calls in tracking
    //   userIdProvider - function that returns a user ID as a string, optional, defaults to a guid generated if missing and saved in local storage
    //   sessionIdProvider - function that returns a session ID as a string, optional, defaults to a guid generated if missing and saved in session storage
    //   userIdKey - optional, defaults to msa-user-id, the http header to use to send user IDs with
    //   sessionIdKey - optional, defaults to msa-session-id, the http header to use to send session IDs with
    //   corePageViewReportingEnabled - optional, defaults to true and will cause the JS library to record a page view as it is loaded
    //   tailCorrelationCookieName - optional, defaults to msatailcorrelation
    //   useTrackingLocalStorage - optional, should local storage be inspected for user and session tracking, defaults to true
    //   useTrackingCookies - optional, should user tracking cookies be inspected, defaults to true
    //   sessionTrackingCookieName - optional, name of the session tracking cookie, defaults to msasessiontracker
    //   userTrackingCookieName - optional, name of the user tracking cookie, defaults to msausertracker
    // 
    // You can set both a whitelist and a blacklist but you only need one.
    //
    // Supported events for auto started journeys are:
    //   click
    analytics.configure = function (options) {
        propertyId = options.propertyId;
        propertyKey = options.propertyKey;
        if (options.uploadIntervalMs) {
            interval = options.uploadIntervalMs;
        }
        if (options.collectionEndpoint) {
            collectionEndPoint = options.collectionEndpoint;
        }
        if (options.correlationIdKey) {
            correlationIdKey = options.correlationIdKey;
        }
        if (options.correlationEnabled !== undefined) {
            correlationEnabled = options.correlationEnabled;
        }
        if (options.correlationIdPrefix) {
            correlationIdPrefix = options.correlationIdPrefix;
        }
        else {
            correlationIdPrefix = propertyId + '-';
        }
        if (options.autoStartJourneys !== undefined) {
            autoStartJourneys = options.autoStartJourneys;
        }
        if (options.httpBlacklist) {
            httpBlacklist = options.httpBlacklist;
        }
        if (options.httpWhitelist) {
            httpWhitelist = options.httpWhitelist;
        }
        if (options.userIdProvider) {
            userIdProvider = options.userIdProvider;
        }
        if (options.userIdKey) {
            userIdKey = options.userIdKey;
        }
        if (options.sessionIdProvider) {
            sessionIdProvider = options.sessionIdProvider;
        }
        if (options.sessionIdKey) {
            sessionIdKey = options.sessionIdKey;
        }
        if (options.corePageViewReportingEnabled !== undefined) {
            corePageViewReportingEnabled = options.corePageViewReportingEnabled;
        }
        if (options.useTrackingCookies !== undefined) {
            useTrackingCookies = options.useTrackingCookies;
        }
        if (options.useTrackingLocalStorage !== undefined) {
            useTrackingLocalStorage = options.useTrackingLocalStorage;
        }
        userTrackingCookieName = options.userTrackingCookieName || userTrackingCookieName;
        sessionTrackingCookieName = options.sessionTrackingCookieName || sessionTrackingCookieName;
        tailCorrelationCookieName = options.tailCorrelationCookieName || tailCorrelationCookieName;
        if (autoStartJourneys) {
            captureEvents();
        }
        if (window) {
            window.addEventListener("error", errorHandler, true);
        }
        
        if (corePageViewReportingEnabled && window) {
            // if we're catching page view data on page load then we need to fire it off
            var tailCorrelationCookieValue = getCookie(tailCorrelationCookieName);
            if (tailCorrelationCookieValue !== undefined && tailCorrelationCookieValue !== null) {
                if (tailCorrelationCookieValue.length === 0) {
                    tailCorrelationCookieValue = undefined;
                }
            }
            analytics.pageView(window.location.toString(), null, tailCorrelationCookieValue);
            uploadData();
        }
        else {
            // if we're not catching page view data on page load then we can wait for a period
            // before attempting an upload
            scheduleNextUpload();    
        }
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
            EventStartDateTime: formatLocalDate(),
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
        if (isDisabledDueToAuthorizationFailure) return;
        
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
    analytics.pageView = function(url, additionalData, correlationId) {
        if (!additionalData) {
            additionalData = { };
        }
        additionalData.Url = url;
        var pageViewEvent = {
            EventType: "pageview",
            EventStartDateTime: formatLocalDate(),
            EventEndDateTime: null,
            CorrelationIds: [ correlationId ? correlationId : getOrCreateCorrelationId() ],
            UserId: userIdProvider(),
            SessionId: sessionIdProvider(),
            Data: additionalData
        };
        queuedEvents.push(pageViewEvent);
    }
    analytics.handleJavaScriptError = function (exception) {
        if (isDisabledDueToAuthorizationFailure) return;
        
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
            EventStartDateTime: formatLocalDate(),
            EventEndDateTime: null,
            CorrelationIds: [ getOrCreateCorrelationId() ],
            UserId: userIdProvider(),
            SessionId: sessionIdProvider(),
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
    analytics.createCorrelationId = createCorrelationId;
    analytics.getContextualCorrelationId = function() { return null; }
    

    global.hubAnalytics = analytics;
}).call(this);