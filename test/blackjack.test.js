/**
 * Tests for the blackjack engine, run with `npm test` (node --test).
 */

var test = require('node:test');
var assert = require('node:assert');

var Utils = require('../src/Utils.js');
var Strategy = require('../src/Strategy.js');
var Game = require('../src/Game.js');

var RULES = {
    dealerHitSoft17: true,
    doubleAfterSplit: true,
    surrender: true,
    maxSplitHands: 4,
    resplitAces: false,
    peek: true
};

function card(rank) {
    return { rank: rank, suit: '♠' };
}

function hand(ranks) {
    return ranks.map(card);
}

function shoeCounts(decks) {
    var counts = [0,0,0,0,0,0,0,0,0,0,0];

    for (var v = 1; v <= 9; v+=1) {
        counts[v] = 4 * decks;
    }

    counts[10] = 16 * decks;

    return counts;
}

function remove(counts, values) {
    var copy = counts.slice();

    values.forEach(function(v) {
        copy[v] -= 1;
    });

    return copy;
}

test('Utils.score treats aces as eleven until the hand would bust', function() {
    assert.strictEqual(Utils.score(hand(['A', 'K'])), 21);
    assert.strictEqual(Utils.score(hand(['A', 'A'])), 12);
    assert.strictEqual(Utils.score(hand(['A', '6'])), 17);
    assert.strictEqual(Utils.score(hand(['A', '6', '10'])), 17);
    assert.strictEqual(Utils.score(hand(['10', '9', '5'])), 24);
    assert.strictEqual(Utils.score(hand(['A', 'A', '9'])), 21);
});

test('Utils.hand reports soft, bust and natural hands', function() {
    var soft = Utils.hand(hand(['A', '7']));
    assert.strictEqual(soft.total, 18);
    assert.strictEqual(soft.soft, true);
    assert.strictEqual(soft.blackjack, false);

    var natural = Utils.hand(hand(['A', 'Q']));
    assert.strictEqual(natural.total, 21);
    assert.strictEqual(natural.blackjack, true);

    var busted = Utils.hand(hand(['K', 'Q', '5']));
    assert.strictEqual(busted.bust, true);
    assert.strictEqual(busted.soft, false);
});

test('Utils.counts buckets every ten valued card together', function() {
    var counts = Utils.counts(hand(['A', 'K', 'Q', 'J', '10', '2']));
    assert.strictEqual(counts[10], 4);
    assert.strictEqual(counts[1], 1);
    assert.strictEqual(counts[2], 1);
});

test('Utils.runningCount follows Hi-Lo', function() {
    assert.strictEqual(Utils.runningCount(hand(['2', '3', '4', '5', '6'])), 5);
    assert.strictEqual(Utils.runningCount(hand(['10', 'A'])), -2);
    assert.strictEqual(Utils.runningCount(hand(['7', '8', '9'])), 0);
});

test('the dealer distribution is a probability distribution', function() {
    [1, 2, 6, 7, 10].forEach(function(up) {
        var d = Strategy.dealer(up, remove(shoeCounts(6), [up]), RULES);
        var sum = d.seventeen + d.eighteen + d.nineteen + d.twenty + d.twentyone + d.bust + d.blackjack;

        assert.ok(Math.abs(sum - 1) < 1e-9, 'upcard ' + up + ' sums to ' + sum);
    });
});

test('a peeked ten or ace can no longer hold a natural', function() {
    var ten = Strategy.dealer(10, remove(shoeCounts(6), [10]), RULES);
    assert.strictEqual(ten.blackjack, 0);

    var noPeek = Strategy.dealer(10, remove(shoeCounts(6), [10]), Object.assign({}, RULES, { peek: false }));
    assert.ok(noPeek.blackjack > 0.07 && noPeek.blackjack < 0.08, 'natural chance was ' + noPeek.blackjack);
});

test('dealer bust chances land where the published tables put them', function() {
    var six = Strategy.dealer(6, remove(shoeCounts(6), [6]), RULES);
    assert.ok(six.bust > 0.42 && six.bust < 0.46, 'six busts ' + six.bust);

    var ace = Strategy.dealer(1, remove(shoeCounts(6), [1]), RULES);
    assert.ok(ace.bust > 0.16 && ace.bust < 0.21, 'ace busts ' + ace.bust);
});

