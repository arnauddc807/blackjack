/**
 * One call for everything the table does to your senses.
 *
 * On the web this is the sound module and nothing else. Inside the iOS
 * shell the same call also drives the Taptic Engine, so a card landing
 * is heard and felt from a single line in the interface code.
 */

/* global Blackjack */

var Blackjack = Blackjack || {};

Blackjack.Feedback = (function() {
    'use strict';

    // How each of the table's moments should feel in the hand
    var TAPS = {
        deal: 'LIGHT',
        flip: 'LIGHT',
        chip: 'MEDIUM',
        shuffle: 'MEDIUM',
        correct: 'SUCCESS',
        close: 'LIGHT',
        wrong: 'WARNING',
        bust: 'HEAVY',
        win: 'SUCCESS',
        blackjack: 'SUCCESS',
        lose: 'MEDIUM',
        push: 'LIGHT'
    };

    var NOTIFICATIONS = { SUCCESS: true, WARNING: true, ERROR: true };

    var lastTap = 0;

    /**
     * The native plugin, or nothing at all in a browser. Capacitor
     * exposes installed plugins on the bridge, so no import is needed.
     */
    function haptics() {
        return window.Capacitor &&
            window.Capacitor.Plugins &&
            window.Capacitor.Plugins.Haptics;
    }

    function tap(name) {
        var plugin = haptics();
        var kind = TAPS[name];

        if (!plugin || !kind) {
            return;
        }

        // A four card deal should feel like a riffle, not a rattle
        var now = Date.now();

        if (now - lastTap < 60) {
            return;
        }

        lastTap = now;

        try {
            if (NOTIFICATIONS[kind]) {
                plugin.notification({ type: kind });
            } else {
                plugin.impact({ style: kind });
            }
        } catch (error) {
            // A missing Taptic Engine is not a reason to stop the game
        }
    }

    return {
        /**
         * Play one of the table's moments.
         *
         * @param {String} name
         * @param {Number} delay seconds to wait first, matching the card
         *                 that is still in the air
         */
        emit: function(name, delay) {
            Blackjack.Sound.play(name, delay);

            if (!Blackjack.Sound.isEnabled()) {
                return;
            }

            if (delay) {
                setTimeout(function() {
                    tap(name);
                }, delay * 1000);
            } else {
                tap(name);
            }
        },

        /**
         * True when running inside the native shell.
         */
        isNative: function() {
            return !!haptics();
        }
    };
}());
