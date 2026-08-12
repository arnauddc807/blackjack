/**
 * A utility library for all related blackjack functions.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Author: Chris Zieba <zieba.chris@gmail.com>
 */

var Blackjack = Blackjack || {};

Blackjack.Utils = {

    /**
     * The value of a single card. An ace is always returned as a 1,
     * the caller is responsible for deciding if it can be an 11.
     *
     * @param {Object} card
     * @return {Integer} value
     */
    value: function(card) {
        var rank = card.rank;

        if (rank === 'J' || rank === 'Q' || rank === 'K' || rank === '10') {
            return 10;
        }

        if (rank === 'A') {
            return 1;
        }

        return parseInt(rank, 10);
    },

    /**
     * Calculates the score total of a blackjack hand.
     * An ace is treated as 11 until the score is above
     * 21 then it is used as a 1 instead. Returns an
     * integer value of the score of the hand.
     *
     * @param {Array} cards
     * @return {Integer} sum
     */
    score: function(cards) {
        var sum = 0;

        // A flag to determine whether the hand has an ace
        var ace;

        for (var i = 0, value; i < cards.length; i+=1) {
            if (cards[i].rank === 'J' || cards[i].rank === 'Q' || cards[i].rank === 'K') {
                value = 10;
            } else if (cards[i].rank === 'A') {
                value = 1;
                ace = true;
            } else {
                value = parseInt(cards[i].rank, 10);
            }

            sum += value;
        }

        // Treat the ace as an 11 if the hand will not bust
        if (ace && sum < 12) {
            sum += 10;
        }

        return sum;
    },

    /**
     * A richer description of a hand than score() alone.
     * A hand is soft when it holds an ace that is currently
     * counted as eleven.
     *
     * @param {Array} cards
     * @return {Object} hand
     */
    hand: function(cards) {
        var sum = 0;
        var aces = 0;

        for (var i = 0, value; i < cards.length; i+=1) {
            value = Blackjack.Utils.value(cards[i]);

            if (value === 1) {
                aces += 1;
            }

            sum += value;
        }

        var soft = (aces > 0 && sum < 12);
        var total = soft ? sum + 10 : sum;

        return {
            total: total,
            soft: soft,
            bust: total > 21,
            blackjack: (cards.length === 2 && total === 21),
            cards: cards.length
        };
    },

    /**
     * True when two cards make twenty one.
     *
     * @param {Array} cards
     * @return {Boolean}
     */
    isBlackjack: function(cards) {
        return cards.length === 2 && Blackjack.Utils.score(cards) === 21;
    },

    /**
     * Reduce a list of cards to a count of each card value, where
     * index 1 holds the aces and index 10 holds every ten valued
     * card. This is the representation the probability engine works
     * with, since only the value of a card matters in blackjack.
     *
     * @param {Array} cards
     * @return {Array} counts
     */
    counts: function(cards) {
        var counts = [0,0,0,0,0,0,0,0,0,0,0];

        for (var i = 0; i < cards.length; i+=1) {
            counts[Blackjack.Utils.value(cards[i])] += 1;
        }

        return counts;
    },

    /**
     * The number of cards described by a count vector.
     *
     * @param {Array} counts
     * @return {Integer}
     */
    total: function(counts) {
        var sum = 0;

        for (var i = 1; i <= 10; i+=1) {
            sum += counts[i];
        }

        return sum;
    },

    /**
     * The Hi-Lo running count of a list of cards. Low cards (2-6) are
     * worth +1, tens and aces are worth -1, everything else is neutral.
     *
     * @param {Array} cards
     * @return {Integer}
     */
    runningCount: function(cards) {
        var count = 0;

        for (var i = 0, value; i < cards.length; i+=1) {
            value = Blackjack.Utils.value(cards[i]);

            if (value >= 2 && value <= 6) {
                count += 1;
            } else if (value === 1 || value === 10) {
                count -= 1;
            }
        }

        return count;
    }
};

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Blackjack.Utils;
}
