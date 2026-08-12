/**
 * Runs the expected value engine off the main thread so the table keeps
 * animating while a hand is being solved.
 */

/* global importScripts, Blackjack */

importScripts('../src/Utils.js', '../src/Strategy.js');

self.onmessage = function(event) {
    var message = event.data;

    try {
        self.postMessage({
            id: message.id,
            result: Blackjack.Strategy.analyze(message.payload)
        });
    } catch (error) {
        self.postMessage({
            id: message.id,
            error: error.message
        });
    }
};
