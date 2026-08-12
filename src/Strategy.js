/**
 * An exact, composition dependent expected value engine for blackjack,
 * plus the basic strategy chart it can be measured against.
 *
 * Every card left unseen is tracked as a count per value, so the answers
 * follow the real shoe rather than an idealised infinite deck. For any
 * decision point the engine returns the expected value of standing,
 * hitting, doubling, splitting and surrendering, in units of the
 * original bet.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 */

var Blackjack = Blackjack || {};

if (typeof module !== 'undefined' && module.exports && !Blackjack.Utils) {
    Blackjack.Utils = require('./Utils.js');
}

Blackjack.Strategy = (function() {
    'use strict';

    var HIT = 'Hit';
    var STAND = 'Stand';
    var SPLIT = 'Split';
    var DOUBLE = 'Double';
    var SURRENDER = 'Surrender';

    // Dealer outcome buckets: totals 17-21, a bust, and a natural.
    var BUST = 5;
    var NATURAL = 6;

    var DEFAULTS = {
        dealerHitSoft17: true,
        doubleAfterSplit: true,
        surrender: true,
        maxSplitHands: 4,
        resplitAces: false,
        peek: true
    };

    /**
     * A shoe composition is identified by two integers, six bits per
     * card value: low holds aces through fives, high holds sixes
     * through tens. Both stay well inside the safe integer range and
     * can be updated by adding or subtracting a single power of two,
     * which keeps the recursion free of string building.
     */
    var LOW = [0, 1, 64, 4096, 262144, 16777216, 0, 0, 0, 0, 0];
    var HIGH = [0, 0, 0, 0, 0, 0, 1, 64, 4096, 262144, 16777216];

    // Memo tables, two levels deep: composition then hand.
    var memoDealer, memoDealerPlay, memoStand, memoHit, memoSplit;
    var memoSize = 0;
    var memoRules = '';
    var MEMO_LIMIT = 600000;

    /**
     * Drop every memo table. Called when the house rules change and
     * whenever the tables outgrow a sane size for a phone.
     */
    function reset() {
        memoDealer = new Map();
        memoDealerPlay = new Map();
        memoStand = new Map();
        memoHit = new Map();
        memoSplit = new Map();
        memoSize = 0;
    }

    reset();

    function lookup(table, low, high, hand) {
        var inner = table.get(low);

        if (inner === undefined) {
            return undefined;
        }

        return inner.get(high * 2048 + hand);
    }

    function store(table, low, high, hand, value) {
        var inner = table.get(low);

        if (inner === undefined) {
            inner = new Map();
            table.set(low, inner);
        }

        inner.set(high * 2048 + hand, value);
        memoSize += 1;

        if (memoSize > MEMO_LIMIT) {
            reset();
        }

        return value;
    }

    function settings(rules) {
        var merged = {};
        var key;

        for (key in DEFAULTS) {
            if (DEFAULTS.hasOwnProperty(key)) {
                merged[key] = DEFAULTS[key];
            }
        }

        for (key in (rules || {})) {
            if (rules.hasOwnProperty(key)) {
                merged[key] = rules[key];
            }
        }

        // Memoised values only hold for one set of house rules.
        var fingerprint = [
            merged.dealerHitSoft17, merged.doubleAfterSplit, merged.surrender,
            merged.maxSplitHands, merged.resplitAces, merged.peek
        ].join('/');

        if (fingerprint !== memoRules) {
            memoRules = fingerprint;
            reset();
        }

        return merged;
    }

    function lowKey(counts) {
        return counts[1] + counts[2] * 64 + counts[3] * 4096 + counts[4] * 262144 + counts[5] * 16777216;
    }

    function highKey(counts) {
        return counts[6] + counts[7] * 64 + counts[8] * 4096 + counts[9] * 262144 + counts[10] * 16777216;
    }

    function cardsLeft(counts) {
        var sum = 0;

        for (var i = 1; i <= 10; i+=1) {
            sum += counts[i];
        }

        return sum;
    }

    /**
     * The playing total of a hand held as a hard sum plus an ace flag.
     */
    function total(sum, ace) {
        return (ace && sum + 10 <= 21) ? sum + 10 : sum;
    }

    function isSoft(sum, ace) {
        return !!ace && sum + 10 <= 21;
    }

    /**
     * Play the dealer hand out to a final total.
     *
     * @return {Array} probability of each outcome bucket
     */
    function dealerPlay(sum, ace, counts, left, low, high, rules) {
        var playing = total(sum, ace);

        if (playing > 21) {
            return [0,0,0,0,0,1,0];
        }

        var soft = isSoft(sum, ace);

        if (playing > 17 || (playing === 17 && !(soft && rules.dealerHitSoft17))) {
            var made = [0,0,0,0,0,0,0];
            made[playing - 17] = 1;
            return made;
        }

        var hand = sum * 2 + (soft ? 1 : 0);
        var cached = lookup(memoDealerPlay, low, high, hand);

        if (cached !== undefined) {
            return cached;
        }

        var out = [0,0,0,0,0,0,0];

        for (var v = 1; v <= 10; v+=1) {
            if (counts[v] === 0) {
                continue;
            }

            var p = counts[v] / left;

            counts[v] -= 1;
            var next = dealerPlay(sum + v, ace || v === 1, counts, left - 1, low - LOW[v], high - HIGH[v], rules);
            counts[v] += 1;

            for (var b = 0; b < 7; b+=1) {
                out[b] += p * next[b];
            }
        }

        return store(memoDealerPlay, low, high, hand, out);
    }

    /**
     * The distribution of dealer final totals given an upcard and the
     * cards still unseen, which include the hole card.
     *
     * @param {Integer} up
     * @param {Array} counts
     * @param {Object} rules
     * @return {Array} probability of each outcome bucket
     */
    function dealer(up, counts, left, low, high, rules) {
        var cached = lookup(memoDealer, low, high, up);

        if (cached !== undefined) {
            return cached;
        }

        var out = [0,0,0,0,0,0,0];

        // With a peeked ace or ten showing a natural is already ruled
        // out, so those hole cards come out of the pool.
        var naturalCard = (up === 1) ? 10 : ((up === 10) ? 1 : 0);
        var excluded = (rules.peek && naturalCard) ? counts[naturalCard] : 0;
        var denominator = left - excluded;

        if (denominator <= 0) {
            return store(memoDealer, low, high, up, out);
        }

        for (var v = 1; v <= 10; v+=1) {
            if (counts[v] === 0 || (excluded && v === naturalCard)) {
                continue;
            }

            var p = counts[v] / denominator;

            if (!excluded && naturalCard && v === naturalCard) {
                out[NATURAL] += p;
                continue;
            }

            counts[v] -= 1;
            var next = dealerPlay(up + v, up === 1 || v === 1, counts, left - 1, low - LOW[v], high - HIGH[v], rules);
            counts[v] += 1;

            for (var b = 0; b < 7; b+=1) {
                out[b] += p * next[b];
            }
        }

        return store(memoDealer, low, high, up, out);
    }

    /**
     * Expected value of standing on a total.
     */
    function evStand(sum, ace, counts, left, low, high, up, rules) {
        var playing = total(sum, ace);

        if (playing > 21) {
            return -1;
        }

        var hand = playing * 11 + up;
        var cached = lookup(memoStand, low, high, hand);

        if (cached !== undefined) {
            return cached;
        }

        var d = dealer(up, counts, left, low, high, rules);
        var ev = d[BUST] - d[NATURAL];

        for (var t = 17; t <= 21; t+=1) {
            var p = d[t - 17];

            if (p === 0) {
                continue;
            }

            if (playing > t) {
                ev += p;
            } else if (playing < t) {
                ev -= p;
            }
        }

        return store(memoStand, low, high, hand, ev);
    }

    /**
     * Expected value of hitting, assuming the hand is then played out
     * optimally: hit or stand, no doubling after a hit.
     */
    function evHit(sum, ace, counts, left, low, high, up, rules) {
        var hand = (sum * 2 + (isSoft(sum, ace) ? 1 : 0)) * 11 + up;
        var cached = lookup(memoHit, low, high, hand);

        if (cached !== undefined) {
            return cached;
        }

        var ev = 0;

        for (var v = 1; v <= 10; v+=1) {
            if (counts[v] === 0) {
                continue;
            }

            var p = counts[v] / left;
            var nextSum = sum + v;
            var nextAce = ace || v === 1;
            var value;

            if (total(nextSum, nextAce) > 21) {
                value = -1;
            } else {
                counts[v] -= 1;
                var nextLow = low - LOW[v];
                var nextHigh = high - HIGH[v];
                value = Math.max(
                    evStand(nextSum, nextAce, counts, left - 1, nextLow, nextHigh, up, rules),
                    evHit(nextSum, nextAce, counts, left - 1, nextLow, nextHigh, up, rules)
                );
                counts[v] += 1;
            }

            ev += p * value;
        }

        return store(memoHit, low, high, hand, ev);
    }

    /**
     * Expected value of doubling down: exactly one more card, twice the
     * money on the table.
     */
    function evDouble(sum, ace, counts, left, low, high, up, rules) {
        var ev = 0;

        for (var v = 1; v <= 10; v+=1) {
            if (counts[v] === 0) {
                continue;
            }

            var p = counts[v] / left;
            var nextSum = sum + v;
            var nextAce = ace || v === 1;
            var value;

            if (total(nextSum, nextAce) > 21) {
                value = -1;
            } else {
                counts[v] -= 1;
                value = evStand(nextSum, nextAce, counts, left - 1, low - LOW[v], high - HIGH[v], up, rules);
                counts[v] += 1;
            }

            ev += p * 2 * value;
        }

        return ev;
    }

    /**
     * Expected value of one hand created by a split. The pair card is
     * already out of the shoe, so the hand draws a single card and is
     * then played out: doubling when the house allows it, and a further
     * split while there are hands left to make.
     *
     * The two halves of a split are valued independently, the usual
     * simplification, so the cards one hand consumes are not tracked
     * against the other.
     */
    function evSplitHand(pair, counts, left, low, high, up, rules, splitsLeft) {
        var hand = (pair * 4 + splitsLeft) * 11 + up;
        var cached = lookup(memoSplit, low, high, hand);

        if (cached !== undefined) {
            return cached;
        }

        var ev = 0;
        var aces = (pair === 1);

        for (var v = 1; v <= 10; v+=1) {
            if (counts[v] === 0) {
                continue;
            }

            var p = counts[v] / left;
            var sum = pair + v;
            var ace = (pair === 1 || v === 1);
            var value;

            counts[v] -= 1;
            var nextLow = low - LOW[v];
            var nextHigh = high - HIGH[v];

            if (v === pair && splitsLeft > 0 && (!aces || rules.resplitAces)) {
                // Splitting again replaces this hand with two fresh ones.
                value = 2 * evSplitHand(pair, counts, left - 1, nextLow, nextHigh, up, rules, splitsLeft - 1);
            } else if (aces) {
                // Split aces draw one card and are done.
                value = evStand(sum, ace, counts, left - 1, nextLow, nextHigh, up, rules);
            } else {
                value = Math.max(
                    evStand(sum, ace, counts, left - 1, nextLow, nextHigh, up, rules),
                    evHit(sum, ace, counts, left - 1, nextLow, nextHigh, up, rules)
                );

                if (rules.doubleAfterSplit) {
                    value = Math.max(value, evDouble(sum, ace, counts, left - 1, nextLow, nextHigh, up, rules));
                }
            }

            counts[v] += 1;
            ev += p * value;
        }

        return store(memoSplit, low, high, hand, ev);
    }

    /**
     * The textbook basic strategy play for a hand, for four to eight
     * decks. Returns one of Hit, Stand, Double, Split or Surrender.
     * Double and Surrender fall back to their alternative when the rule
     * or the hand does not allow them.
     *
     * @param {Object} hand {total, soft, pair, cards}
     * @param {Integer} up dealer upcard value, ace is 1
     * @param {Object} rules
     * @param {Object} allowed {double, split, surrender}
     * @return {String} action
     */
    function basic(hand, up, rules, allowed) {
        rules = rules || DEFAULTS;
        allowed = allowed || {};

        var h17 = rules.dealerHitSoft17;
        var das = rules.doubleAfterSplit;
        var canDouble = allowed.double !== false;
        var canSplit = allowed.split !== false;
        var canSurrender = allowed.surrender !== false && rules.surrender !== false;
        var t = hand.total;

        function double(fallback) {
            return canDouble ? DOUBLE : fallback;
        }

        function surrender(fallback) {
            return canSurrender ? SURRENDER : fallback;
        }

        // Pairs
        if (hand.pair && canSplit) {
            var pair = hand.pair;

            if (pair === 1) {
                return SPLIT;
            }
            if (pair === 8) {
                if (h17 && up === 1 && canSurrender) {
                    return SURRENDER;
                }
                return SPLIT;
            }
            if (pair === 9) {
                return (up === 7 || up === 10 || up === 1) ? STAND : SPLIT;
            }
            if (pair === 7) {
                return (up >= 2 && up <= 7) ? SPLIT : HIT;
            }
            if (pair === 6) {
                if (up >= 3 && up <= 6) { return SPLIT; }
                if (up === 2 && das) { return SPLIT; }
                return HIT;
            }
            if (pair === 4) {
                return (das && (up === 5 || up === 6)) ? SPLIT : HIT;
            }
            if (pair === 3 || pair === 2) {
                if (up >= 4 && up <= 7) { return SPLIT; }
                if ((up === 2 || up === 3) && das) { return SPLIT; }
                return HIT;
            }
            // Fives and tens are never split, they fall through as totals.
        }

        // Soft totals
        if (hand.soft && t <= 21) {
            if (t >= 20) { return STAND; }
            if (t === 19) {
                return (h17 && up === 6) ? double(STAND) : STAND;
            }
            if (t === 18) {
                if (up >= 3 && up <= 6) { return double(STAND); }
                if (up === 2) { return h17 ? double(STAND) : STAND; }
                return (up === 7 || up === 8) ? STAND : HIT;
            }
            if (t === 17) { return (up >= 3 && up <= 6) ? double(HIT) : HIT; }
            if (t === 16 || t === 15) { return (up >= 4 && up <= 6) ? double(HIT) : HIT; }
            if (t === 14 || t === 13) { return (up >= 5 && up <= 6) ? double(HIT) : HIT; }
            return HIT;
        }

        // Hard totals
        if (t >= 17) {
            if (t === 17 && h17 && up === 1 && hand.cards === 2) {
                return surrender(STAND);
            }
            return STAND;
        }
        if (t === 16) {
            if (hand.cards === 2 && (up === 9 || up === 10 || up === 1)) {
                return surrender(HIT);
            }
            return (up >= 2 && up <= 6) ? STAND : HIT;
        }
        if (t === 15) {
            if (hand.cards === 2 && (up === 10 || (up === 1 && h17))) {
                return surrender(HIT);
            }
            return (up >= 2 && up <= 6) ? STAND : HIT;
        }
        if (t >= 13) { return (up >= 2 && up <= 6) ? STAND : HIT; }
        if (t === 12) { return (up >= 4 && up <= 6) ? STAND : HIT; }
        if (t === 11) {
            return (up === 1 && !h17) ? HIT : double(HIT);
        }
        if (t === 10) { return (up >= 2 && up <= 9) ? double(HIT) : HIT; }
        if (t === 9) { return (up >= 3 && up <= 6) ? double(HIT) : HIT; }

        return HIT;
    }

    return {
        HIT: HIT,
        STAND: STAND,
        SPLIT: SPLIT,
        DOUBLE: DOUBLE,
        SURRENDER: SURRENDER,
        reset: reset,

        /**
         * The textbook play, see basic() above.
         */
        basic: function(hand, up, rules, allowed) {
            return basic(hand, up, settings(rules), allowed);
        },

        /**
         * The dealer's final total distribution.
         *
         * @param {Integer} up
         * @param {Array} counts unseen cards, hole card included
         * @param {Object} rules
         * @return {Object}
         */
        dealer: function(up, counts, rules) {
            var work = counts.slice();
            var d = dealer(up, work, cardsLeft(work), lowKey(work), highKey(work), settings(rules));

            return {
                seventeen: d[0],
                eighteen: d[1],
                nineteen: d[2],
                twenty: d[3],
                twentyone: d[4],
                bust: d[BUST],
                blackjack: d[NATURAL]
            };
        },

        /**
         * Work out the expected value of every action available at a
         * decision point. Values are in units of the original bet, so
         * -0.5 is the cost of a surrender and +1 is winning it outright.
         *
         * @param {Object} options
         *   - counts {Array} unseen cards by value, hole card included
         *   - playerCards {Array} the hand being decided, or
         *   - player {Object} {total, soft, pair, cards}
         *   - up {Integer} dealer upcard value, ace is 1
         *   - rules {Object}
         *   - allowed {Object} {double, split, surrender}
         * @return {Object} analysis
         */
        analyze: function(options) {
            var rules = settings(options.rules);
            var counts = options.counts.slice();
            var up = options.up;
            var allowed = options.allowed || {};

            var sum = 0;
            var ace = false;
            var cards = 0;
            var pair = 0;
            var i;

            if (options.playerCards) {
                var values = [];

                for (i = 0; i < options.playerCards.length; i+=1) {
                    var v = Blackjack.Utils.value(options.playerCards[i]);
                    values.push(v);
                    sum += v;
                    ace = ace || v === 1;
                }

                cards = values.length;

                if (cards === 2 && values[0] === values[1]) {
                    pair = values[0];
                }
            } else {
                cards = options.player.cards;
                pair = options.player.pair || 0;
                ace = !!options.player.soft;
                sum = options.player.soft ? options.player.total - 10 : options.player.total;
            }

            var left = cardsLeft(counts);
            var low = lowKey(counts);
            var high = highKey(counts);
            var ev = {};

            ev[STAND] = evStand(sum, ace, counts, left, low, high, up, rules);
            ev[HIT] = evHit(sum, ace, counts, left, low, high, up, rules);

            if (allowed.double !== false && cards === 2) {
                ev[DOUBLE] = evDouble(sum, ace, counts, left, low, high, up, rules);
            }

            if (allowed.split !== false && pair) {
                var splitsLeft = Math.max(0, (rules.maxSplitHands || 4) - 2);
                ev[SPLIT] = 2 * evSplitHand(pair, counts, left, low, high, up, rules, splitsLeft);
            }

            if (allowed.surrender !== false && rules.surrender && cards === 2) {
                ev[SURRENDER] = -0.5;
            }

            var best = null;
            var bestEv = -Infinity;
            var action;

            for (action in ev) {
                if (ev.hasOwnProperty(action) && ev[action] > bestEv) {
                    bestEv = ev[action];
                    best = action;
                }
            }

            var hand = {
                total: total(sum, ace),
                soft: isSoft(sum, ace),
                pair: pair,
                cards: cards
            };

            var d = dealer(up, counts, left, low, high, rules);

            return {
                ev: ev,
                best: best,
                bestEv: bestEv,
                hand: hand,
                up: up,
                basic: basic(hand, up, rules, {
                    double: allowed.double !== false && cards === 2,
                    split: allowed.split !== false && !!pair,
                    surrender: allowed.surrender !== false && rules.surrender && cards === 2
                }),
                dealer: {
                    seventeen: d[0],
                    eighteen: d[1],
                    nineteen: d[2],
                    twenty: d[3],
                    twentyone: d[4],
                    bust: d[BUST],
                    blackjack: d[NATURAL]
                }
            };
        }
    };
}());

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Blackjack.Strategy;
}