test('expected values match the published composition dependent numbers', function() {
    var sixteen = Strategy.analyze({
        counts: remove(shoeCounts(6), [10, 6, 10]),
        playerCards: hand(['10', '6']),
        up: 10,
        rules: RULES
    });

    // Standing on sixteen against a ten is worth about minus fifty four cents
    assert.ok(Math.abs(sixteen.ev.Stand - -0.54) < 0.02, 'stand ' + sixteen.ev.Stand);
    assert.ok(Math.abs(sixteen.ev.Hit - -0.53) < 0.02, 'hit ' + sixteen.ev.Hit);
    assert.strictEqual(sixteen.best, 'Surrender');

    var eleven = Strategy.analyze({
        counts: remove(shoeCounts(6), [6, 5, 6]),
        playerCards: hand(['6', '5']),
        up: 6,
        rules: RULES
    });

    assert.strictEqual(eleven.best, 'Double');
    assert.ok(eleven.ev.Double > 0.6, 'double ' + eleven.ev.Double);

    // From eleven every card leaves a hand worth standing on against a
    // six, so doubling is worth exactly twice hitting once
    assert.ok(Math.abs(eleven.ev.Double - 2 * eleven.ev.Hit) < 1e-9);

    var eight = Strategy.analyze({
        counts: remove(shoeCounts(6), [3, 5, 10]),
        playerCards: hand(['3', '5']),
        up: 10,
        rules: RULES
    });

    // Hitting eight keeps the option of hitting again, doubling does not
    assert.ok(eight.ev.Hit > eight.ev.Double / 2 + 0.01, 'hit ' + eight.ev.Hit);
    assert.strictEqual(eight.best, 'Hit');
});

test('doubling is only offered on the first two cards', function() {
    var three = Strategy.analyze({
        counts: remove(shoeCounts(6), [2, 3, 4, 6]),
        playerCards: hand(['2', '3', '4']),
        up: 6,
        rules: RULES
    });

    assert.strictEqual(three.ev.Double, undefined);
    assert.strictEqual(three.ev.Surrender, undefined);
});

test('the exact engine agrees with the basic strategy chart', function() {
    var decks = 6;
    var disagreements = [];

    function check(cards, up) {
        var counts = remove(shoeCounts(decks), cards.map(Utils.value).concat([up]));
        var analysis = Strategy.analyze({
            counts: counts,
            playerCards: cards,
            up: up,
            rules: RULES
        });

        if (analysis.best !== analysis.basic) {
            var margin = analysis.bestEv - analysis.ev[analysis.basic];

            // Only close calls are allowed to differ: those are the
            // cells where the exact shoe composition tips the balance.
            if (margin > 0.02) {
                disagreements.push({
                    hand: cards.map(function(c) { return c.rank; }).join(''),
                    up: up,
                    best: analysis.best,
                    basic: analysis.basic,
                    margin: margin.toFixed(4)
                });
            }
        }
    }

    var hards = [['2','3'],['2','4'],['2','5'],['3','5'],['2','7'],['3','7'],['2','8'],['4','7'],
                 ['5','7'],['6','7'],['8','6'],['9','6'],['10','6'],['10','7'],['10','8'],['10','9']];
    var softs = [['A','2'],['A','3'],['A','4'],['A','5'],['A','6'],['A','7'],['A','8'],['A','9']];
    var pairs = [['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],['8','8'],['9','9'],['10','10'],['A','A']];

    [hards, softs, pairs].forEach(function(group) {
        group.forEach(function(ranks) {
            for (var up = 1; up <= 10; up+=1) {
                check(hand(ranks), up);
            }
        });
    });

    assert.deepStrictEqual(disagreements, [], 'chart and engine disagree: ' + JSON.stringify(disagreements, null, 2));
});

test('a deal puts two cards in front of the player and hides the hole card', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6 });
    game.deal(10);

    assert.strictEqual(game.getHand().cards.length, 2);
    assert.strictEqual(game.getDealer().getCards().length, 1);
    assert.ok(game.getDealer().holeCard);
    assert.strictEqual(game.getBankroll(), 490);

    var unseen = game.getUnseenCounts();
    var sum = unseen.reduce(function(a, b) { return a + b; }, 0);
    assert.strictEqual(sum, 6 * 52 - 3);
});

/**
 * Stack the shoe so a round plays out exactly as written. Cards are
 * drawn from the end, so the list is given in draw order.
 */
function stack(game, ranks) {
    // Padding sits at the bottom of the shoe so the engine never
    // decides it is time to bring in a fresh one mid test.
    var padding = [];

    while (padding.length < 40) {
        padding.push(card('4'));
    }

    game.shoe = padding.concat(ranks.slice().reverse().map(card));
    game.dealt = [];
}

test('a natural pays three to two', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['A', '9', 'K', '7']);
    game.deal(10);

    assert.strictEqual(game.getState(), 'dealer');
    game.playDealer();

    assert.strictEqual(game.getHands()[0].result, 'blackjack');
    assert.strictEqual(game.getNet(), 15);
    assert.strictEqual(game.getBankroll(), 515);
});

