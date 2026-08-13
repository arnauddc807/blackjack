/**
 * The table's noises, synthesised on the fly.
 *
 * There are no audio files to download: cards are filtered noise,
 * chips are a short resonant click, and the verdicts are a few notes.
 * Everything is built the first time the player touches the screen,
 * which is the only moment iOS will let audio start.
 */

/* global webkitAudioContext */

var Blackjack = Blackjack || {};

Blackjack.Sound = (function() {
    'use strict';

    var ctx = null;
    var master = null;
    var noise = null;
    var enabled = true;
    var lastPlayed = {};

    // Seconds added to everything a voice schedules, so one sound can be
    // pushed back to line up with a card that is still in the air.
    var offset = 0;

    /**
     * A second of white noise, reused by every card and shuffle sound.
     */
    function buildNoise() {
        var buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        var data = buffer.getChannelData(0);

        for (var i = 0; i < data.length; i+=1) {
            data[i] = Math.random() * 2 - 1;
        }

        return buffer;
    }

    /**
     * Bring the audio context up. Must be called from inside a touch or
     * click handler the first time, or iOS leaves it suspended.
     */
    function unlock() {
        if (!ctx) {
            var Context = window.AudioContext || window.webkitAudioContext;

            if (!Context) {
                return false;
            }

            try {
                ctx = new Context();
            } catch (error) {
                return false;
            }

            master = ctx.createGain();
            master.gain.value = 0.85;
            master.connect(ctx.destination);
            noise = buildNoise();
        }

        if (ctx.state === 'suspended' && ctx.resume) {
            ctx.resume();
        }

        return true;
    }

    /**
     * One note, shaped by a short attack and an exponential tail.
     *
     * @param {Number} frequency
     * @param {Object} options {at, duration, gain, type, sweep}
     */
    function tone(frequency, options) {
        options = options || {};

        var start = ctx.currentTime + offset + (options.at || 0);
        var length = options.duration || 0.12;
        var level = options.gain || 0.12;
        var oscillator = ctx.createOscillator();
        var envelope = ctx.createGain();

        oscillator.type = options.type || 'triangle';
        oscillator.frequency.setValueAtTime(frequency, start);

        if (options.sweep) {
            oscillator.frequency.exponentialRampToValueAtTime(options.sweep, start + length);
        }

        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(level, start + 0.012);
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);

        oscillator.connect(envelope);
        envelope.connect(master);
        oscillator.start(start);
        oscillator.stop(start + length + 0.02);
    }

    /**
     * A burst of noise through a moving filter: card on felt, chips,
     * the riffle of a fresh shoe.
     *
     * @param {Object} options {at, duration, gain, from, to, type, q}
     */
    function rush(options) {
        options = options || {};

        var start = ctx.currentTime + offset + (options.at || 0);
        var length = options.duration || 0.14;
        var level = options.gain || 0.1;
        var source = ctx.createBufferSource();
        var filter = ctx.createBiquadFilter();
        var envelope = ctx.createGain();

        source.buffer = noise;
        source.loop = true;
        filter.type = options.type || 'bandpass';
        filter.Q.value = options.q || 1.1;
        filter.frequency.setValueAtTime(options.from || 1600, start);
        filter.frequency.exponentialRampToValueAtTime(options.to || 700, start + length);

        envelope.gain.setValueAtTime(0.0001, start);
        envelope.gain.exponentialRampToValueAtTime(level, start + (options.attack || 0.014));
        envelope.gain.exponentialRampToValueAtTime(0.0001, start + length);

        source.connect(filter);
        filter.connect(envelope);
        envelope.connect(master);
        source.start(start);
        source.stop(start + length + 0.02);
    }

    var VOICES = {
        // A card sliding onto the felt
        deal: function() {
            rush({ duration: 0.13, gain: 0.09, from: 2600, to: 700, q: 0.8 });
        },

        // The hole card turning over
        flip: function() {
            rush({ duration: 0.1, gain: 0.1, from: 900, to: 2600, q: 1.4 });
            tone(320, { at: 0.05, duration: 0.06, gain: 0.05, type: 'sine' });
        },

        // Chips going into the betting box
        chip: function() {
            rush({ duration: 0.05, gain: 0.09, from: 4200, to: 2600, q: 3, attack: 0.004 });
            tone(1750, { duration: 0.05, gain: 0.045, type: 'square' });
        },

        // A new shoe
        shuffle: function() {
            rush({ duration: 0.5, gain: 0.07, from: 900, to: 3200, q: 0.7, attack: 0.15 });
            rush({ at: 0.18, duration: 0.34, gain: 0.05, from: 2600, to: 800, q: 0.9 });
        },

        // You found the best play
        correct: function() {
            tone(587.33, { duration: 0.1, gain: 0.09 });
            tone(880, { at: 0.085, duration: 0.16, gain: 0.08 });
        },

        // Near enough
        close: function() {
            tone(523.25, { duration: 0.13, gain: 0.07 });
        },

        // Something better was on the table
        wrong: function() {
            tone(392, { duration: 0.11, gain: 0.08 });
            tone(277.18, { at: 0.09, duration: 0.2, gain: 0.075 });
        },

        // Over twenty one
        bust: function() {
            tone(180, { duration: 0.3, gain: 0.13, type: 'sawtooth', sweep: 70 });
            rush({ duration: 0.22, gain: 0.06, from: 700, to: 180, q: 0.6 });
        },

        win: function() {
            tone(523.25, { duration: 0.09, gain: 0.085 });
            tone(659.25, { at: 0.075, duration: 0.09, gain: 0.085 });
            tone(783.99, { at: 0.15, duration: 0.2, gain: 0.09 });
        },

        blackjack: function() {
            tone(523.25, { duration: 0.08, gain: 0.09 });
            tone(659.25, { at: 0.07, duration: 0.08, gain: 0.09 });
            tone(783.99, { at: 0.14, duration: 0.08, gain: 0.09 });
            tone(1046.5, { at: 0.21, duration: 0.3, gain: 0.1 });
            rush({ at: 0.21, duration: 0.4, gain: 0.03, from: 5000, to: 9000, q: 0.5, attack: 0.1 });
        },

        lose: function() {
            tone(311.13, { duration: 0.13, gain: 0.075 });
            tone(220, { at: 0.11, duration: 0.24, gain: 0.07 });
        },

        push: function() {
            tone(440, { duration: 0.16, gain: 0.06, type: 'sine' });
        }
    };

    /**
     * Schedule one voice, dropping it when the same sound is already
     * landing at the same moment: two cards dealt together would stack
     * into one loud hit. Times are compared against everything else on
     * the queue, since sounds are scheduled out of order.
     */
    function fire(name, delay) {
        var now = ctx.currentTime + (delay || 0);
        var queued = lastPlayed[name];
        var i;

        if (!queued) {
            queued = lastPlayed[name] = [];
        }

        for (i = queued.length - 1; i >= 0; i-=1) {
            if (queued[i] < ctx.currentTime - 1) {
                queued.splice(i, 1);
            } else if (Math.abs(now - queued[i]) < 0.035) {
                return;
            }
        }

        queued.push(now);

        try {
            offset = delay || 0;
            VOICES[name]();
            offset = 0;
        } catch (error) {
            // A hostile audio stack is not a reason to stop the game
        }
    }

    return {
        /**
         * Start the audio context. Call it from a touch handler.
         */
        unlock: unlock,

        isEnabled: function() {
            return enabled;
        },

        setEnabled: function(value) {
            enabled = !!value;

            if (enabled) {
                unlock();
            }
        },

        /**
         * Make one of the table's noises. The first sound of a session
         * arrives while the context is still waking up, so it waits for
         * that rather than being dropped.
         *
         * @param {String} name
         * @param {Number} delay seconds to wait first
         */
        play: function(name, delay) {
            if (!enabled || !VOICES[name]) {
                return;
            }

            if (!ctx && !unlock()) {
                return;
            }

            if (ctx.state !== 'running') {
                var resuming = ctx.resume && ctx.resume();

                if (resuming && resuming.then) {
                    resuming.then(function() {
                        if (enabled && ctx.state === 'running') {
                            fire(name, delay);
                        }
                    });
                }

                return;
            }

            fire(name, delay);
        }
    };
}());
