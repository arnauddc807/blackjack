/**
 * A blackjack game engine.
 *
 * Handles a shoe with a cut card, betting, splits, doubles, surrender,
 * insurance, the dealer's peek for a natural, and settlement.
 *
 * This source code is licensed under the MIT-style license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * Author: Chris Zieba (zieba.chris@gmail.com)
 */

var Blackjack = Blackjack || {};

if (typeof module !== 'undefined' && module.exports && !Blackjack.Utils) {
    Blackjack.Utils = require('./Utils.js');
}

Blackjack.Game = (function() {
    'use strict';

    var SUITS = ['♥', '♦', '♠', '♣'];
    var RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
    var HIT = 'Hit';
    var STAND = 'Stand';
    var SPLIT = 'Split';
    var DOUBLE = 'Double';
    var SURRENDER = 'Surrender';

    // Round states
    var IDLE = 'idle';
    var INSURANCE = 'insurance';
    var PLAYER = 'player';
    var DEALER = 'dealer';
    var SETTLED = 'settled';

    var DEFAULTS = {
        numberOfDecks: 6,
        dealerHitSoft17: true,
        blackjackPayout: 1.5,
        penetration: 0.75,
        surrender: true,
        doubleAfterSplit: true,
        maxSplitHands: 4,
        resplitAces: false,
        insurance: true,
        bankroll: 500,
        minBet: 5
    };

    /**
     * Shuffle an array of cards.
     */
    var shuffle = function() {
        var i = this.shoe.length, j, swap;

        while (--i) {
            j = Math.random() * (i + 1) | 0;
            swap = this.shoe[i];
            this.shoe[i] = this.shoe[j];
            this.shoe[j] = swap;
        }
    };

    /**
     * Load the shoe with cards.
     */
    var load = function() {
        // Empty out the shoe (just to be sure)
        this.shoe = [];

        // Create the shoe using the decks setting
        for (var i = 0; i < this.decks; i+=1) {
            for (var j = 0; j < SUITS.length; j++) {
                for (var k = 0; k < RANKS.length; k++) {
                    this.shoe.push(new Card(RANKS[k], SUITS[j]));
                }
            }
        }
    };

    /**
     * Represents a card in the shoe.
     *
     * @param {String} rank
     * @param {String} suit
     */
    function Card(rank, suit) {
        this.rank = rank;
        this.suit = suit;
    }

    /**
     * One betting box: a list of cards and the money riding on them.
     * A round starts with one hand and grows a hand per split.
     *
     * @param {Number} bet
     */
    function Hand(bet) {
        this.cards = [];
        this.bet = bet;
        this.doubled = false;
        this.split = false;
        this.splitAces = false;
        this.surrendered = false;
        this.done = false;
        this.result = null;
        this.net = 0;
    }

    Hand.prototype.getCards = function() {
        return this.cards;
    };

    Hand.prototype.score = function() {
        return Blackjack.Utils.score(this.cards);
    };

    Hand.prototype.isBust = function() {
        return this.score() > 21;
    };

    /**
     * A natural only counts when it was dealt to the box, never when it
     * was built out of a split.
     */
    Hand.prototype.isBlackjack = function() {
        return !this.split && Blackjack.Utils.isBlackjack(this.cards);
    };

    /**
     * Game Constructor.
     *
     * @param {String} player
     * @param {String} dealer
     * @param {Object} options
     */
    function Game(player, dealer, options) {
        options = options || {};

        this.options = {};

        for (var key in DEFAULTS) {
            if (DEFAULTS.hasOwnProperty(key)) {
                this.options[key] = (options[key] === undefined) ? DEFAULTS[key] : options[key];
            }
        }

        this.decks = this.options.numberOfDecks;
        this.dealerHitSoft17 = this.options.dealerHitSoft17;

        // Set the dealer
        var DEALER_NAME = dealer;
        this.dealer = new Dealer(DEALER_NAME);

        // Only one player for now
        var PLAYER_NAME = player;
        this.player = new Player(PLAYER_NAME);

        this.shoe = [];
        this.dealt = [];
        this.turn = null;
        this.hands = [];
        this.active = 0;
        this.state = IDLE;
        this.bankroll = this.options.bankroll;
        this.insuranceBet = 0;
        this.round = 0;

        load.call(this);
        shuffle.call(this);
        this.shuffled = true;
    }

    /**
     * Player model.
     */
    var Player = (function() {
        function Player(name) {
            this.name = name;
            this.cards = [];
            this.actions = [];
            this.history = [];
        }

        /**
         * Returns the players cards.
         *
         * @return {Array} cards
         */
        Player.prototype.getCards = function() {
            return this.cards;
        };

        /**
         * Can a player split their dealt cards.
         *
         * @return {Boolean}
         */
        Player.prototype.canSplit = function() {
            // The dealer can never split their cards
            if (this instanceof Dealer) {
                return false;
            }

            var cards = this.cards;
            if (cards.length === 2 && Blackjack.Utils.value(cards[0]) === Blackjack.Utils.value(cards[1])) {
                return true;
            }

            return false;
        };

        /**
         * Can a player double down their hand.
         *
         * @return {Boolean}
         */
        Player.prototype.canDouble = function() {
            // The dealer can never double down
            if (this instanceof Dealer) {
                return false;
            }

            // A double down is only allowed on the first two cards
            return this.cards.length === 2;
        };

        /**
         * Get a list of possible actions for the player.
         *
         * @return {Array}
         */
        Player.prototype.getActions = function() {
            var total = Blackjack.Utils.score(this.cards);
            this.actions = [];

            if (total < 21) {
                this.actions.push(HIT);
                this.actions.push(STAND);
            }

            if (this.canDouble()) {
                this.actions.push(DOUBLE);
            }

            if (this.canSplit()) {
                this.actions.push(SPLIT);
            }

            return this.actions;
        };

        return Player;
    }());

    /**
     * Represents the dealer (house) in the game. A dealer
     * is a subclass of the Player class.
     *
     * @param {String} name
     */
    function Dealer(name) {
        Player.call(this, name);
        this.holeCard = null;
    }

    // Attach the Player object to the Dealer prototype for subclass
    Dealer.prototype = Object.create(Player.prototype);
    Dealer.prototype.constructor = Dealer;

    /**
     * The card the dealer is showing, or null before the deal.
     */
    Dealer.prototype.getUpCard = function() {
        return this.cards.length ? this.cards[0] : null;
    };

    Game.prototype.getTurn = function() {
        return this.turn;
    };

    Game.prototype.setTurn = function(player) {
        this.turn = player;
    };

    Game.prototype.getShoe = function() {
        return this.shoe;
    };

    Game.prototype.getPlayer = function() {
        return this.player;
    };

    Game.prototype.getDealer = function() {
        return this.dealer;
    };

    Game.prototype.getState = function() {
        return this.state;
    };

    Game.prototype.getHands = function() {
        return this.hands;
    };

    Game.prototype.getHand = function() {
        return this.hands[this.active] || null;
    };

    Game.prototype.getBankroll = function() {
        return this.bankroll;
    };

    Game.prototype.getRules = function() {
        return this.options;
    };

    /**
     * The cards the player has no information about: everything still
     * in the shoe plus the dealer's hole card. This is what the
     * probability engine is handed.
     *
     * @return {Array} counts by card value
     */
    Game.prototype.getUnseenCounts = function() {
        var counts = Blackjack.Utils.counts(this.shoe);

        if (this.dealer.holeCard) {
            counts[Blackjack.Utils.value(this.dealer.holeCard)] += 1;
        }

        return counts;
    };

    /**
     * The Hi-Lo running and true count of everything face up so far.
     *
     * @return {Object}
     */
    Game.prototype.getCount = function() {
        var running = Blackjack.Utils.runningCount(this.dealt);
        var unseen = this.shoe.length + (this.dealer.holeCard ? 1 : 0);
        var decks = Math.max(0.5, unseen / 52);

        return {
            running: running,
            "true": Math.round((running / decks) * 2) / 2,
            decks: decks,
            cardsLeft: unseen
        };
    };

    /**
     * True once the shoe has passed the cut card.
     */
    Game.prototype.needsShuffle = function() {
        var used = 1 - (this.shoe.length / (this.decks * 52));

        return this.shoe.length < 15 || used >= this.options.penetration;
    };

    /**
     * Bring in a fresh shoe.
     */
    Game.prototype.shuffleShoe = function() {
        load.call(this);
        shuffle.call(this);
        this.dealt = [];
        this.shuffled = true;
    };

    /**
     * Take the next card off the shoe and remember it was seen.
     */
    Game.prototype.draw = function(hidden) {
        var card = this.shoe.pop();

        if (!hidden) {
            this.dealt.push(card);
        }

        return card;
    };

    /**
     * Handles the game setup: shuffling when the cut card is out,
     * taking the bet, dealing two cards to the player and two to the
     * dealer with the second face down, and setting the turn.
     *
     * @param {Number} bet
     * @return {Object} the game
     */
    Game.prototype.deal = function(bet) {
        bet = bet || this.options.minBet;

        if (bet > this.bankroll) {
            bet = this.bankroll;
        }

        if (this.needsShuffle()) {
            this.shuffleShoe();
        } else {
            this.shuffled = false;
        }

        this.round += 1;
        this.bankroll -= bet;
        this.insuranceBet = 0;

        var hand = new Hand(bet);

        this.hands = [hand];
        this.active = 0;
        this.dealer.cards = [];
        this.dealer.holeCard = null;
        this.player.history = [];

        // Deal to the player first and then the dealer
        hand.cards.push(this.draw());
        this.dealer.cards.push(this.draw());
        hand.cards.push(this.draw());
        this.dealer.holeCard = this.draw(true);

        // The player object mirrors the hand in play
        this.player.cards = hand.cards;
        this.turn = this.player;

        var up = Blackjack.Utils.value(this.dealer.getUpCard());

        if (this.options.insurance && up === 1 && this.bankroll >= bet / 2) {
            this.state = INSURANCE;
        } else {
            this.state = PLAYER;
            this.openPlay();
        }

        return this;
    };

    /**
     * Hand the turn to the player, unless the dealer's peek has already
     * ended the round or the player was dealt a natural, which never
     * takes an action.
     */
    Game.prototype.openPlay = function() {
        if (this.peek()) {
            return this;
        }

        if (this.hands[0].isBlackjack()) {
            this.finishHand();
        }

        return this;
    };

    /**
     * Take or decline insurance, then carry on with the deal.
     *
     * @param {Boolean} take
     */
    Game.prototype.insure = function(take) {
        if (this.state !== INSURANCE) {
            return this;
        }

        if (take) {
            this.insuranceBet = this.hands[0].bet / 2;
            this.bankroll -= this.insuranceBet;
        }

        this.state = PLAYER;
        this.openPlay();

        return this;
    };

    /**
     * The dealer checks the hole card for a natural whenever an ace or
     * a ten is showing. A natural ends the round straight away.
     */
    Game.prototype.peek = function() {
        var up = Blackjack.Utils.value(this.dealer.getUpCard());

        if (up !== 1 && up !== 10) {
            return false;
        }

        var hole = Blackjack.Utils.value(this.dealer.holeCard);
        var natural = (up === 1 && hole === 10) || (up === 10 && hole === 1);

        if (!natural) {
            return false;
        }

        this.revealHole();
        this.settle();

        return true;
    };

    /**
     * Turn the hole card face up.
     */
    Game.prototype.revealHole = function() {
        if (this.dealer.holeCard) {
            this.dealer.cards.push(this.dealer.holeCard);
            this.dealt.push(this.dealer.holeCard);
            this.dealer.holeCard = null;
        }
    };

    /**
     * Every action the active hand is allowed to take right now.
     *
     * @return {Array}
     */
    Game.prototype.getActions = function() {
        var hand = this.getHand();

        if (this.state !== PLAYER || !hand || hand.done) {
            return [];
        }

        var actions = [];
        var score = hand.score();

        if (hand.splitAces) {
            return actions;
        }

        if (score < 21) {
            actions.push(HIT);
        }

        actions.push(STAND);

        if (hand.cards.length === 2 && score < 21 && this.bankroll >= hand.bet) {
            if (!hand.split || this.options.doubleAfterSplit) {
                actions.push(DOUBLE);
            }
        }

        if (hand.cards.length === 2 &&
            Blackjack.Utils.value(hand.cards[0]) === Blackjack.Utils.value(hand.cards[1]) &&
            this.hands.length < this.options.maxSplitHands &&
            this.bankroll >= hand.bet) {

            var aces = Blackjack.Utils.value(hand.cards[0]) === 1;

            if (!aces || !hand.split || this.options.resplitAces) {
                actions.push(SPLIT);
            }
        }

        if (this.options.surrender && hand.cards.length === 2 && !hand.split) {
            actions.push(SURRENDER);
        }

        return actions;
    };

    Game.prototype.can = function(action) {
        return this.getActions().indexOf(action) !== -1;
    };

    /**
     * Draw a card to the active hand.
     */
    Game.prototype.hit = function() {
        var hand = this.getHand();

        if (!this.can(HIT)) {
            return this;
        }

        hand.cards.push(this.draw());
        this.player.history.push(HIT);

        if (hand.score() >= 21) {
            this.finishHand();
        }

        return this;
    };

    /**
     * Stop drawing to the active hand.
     */
    Game.prototype.stand = function() {
        if (!this.can(STAND)) {
            return this;
        }

        this.player.history.push(STAND);
        this.finishHand();

        return this;
    };

    /**
     * Double the bet, take exactly one card, and stop.
     */
    Game.prototype.double = function() {
        var hand = this.getHand();

        if (!this.can(DOUBLE)) {
            return this;
        }

        this.bankroll -= hand.bet;
        hand.bet *= 2;
        hand.doubled = true;
        hand.cards.push(this.draw());
        this.player.history.push(DOUBLE);
        this.finishHand();

        return this;
    };

    /**
     * Break a pair into two hands, each with its own bet.
     */
    Game.prototype.split = function() {
        var hand = this.getHand();

        if (!this.can(SPLIT)) {
            return this;
        }

        var moved = hand.cards.pop();
        var next = new Hand(hand.bet);

        this.bankroll -= hand.bet;
        next.cards.push(moved);
        next.split = true;
        hand.split = true;

        var aces = Blackjack.Utils.value(moved) === 1;

        hand.cards.push(this.draw());
        next.cards.push(this.draw());

        if (aces && !this.options.resplitAces) {
            hand.splitAces = true;
            next.splitAces = true;
        }

        this.hands.splice(this.active + 1, 0, next);
        this.player.history.push(SPLIT);
        this.player.cards = hand.cards;

        // Split aces get one card each and are then done
        if (hand.splitAces) {
            this.finishHand();
        }

        return this;
    };

    /**
     * Give up the hand for half the bet.
     */
    Game.prototype.surrender = function() {
        var hand = this.getHand();

        if (!this.can(SURRENDER)) {
            return this;
        }

        hand.surrendered = true;
        this.player.history.push(SURRENDER);
        this.finishHand();

        return this;
    };

    /**
     * Close the active hand and move to the next one, or hand over to
     * the dealer when every hand is finished.
     */
    Game.prototype.finishHand = function() {
        var hand = this.getHand();

        if (hand) {
            hand.done = true;
        }

        for (var i = this.active + 1; i < this.hands.length; i+=1) {
            if (!this.hands[i].done) {
                this.active = i;
                this.player.cards = this.hands[i].cards;

                // A hand split from aces is dealt its single card already
                if (this.hands[i].splitAces) {
                    return this.finishHand();
                }

                return this;
            }
        }

        this.state = DEALER;
        this.turn = this.dealer;

        return this;
    };

    /**
     * True when at least one hand can still beat the dealer, which is
     * the only reason for the dealer to draw.
     */
    Game.prototype.hasLiveHand = function() {
        for (var i = 0; i < this.hands.length; i+=1) {
            var hand = this.hands[i];

            if (!hand.surrendered && !hand.isBust() && !hand.isBlackjack()) {
                return true;
            }
        }

        return false;
    };

    /**
     * Play the dealer's hand out. Returns the cards that were drawn so
     * the interface can deal them one at a time.
     *
     * @return {Array} cards drawn, hole card first
     */
    Game.prototype.playDealer = function() {
        if (this.state !== DEALER) {
            return [];
        }

        var drawn = [];

        if (this.dealer.holeCard) {
            drawn.push(this.dealer.holeCard);
            this.revealHole();
        }

        var drawing = this.hasLiveHand();

        while (drawing) {
            var hand = Blackjack.Utils.hand(this.dealer.cards);

            drawing = hand.total < 17 ||
                (hand.total === 17 && hand.soft && this.options.dealerHitSoft17);

            if (drawing) {
                var card = this.draw();
                this.dealer.cards.push(card);
                drawn.push(card);
            }
        }

        this.settle();

        return drawn;
    };

    /**
     * Work out what every hand won or lost and pay it out.
     *
     * @return {Array} results
     */
    Game.prototype.settle = function() {
        var dealerScore = Blackjack.Utils.score(this.dealer.cards);
        var dealerBlackjack = this.dealer.cards.length === 2 && dealerScore === 21;
        var results = [];

        if (this.insuranceBet) {
            if (dealerBlackjack) {
                // Insurance pays two to one
                this.bankroll += this.insuranceBet * 3;
            }
        }

        for (var i = 0; i < this.hands.length; i+=1) {
            var hand = this.hands[i];
            var score = hand.score();
            var result, net;

            if (hand.surrendered) {
                result = 'surrender';
                net = -hand.bet / 2;
                this.bankroll += hand.bet / 2;
            } else if (hand.isBlackjack() && !dealerBlackjack) {
                result = 'blackjack';
                net = hand.bet * this.options.blackjackPayout;
                this.bankroll += hand.bet + net;
            } else if (score > 21) {
                result = 'bust';
                net = -hand.bet;
            } else if (dealerBlackjack) {
                result = hand.isBlackjack() ? 'push' : 'lose';
                net = hand.isBlackjack() ? 0 : -hand.bet;
                this.bankroll += hand.isBlackjack() ? hand.bet : 0;
            } else if (dealerScore > 21 || score > dealerScore) {
                result = 'win';
                net = hand.bet;
                this.bankroll += hand.bet * 2;
            } else if (score < dealerScore) {
                result = 'lose';
                net = -hand.bet;
            } else {
                result = 'push';
                net = 0;
                this.bankroll += hand.bet;
            }

            hand.result = result;
            hand.net = net;
            hand.done = true;

            results.push({
                hand: hand,
                result: result,
                net: net
            });
        }

        if (this.insuranceBet) {
            results.insurance = {
                bet: this.insuranceBet,
                net: dealerBlackjack ? this.insuranceBet * 2 : -this.insuranceBet
            };
        }

        this.state = SETTLED;
        this.turn = null;
        this.results = results;

        return results;
    };

    Game.prototype.getResults = function() {
        return this.results || [];
    };

    /**
     * The total won or lost over the round.
     */
    Game.prototype.getNet = function() {
        var net = 0;
        var results = this.getResults();

        for (var i = 0; i < results.length; i+=1) {
            net += results[i].net;
        }

        if (results.insurance) {
            net += results.insurance.net;
        }

        return net;
    };

    Game.Hand = Hand;
    Game.Card = Card;

    return Game;
}());

if (typeof module !== 'undefined' && module.exports) {
    module.exports = Blackjack.Game;
}