test('a dealer natural takes the bet and pays insurance', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['10', 'A', '8', 'K']);
    game.deal(10);

    assert.strictEqual(game.getState(), 'insurance');
    game.insure(true);

    assert.strictEqual(game.getState(), 'settled');
    assert.strictEqual(game.getHands()[0].result, 'lose');
    // Ten lost on the hand, fifteen back on the five of insurance
    assert.strictEqual(game.getNet(), 0);
    assert.strictEqual(game.getBankroll(), 500);
});

test('doubling takes one card and twice the money', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['6', '9', '5', '7', '9', '5']);
    game.deal(10);

    assert.ok(game.can('Double'));
    game.double();

    assert.strictEqual(game.getHand().cards.length, 3);
    assert.strictEqual(game.getState(), 'dealer');
    game.playDealer();

    // Player 6+5+9 = 20, dealer 9+7+5 = 21
    assert.strictEqual(game.getHands()[0].result, 'lose');
    assert.strictEqual(game.getNet(), -20);
    assert.strictEqual(game.getBankroll(), 480);
});

test('splitting eights makes two hands with their own bets', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['8', '6', '8', '9', '3', '2', '10', '5']);
    game.deal(10);

    assert.ok(game.can('Split'));
    game.split();

    assert.strictEqual(game.getHands().length, 2);
    assert.strictEqual(game.getBankroll(), 480);
    assert.strictEqual(game.getHands()[0].cards.length, 2);
    assert.strictEqual(game.getHands()[1].cards.length, 2);

    game.stand();
    assert.strictEqual(game.active, 1);
    game.stand();

    assert.strictEqual(game.getState(), 'dealer');
    game.playDealer();
    assert.strictEqual(game.getResults().length, 2);
});

test('split aces take a single card each', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['A', '7', 'A', '9', 'K', '2', '10']);
    game.deal(10);

    game.split();

    assert.strictEqual(game.getState(), 'dealer');
    assert.strictEqual(game.getHands()[0].cards.length, 2);
    assert.strictEqual(game.getHands()[1].cards.length, 2);
    assert.deepStrictEqual(game.getActions(), []);
});

test('surrender gives back half the bet', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1, surrender: true });
    stack(game, ['10', '9', '6', '8']);
    game.deal(10);

    assert.ok(game.can('Surrender'));
    game.surrender();
    game.playDealer();

    assert.strictEqual(game.getHands()[0].result, 'surrender');
    assert.strictEqual(game.getNet(), -5);
    assert.strictEqual(game.getBankroll(), 495);
});

test('busting loses the bet without the dealer drawing', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['10', '7', '6', '5', '9']);
    game.deal(10);

    game.hit();

    assert.strictEqual(game.getHand().score(), 25);
    assert.strictEqual(game.getState(), 'dealer');

    var drawn = game.playDealer();

    // Only the hole card is turned over, there is nothing left to beat
    assert.strictEqual(drawn.length, 1);
    assert.strictEqual(game.getNet(), -10);
});

test('the dealer hits or stands on soft seventeen as the rules say', function() {
    var hits = new Game('p', 'd', { numberOfDecks: 6, penetration: 1, dealerHitSoft17: true });
    stack(hits, ['10', '6', '9', 'A', '4']);
    hits.deal(10);
    hits.stand();
    hits.playDealer();
    assert.strictEqual(Utils.score(hits.getDealer().getCards()), 21);

    var stands = new Game('p', 'd', { numberOfDecks: 6, penetration: 1, dealerHitSoft17: false });
    stack(stands, ['10', '6', '9', 'A', '4']);
    stands.deal(10);
    stands.stand();
    stands.playDealer();
    assert.strictEqual(Utils.score(stands.getDealer().getCards()), 17);
});

test('a push returns the bet', function() {
    var game = new Game('p', 'd', { numberOfDecks: 6, penetration: 1 });
    stack(game, ['10', '9', '9', '10']);
    game.deal(10);
    game.stand();
    game.playDealer();

    assert.strictEqual(game.getHands()[0].result, 'push');
    assert.strictEqual(game.getBankroll(), 500);
});

test('the shoe is replaced once the cut card is out', function() {
    var game = new Game('p', 'd', { numberOfDecks: 1, penetration: 0.5 });
    var rounds = 0;

    while (rounds < 20) {
        game.deal(5);

        if (game.getState() === 'player') {
            game.stand();
        }

        if (game.getState() === 'dealer') {
            game.playDealer();
        }

        assert.ok(game.getShoe().length > 0);
        rounds += 1;
    }

    assert.ok(game.round === 20);
});
