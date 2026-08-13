/**
 * Blackjack Coach — the table, the chips and the post mortem.
 *
 * Every decision is scored against Blackjack.Strategy, which solves the
 * hand exactly against the cards actually left in the shoe.
 */

/* global Blackjack */

(function() {
    'use strict';

    var HIT = 'Hit';
    var STAND = 'Stand';
    var DOUBLE = 'Double';
    var SPLIT = 'Split';
    var SURRENDER = 'Surrender';

    var STORE = 'blackjack-coach.v1';

    // A decision costing less than this in expected value is not worth
    // calling a mistake, it is a coin flip either way.
    var MARGIN = 0.005;

    var settings = {
        decks: 6,
        dealerHitSoft17: true,
        doubleAfterSplit: true,
        surrender: true,
        coach: 'feedback',
        showCount: false,
        sound: true
    };

    var stats = blankStats();
    var bankroll = 500;
    var bet = 25;
    var lastBet = 25;

    var game = null;
    var pending = null;
    var pendingState = null;
    var lastAnalysis = null;
    var busy = false;
    var chartTab = 'hard';
    var openSheet = null;

    function blankStats() {
        return {
            decisions: 0,
            correct: 0,
            evLost: 0,
            streak: 0,
            bestStreak: 0,
            hands: 0,
            net: 0,
            mistakes: []
        };
    }

    /* ------------------------------------------------------------ storage */

    function save() {
        try {
            localStorage.setItem(STORE, JSON.stringify({
                settings: settings,
                stats: stats,
                bankroll: bankroll,
                bet: lastBet
            }));
        } catch (error) {
            // A full or blocked storage is not worth interrupting play for
        }
    }

    function restore() {
        var raw;

        try {
            raw = localStorage.getItem(STORE);
        } catch (error) {
            return;
        }

        if (!raw) {
            return;
        }

        try {
            var data = JSON.parse(raw);
            var key;

            for (key in (data.settings || {})) {
                if (settings.hasOwnProperty(key)) {
                    settings[key] = data.settings[key];
                }
            }

            for (key in (data.stats || {})) {
                if (stats.hasOwnProperty(key)) {
                    stats[key] = data.stats[key];
                }
            }

            if (typeof data.bankroll === 'number' && data.bankroll > 0) {
                bankroll = data.bankroll;
            }

            if (typeof data.bet === 'number') {
                lastBet = bet = data.bet;
            }
        } catch (error) {
            // Corrupt state, start fresh
        }
    }

    /* ------------------------------------------------------------ helpers */

    function el(id) {
        return document.getElementById(id);
    }

    function wait(ms) {
        return new Promise(function(resolve) {
            setTimeout(resolve, ms);
        });
    }

    function money(amount) {
        var rounded = Math.round(amount * 100) / 100;
        var sign = rounded < 0 ? '-' : '';
        var whole = rounded % 1 === 0;

        return sign + '$' + Math.abs(rounded).toLocaleString('en-US', {
            minimumFractionDigits: whole ? 0 : 2,
            maximumFractionDigits: 2
        });
    }

    function cents(value) {
        // Expected value is quoted per dollar of the original bet
        return (value >= 0 ? '+' : '−') + Math.abs(value * 100).toFixed(1) + '¢';
    }

    function rules() {
        return {
            dealerHitSoft17: settings.dealerHitSoft17,
            doubleAfterSplit: settings.doubleAfterSplit,
            surrender: settings.surrender,
            maxSplitHands: 4,
            resplitAces: false,
            peek: true
        };
    }

    function handShape(cards) {
        var shape = Blackjack.Utils.hand(cards);
        var pair = 0;

        if (cards.length === 2 && Blackjack.Utils.value(cards[0]) === Blackjack.Utils.value(cards[1])) {
            pair = Blackjack.Utils.value(cards[0]);
        }

        return {
            total: shape.total,
            soft: shape.soft,
            pair: pair,
            cards: cards.length
        };
    }

    function handName(shape, up) {
        var name;

        if (shape.pair) {
            name = (shape.pair === 1 ? 'A' : shape.pair) + ',' + (shape.pair === 1 ? 'A' : shape.pair);
        } else if (shape.soft) {
            name = 'soft ' + shape.total;
        } else {
            name = String(shape.total);
        }

        return name + ' v ' + (up === 1 ? 'A' : up);
    }

    /* ------------------------------------------------------------- solver */

    var worker = null;
    var workerBroken = false;
    var requests = {};
    var nextId = 1;

    function startWorker() {
        if (workerBroken || typeof Worker === 'undefined') {
            return;
        }

        try {
            worker = new Worker('app/coach.worker.js');
        } catch (error) {
            workerBroken = true;
            return;
        }

        worker.onmessage = function(event) {
            var request = requests[event.data.id];

            if (!request) {
                return;
            }

            delete requests[event.data.id];

            if (event.data.error) {
                request.resolve(Blackjack.Strategy.analyze(request.payload));
            } else {
                request.resolve(event.data.result);
            }
        };

        worker.onerror = function() {
            workerBroken = true;
            worker = null;

            for (var id in requests) {
                if (requests.hasOwnProperty(id)) {
                    requests[id].resolve(Blackjack.Strategy.analyze(requests[id].payload));
                    delete requests[id];
                }
            }
        };
    }

    function solve(payload) {
        if (!worker && !workerBroken) {
            startWorker();
        }

        if (!worker) {
            return Promise.resolve(Blackjack.Strategy.analyze(payload));
        }

        var id = nextId += 1;

        return new Promise(function(resolve) {
            requests[id] = { resolve: resolve, payload: payload };
            worker.postMessage({ id: id, payload: payload });
        });
    }

    /**
     * Ask for the exact answer to the decision now on the table, so it
     * is ready by the time a button is tapped.
     */
    function requestAnalysis() {
        var hand = game.getHand();

        if (!hand || game.getState() !== 'player') {
            pending = null;
            pendingState = null;
            return;
        }

        var actions = game.getActions();
        var shape = handShape(hand.cards);
        var payload = {
            counts: game.getUnseenCounts(),
            player: shape,
            up: Blackjack.Utils.value(game.getDealer().getUpCard()),
            rules: rules(),
            allowed: {
                "double": actions.indexOf(DOUBLE) !== -1,
                split: actions.indexOf(SPLIT) !== -1,
                surrender: actions.indexOf(SURRENDER) !== -1
            }
        };

        pendingState = { shape: shape, up: payload.up, actions: actions };
        pending = solve(payload);

        var request = pending;

        pending.then(function(analysis) {
            if (request !== pending || game.getState() !== 'player') {
                return;
            }

            lastAnalysis = analysis;
            renderCoachIdle(analysis);
            applyHint(analysis);
        });
    }

    /* ------------------------------------------------------------ scoring */

    function scoreDecision(action, analysis, shape, up) {
        var chosen = analysis.ev[action];
        var best = analysis.bestEv;

        if (chosen === undefined) {
            return null;
        }

        var cost = best - chosen;
        var verdict = (cost <= 1e-9) ? 'correct' : (cost < MARGIN ? 'close' : 'wrong');

        stats.decisions += 1;

        if (verdict === 'wrong') {
            stats.evLost += cost;
            stats.streak = 0;
            stats.mistakes.unshift({
                hand: handName(shape, up),
                played: action,
                best: analysis.best,
                cost: cost
            });
            stats.mistakes = stats.mistakes.slice(0, 20);
        } else {
            stats.correct += 1;
            stats.streak += 1;
            stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
        }

        save();

        return {
            verdict: verdict,
            action: action,
            cost: cost,
            analysis: analysis
        };
    }

    /* ---------------------------------------------------------- rendering */

    var seen = {};

    function cardElement(key, card, faceDown, flip, delay) {
        var node = document.createElement('div');
        var fresh = !seen[key];

        seen[key] = true;

        // Cards make their noise as they land, not as they are drawn
        if (fresh) {
            Blackjack.Sound.play(flip ? 'flip' : 'deal', (delay || 0) / 1000);
        }
        node.className = 'card';
        node.dataset.key = key;

        if (faceDown) {
            node.classList.add('back');
        } else {
            var red = card.suit === '♥' || card.suit === '♦';

            if (red) {
                node.classList.add('red');
            }

            node.innerHTML = '<span class="rank">' + card.rank + '</span><span class="pip">' + card.suit + '</span>';
        }

        if (!fresh) {
            node.style.animation = 'none';
        } else if (flip) {
            node.classList.add('flip');
        }

        return node;
    }

    function renderCards(container, entries) {
        container.innerHTML = '';

        // The more cards in the hand, the more they have to overlap
        var fan = entries.length <= 2 ? 0.12 : (entries.length === 3 ? 0.24 : (entries.length === 4 ? 0.34 : 0.46));
        container.style.setProperty('--fan', fan);

        entries.forEach(function(entry, index) {
            var node = cardElement(entry.key, entry.card, entry.faceDown, entry.flip, entry.delay);
            node.style.animationDelay = (entry.delay || 0) + 'ms';
            node.style.zIndex = String(index);
            container.appendChild(node);
        });
    }

    function totalPill(cards, options) {
        options = options || {};

        if (!cards.length) {
            return '';
        }

        var shape = Blackjack.Utils.hand(cards);
        var classes = ['total'];
        var text = String(shape.total);

        if (options.hidden) {
            text = String(shape.total);
        }

        if (shape.bust) {
            classes.push('bust');
            text = shape.total + ' bust';
        } else if (shape.blackjack && !options.hidden) {
            classes.push('natural');
            text = 'Blackjack';
        }

        return '<span class="' + classes.join(' ') + '">' + text +
            (shape.soft && !shape.blackjack ? '<span class="soft">soft</span>' : '') + '</span>';
    }

    /**
     * @param {Integer} visible how many of the dealer's cards to show,
     *                  used to deal the dealer's draws out one by one
     * @param {Boolean} back   whether to sit a face down card at the end
     */
    function renderDealer(visible, back) {
        var dealer = game.getDealer();
        var cards = dealer.getCards();

        if (visible === undefined) {
            visible = cards.length;
        }

        if (back === undefined) {
            back = !!dealer.holeCard;
        }

        var shown = cards.slice(0, visible);
        var entries = shown.map(function(card, index) {
            return {
                key: 'd' + index + '-' + game.round,
                card: card,
                delay: index * 90,
                flip: index === 1
            };
        });

        if (back) {
            entries.push({ key: 'dhole-' + game.round, faceDown: true, delay: 140 });
        }

        renderCards(el('dealerHand'), entries);

        el('dealerTotal').innerHTML = shown.length ? totalPill(shown, { hidden: back }) : '';
    }

    function renderPlayer() {
        var container = el('playerHands');
        var hands = game.getHands();
        var state = game.getState();

        container.innerHTML = '';
        container.classList.toggle('multi', hands.length > 1);

        hands.forEach(function(hand, index) {
            var box = document.createElement('div');
            box.className = 'player-hand';

            if (hands.length > 1 && index === game.active && state === 'player') {
                box.classList.add('active');
            }

            if (hand.result && hands.length > 1) {
                box.classList.add('settled');
            }

            var cards = document.createElement('div');
            cards.className = 'hand';
            box.appendChild(cards);

            var meta = document.createElement('div');
            meta.innerHTML = totalPill(hand.cards);
            box.appendChild(meta);

            var footer = document.createElement('div');

            if (hand.result) {
                footer.className = 'hand-result ' + hand.result;
                footer.textContent = hand.net === 0 ?
                    (hand.result === 'push' ? 'Push' : 'No bet') :
                    (hand.net > 0 ? '+' : '−') + money(Math.abs(hand.net));
            } else {
                footer.className = 'hand-bet';
                footer.textContent = money(hand.bet) + (hand.doubled ? ' ×2' : '');
            }

            box.appendChild(footer);
            container.appendChild(box);

            renderCards(cards, hand.cards.map(function(card, i) {
                return {
                    key: 'p' + game.round + '-' + index + '-' + i + '-' + card.rank + card.suit,
                    card: card,
                    delay: i * 90
                };
            }));
        });

        el('playerLabel').textContent = hands.length > 1 ?
            'Hand ' + (game.active + 1) + ' of ' + hands.length : 'You';
    }

    function renderHud() {
        el('hudBankroll').textContent = money(bankroll);

        var pill = el('statsButton');
        var accuracy = stats.decisions ? Math.round((stats.correct / stats.decisions) * 100) : null;

        el('hudAccuracy').textContent = accuracy === null ? '–' : accuracy + '%';
        pill.classList.remove('accuracy-good', 'accuracy-mid', 'accuracy-bad');

        if (accuracy !== null) {
            pill.classList.add(accuracy >= 90 ? 'accuracy-good' : (accuracy >= 75 ? 'accuracy-mid' : 'accuracy-bad'));
        }

        var line = el('countLine');

        if (settings.showCount && game) {
            var count = game.getCount();
            line.innerHTML = '<span>Shoe ' + count.cardsLeft + ' cards · ' + count.decks.toFixed(1) + ' decks</span>' +
                '<span>Running ' + (count.running > 0 ? '+' : '') + count.running +
                ' · True ' + (count["true"] > 0 ? '+' : '') + count["true"] + '</span>';
        } else {
            line.innerHTML = '';
        }
    }

    function banner(headline, sub) {
        var node = el('banner');

        node.innerHTML = headline ?
            '<div class="headline">' + headline + '</div>' + (sub ? '<div class="sub">' + sub + '</div>' : '') : '';

        node.classList.remove('pop');

        if (headline) {
            /* restart the animation */
            void node.offsetWidth;
            node.classList.add('pop');
        }
    }

    /* ------------------------------------------------------------ controls */

    function button(label, sub, options) {
        options = options || {};

        var node = document.createElement('button');
        node.className = 'btn' + (options.primary ? ' primary' : '') + (options.wide ? ' wide' : '');
        node.innerHTML = '<span>' + label + '</span>' + (sub ? '<span class="sub">' + sub + '</span>' : '');

        if (options.disabled) {
            node.disabled = true;
        }

        if (options.action) {
            node.addEventListener('click', options.action);
        }

        if (options.name) {
            node.dataset.name = options.name;
        }

        return node;
    }

    function renderControls() {
        var area = el('controlArea');
        var state = game ? game.getState() : 'idle';

        area.innerHTML = '';

        if (state === 'player') {
            var actions = game.getActions();
            var row = document.createElement('div');
            row.className = 'actions';

            var order = [HIT, STAND, DOUBLE, SPLIT, SURRENDER];
            var live = order.filter(function(action) {
                return actions.indexOf(action) !== -1;
            });

            live.forEach(function(action, index) {
                var last = index === live.length - 1;
                row.appendChild(button(action, subtitleFor(action), {
                    name: action,
                    wide: last && live.length % 2 === 1,
                    action: function() { play(action); }
                }));
            });

            area.appendChild(row);

            if (lastAnalysis && pending) {
                pending.then(applyHint);
            }

            return;
        }

        if (state === 'insurance') {
            var insurance = document.createElement('div');
            insurance.className = 'actions';
            insurance.appendChild(button('Insurance', money(game.getHand().bet / 2), {
                action: function() { takeInsurance(true); }
            }));
            insurance.appendChild(button('No thanks', 'play on', {
                primary: true,
                action: function() { takeInsurance(false); }
            }));
            area.appendChild(insurance);
            return;
        }

        if (state === 'dealer') {
            var waiting = document.createElement('div');
            waiting.className = 'actions';
            waiting.appendChild(button('Dealing…', '', { wide: true, disabled: true }));
            area.appendChild(waiting);
            return;
        }

        renderBetting(area);
    }

    function subtitleFor(action) {
        var hand = game.getHand();

        if (action === DOUBLE) {
            return money(hand.bet) + ' more';
        }

        if (action === SPLIT) {
            return 'two hands';
        }

        if (action === SURRENDER) {
            return 'keep ' + money(hand.bet / 2);
        }

        return '';
    }

    function renderBetting(area) {
        var bar = document.createElement('div');
        bar.className = 'bet-bar';

        var chips = document.createElement('div');
        chips.className = 'chips';

        [5, 25, 100].forEach(function(amount) {
            var chip = document.createElement('button');
            chip.className = 'chip c' + amount;
            chip.textContent = amount;
            chip.disabled = bet + amount > bankroll;
            chip.addEventListener('click', function() {
                bet = Math.min(bankroll, bet + amount);
                Blackjack.Sound.play('chip');
                renderControls();
            });
            chips.appendChild(chip);
        });

        bar.appendChild(chips);

        var display = document.createElement('button');
        display.className = 'bet-display';
        display.innerHTML = '<span class="label">Bet</span><span class="value">' + money(bet) + '</span>';
        display.addEventListener('click', function() {
            bet = 0;
            Blackjack.Sound.play('chip');
            renderControls();
        });
        bar.appendChild(display);

        area.appendChild(bar);

        var deal = document.createElement('div');
        deal.className = 'actions';
        deal.style.marginTop = '9px';
        deal.appendChild(button(bankroll <= 0 ? 'Top up' : 'Deal', bankroll <= 0 ? 'back to $500' : null, {
            primary: true,
            wide: true,
            disabled: bankroll > 0 && bet <= 0,
            action: function() {
                if (bankroll <= 0) {
                    bankroll = 500;
                    bet = 25;
                    save();
                    renderHud();
                    renderControls();
                    return;
                }

                startRound();
            }
        }));
        area.appendChild(deal);
    }

    /**
     * In hint mode the best button gets a ring around it before the
     * player commits to anything.
     */
    function applyHint(analysis) {
        if (settings.coach !== 'hints' || !game || game.getState() !== 'player') {
            return;
        }

        Array.prototype.forEach.call(document.querySelectorAll('.btn.suggest'), function(node) {
            node.classList.remove('suggest');
        });

        var target = document.querySelector('.btn[data-name="' + analysis.best + '"]');

        if (target) {
            target.classList.add('suggest');
        }
    }

    /* --------------------------------------------------------------- coach */

    function hideCoach() {
        var coach = el('coach');
        coach.hidden = true;
        coach.classList.remove('open');
    }

    function evRows(analysis, chosen) {
        var actions = [STAND, HIT, DOUBLE, SPLIT, SURRENDER].filter(function(action) {
            return analysis.ev[action] !== undefined;
        });

        var scale = 0.5;

        actions.forEach(function(action) {
            scale = Math.max(scale, Math.abs(analysis.ev[action]));
        });

        return actions.map(function(action) {
            var value = analysis.ev[action];
            var width = (Math.abs(value) / scale) * 50;
            var left = value >= 0 ? 50 : 50 - width;
            var classes = ['ev-row'];

            if (action === analysis.best) {
                classes.push('best');
            }

            if (action === chosen) {
                classes.push('chosen');
            }

            return '<div class="' + classes.join(' ') + '">' +
                '<span class="ev-name">' + action + '</span>' +
                '<span class="ev-track"><span class="zero" style="left:50%"></span>' +
                '<span class="ev-fill' + (value >= 0 ? ' positive' : '') + '" style="left:' + left + '%;width:' + width + '%"></span></span>' +
                '<span class="ev-value">' + cents(value) + '</span>' +
                '</div>';
        }).join('');
    }

    function coachNote(analysis, chosen) {
        var parts = [];
        var dealerBust = Math.round(analysis.dealer.bust * 100);

        if (analysis.best !== analysis.basic) {
            parts.push('The chart says <b>' + analysis.basic + '</b>, but with the cards left in this shoe <b>' +
                analysis.best + '</b> is worth more. Close calls like this flip with the count.');
        } else if (chosen && chosen !== analysis.best) {
            parts.push('The book play here is <b>' + analysis.basic + '</b>.');
        }

        parts.push('The dealer busts <b>' + dealerBust + '%</b> of the time showing ' +
            (analysis.up === 1 ? 'an ace' : 'a ' + analysis.up) + '.');

        if (analysis.ev[SURRENDER] !== undefined && analysis.best === SURRENDER) {
            parts.push('Every way of playing this hand loses more than half a bet, so handing back half is the cheapest way out.');
        }

        return '<div class="coach-note">' + parts.join(' ') + '</div>';
    }

    /**
     * Before a move: a quiet line with the dealer's bust chance, and in
     * hint mode the play to make.
     */
    function renderCoachIdle(analysis) {
        if (settings.coach === 'off') {
            hideCoach();
            return;
        }

        if (settings.coach !== 'hints') {
            return;
        }

        var coach = el('coach');
        coach.hidden = false;
        coach.className = 'coach hint' + (coach.classList.contains('open') ? ' open' : '');
        el('coachMark').textContent = '?';
        el('coachTitle').textContent = analysis.best;
        el('coachDetail').textContent = 'worth ' + cents(analysis.bestEv) + ' per $1 — dealer busts ' +
            Math.round(analysis.dealer.bust * 100) + '%';
        el('coachBody').innerHTML = evRows(analysis, null) + coachNote(analysis, null);
    }

    /**
     * After a move: what it was worth against the best available.
     */
    function renderVerdict(score) {
        if (settings.coach === 'off' || !score) {
            return;
        }

        var analysis = score.analysis;
        var coach = el('coach');

        coach.hidden = false;
        coach.className = 'coach ' + score.verdict + (coach.classList.contains('open') ? ' open' : '');

        var mark = score.verdict === 'correct' ? '✓' : (score.verdict === 'close' ? '≈' : '✕');
        var title;
        var detail;

        if (score.verdict === 'correct') {
            title = score.action + ' was the best play';
            detail = 'worth ' + cents(analysis.bestEv) + ' per $1 staked';
        } else if (score.verdict === 'close') {
            title = score.action + ' is fine — ' + analysis.best + ' is a hair better';
            detail = 'costs ' + Math.abs(score.cost * 100).toFixed(1) + '¢ per $1, close enough to call it even';
        } else {
            title = analysis.best + ' beats ' + score.action;
            detail = score.action + ' costs ' + Math.abs(score.cost * 100).toFixed(1) + '¢ per $1 staked';
        }

        el('coachMark').textContent = mark;
        el('coachTitle').textContent = title;
        el('coachDetail').textContent = detail;
        el('coachBody').innerHTML = evRows(analysis, score.action) + coachNote(analysis, score.action);

        Blackjack.Sound.play(score.verdict);
    }

    /* ---------------------------------------------------------------- flow */

    function startRound() {
        if (busy) {
            return;
        }

        bet = Math.min(bet || 25, bankroll);
        lastBet = bet;
        seen = {};
        hideCoach();
        game.bankroll = bankroll;
        game.deal(bet);

        stats.hands += 1;
        bankroll = game.getBankroll();

        renderDealer();
        renderPlayer();
        renderHud();
        renderControls();

        if (game.shuffled) {
            Blackjack.Sound.play('shuffle');
            banner('Fresh shoe', settings.decks + (settings.decks === 1 ? ' deck' : ' decks') + ' shuffled');
        } else {
            banner('', '');
        }

        if (game.getState() === 'player') {
            requestAnalysis();
        } else if (game.getState() === 'dealer') {
            dealerTurn();
        } else if (game.getState() === 'settled') {
            finishRound();
        }

        save();
    }

    function takeInsurance(take) {
        var counts = game.getUnseenCounts();
        var left = counts.reduce(function(a, b) { return a + b; }, 0);
        var tens = counts[10] / left;
        var ev = tens * 3 - 1;
        var best = ev > 0 ? 'take insurance' : 'decline insurance';
        var chose = take ? 'take insurance' : 'decline insurance';
        var cost = Math.abs(ev) / 2;

        if (settings.coach !== 'off') {
            var coach = el('coach');
            var right = chose === best;

            stats.decisions += 1;

            if (right) {
                stats.correct += 1;
                stats.streak += 1;
                stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
            } else {
                stats.evLost += cost;
                stats.streak = 0;
                stats.mistakes.unshift({
                    hand: 'Insurance v A',
                    played: take ? 'Took it' : 'Declined',
                    best: ev > 0 ? 'Take' : 'Decline',
                    cost: cost
                });
                stats.mistakes = stats.mistakes.slice(0, 20);
            }

            coach.hidden = false;
            coach.className = 'coach ' + (right ? 'correct' : 'wrong');
            el('coachMark').textContent = right ? '✓' : '✕';
            el('coachTitle').textContent = right ? 'Right call' : 'The other way was better';
            el('coachDetail').textContent = 'Insurance pays 2:1 and needs a ten under ' +
                'more than a third of the time — this shoe is at ' + (tens * 100).toFixed(1) + '%';
            Blackjack.Sound.play(right ? 'correct' : 'wrong');
            el('coachBody').innerHTML = '<div class="coach-note">Insurance is a side bet on the hole card being ' +
                'a ten. Right now it returns <b>' + cents(ev) + '</b> per $1 staked. Unless you are counting and ' +
                'the shoe is rich in tens, it is the worst bet on the table.</div>';
        }

        game.insure(take);
        renderHud();
        renderControls();
        save();

        if (game.getState() === 'player') {
            requestAnalysis();
        } else if (game.getState() === 'settled') {
            finishRound();
        } else if (game.getState() === 'dealer') {
            dealerTurn();
        }
    }

    function play(action) {
        if (busy || game.getState() !== 'player') {
            return;
        }

        var request = pending;
        var context = pendingState;
        var before = game.active;

        busy = true;

        if (action === HIT) {
            game.hit();
        } else if (action === STAND) {
            game.stand();
        } else if (action === DOUBLE) {
            game.double();
        } else if (action === SPLIT) {
            game.split();
        } else if (action === SURRENDER) {
            game.surrender();
        }

        bankroll = game.getBankroll();

        var played = game.getHands()[before];

        if (played && played.isBust()) {
            Blackjack.Sound.play('bust', 0.12);
        }

        renderDealer();
        renderPlayer();
        renderHud();
        renderControls();

        if (request && context && settings.coach !== 'off') {
            request.then(function(analysis) {
                renderVerdict(scoreDecision(action, analysis, context.shape, context.up));
                renderHud();
            });
        }

        busy = false;

        if (game.getState() === 'player') {
            requestAnalysis();
        } else if (game.getState() === 'dealer') {
            dealerTurn();
        }
    }

    /**
     * The dealer's hand is already resolved by the engine, so this only
     * paces the reveal: hole card first, then a card at a time.
     */
    function dealerTurn() {
        busy = true;
        pending = null;
        hideCoachIfHint();
        renderControls();

        game.playDealer();

        var count = game.getDealer().getCards().length;
        var visible = 1;

        // Hold on the face down card for a beat
        renderDealer(1, true);

        function step() {
            visible += 1;
            renderDealer(visible, false);

            if (visible < count) {
                return wait(480).then(step);
            }

            return wait(450).then(finishRound);
        }

        wait(380).then(step);
    }

    function hideCoachIfHint() {
        if (settings.coach === 'hints') {
            hideCoach();
        }
    }

    function finishRound() {
        busy = false;
        bankroll = game.getBankroll();

        var results = game.getResults();
        var net = game.getNet();

        stats.net += net;
        renderDealer();
        renderPlayer();
        renderHud();
        renderControls();

        var headline;
        var sub;
        var dealerCards = game.getDealer().getCards();
        var dealerScore = Blackjack.Utils.score(dealerCards);
        var natural = false;

        for (var i = 0; i < results.length; i+=1) {
            natural = natural || results[i].result === 'blackjack';
        }

        Blackjack.Sound.play(natural ? 'blackjack' : (net > 0 ? 'win' : (net < 0 ? 'lose' : 'push')));

        if (results.length === 1) {
            var result = results[0].result;
            headline = {
                blackjack: 'Blackjack!',
                win: 'You win',
                lose: 'Dealer takes it',
                push: 'Push',
                bust: 'Bust',
                surrender: 'Surrendered'
            }[result] || '';
        } else {
            headline = net > 0 ? 'You win' : (net < 0 ? 'Dealer takes it' : 'Push');
        }

        if (dealerScore > 21) {
            sub = 'Dealer busts with ' + dealerScore;
        } else if (dealerCards.length) {
            sub = 'Dealer ' + (Blackjack.Utils.isBlackjack(dealerCards) ? 'blackjack' : dealerScore);
        }

        if (net !== 0) {
            sub = (net > 0 ? '+' : '−') + money(Math.abs(net)).replace('-', '') + ' · ' + sub;
        }

        banner(headline, sub);
        save();
    }

    /* -------------------------------------------------------------- sheets */

    function showSheet(id) {
        if (openSheet) {
            el(openSheet).classList.remove('show');
        }

        openSheet = id;
        el('scrim').classList.add('show');
        el(id).classList.add('show');
    }

    function closeSheet() {
        if (openSheet) {
            el(openSheet).classList.remove('show');
        }

        openSheet = null;
        el('scrim').classList.remove('show');
    }

    function renderStats() {
        var accuracy = stats.decisions ? Math.round((stats.correct / stats.decisions) * 100) : 0;
        var body = el('statsBody');
        var html = '<div class="stat-grid">' +
            '<div class="stat"><div class="value">' + (stats.decisions ? accuracy + '%' : '–') + '</div><div class="label">Accuracy</div></div>' +
            '<div class="stat"><div class="value">' + stats.decisions + '</div><div class="label">Decisions</div></div>' +
            '<div class="stat"><div class="value">' + stats.hands + '</div><div class="label">Hands</div></div>' +
            '<div class="stat"><div class="value">' + stats.bestStreak + '</div><div class="label">Best streak</div></div>' +
            '<div class="stat"><div class="value" style="color:' + (stats.net >= 0 ? 'var(--good)' : 'var(--bad)') + '">' +
                money(stats.net) + '</div><div class="label">Net</div></div>' +
            '<div class="stat"><div class="value" style="color:var(--bad)">' + (stats.evLost * 100).toFixed(0) + '¢</div>' +
                '<div class="label">Given away</div></div>' +
            '</div>';

        html += '<div class="row"><div><div class="name">Current streak</div>' +
            '<div class="hint">correct decisions in a row</div></div><div class="name">' + stats.streak + '</div></div>';

        html += '<h2 style="margin-top:18px">Recent mistakes</h2>';

        if (!stats.mistakes.length) {
            html += '<div class="empty">Nothing yet. Every decision so far has been the best one available.</div>';
        } else {
            stats.mistakes.forEach(function(mistake) {
                html += '<div class="mistake"><div><div class="what">' + mistake.hand + '</div>' +
                    '<div class="fix">played ' + mistake.played + ' — ' + mistake.best + ' was better</div></div>' +
                    '<div class="cost">−' + (mistake.cost * 100).toFixed(1) + '¢</div></div>';
            });
        }

        html += '<button class="danger" id="resetStats">Clear session</button>';
        body.innerHTML = html;

        el('resetStats').addEventListener('click', function() {
            stats = blankStats();
            save();
            renderStats();
            renderHud();
        });
    }

    /**
     * The chart is drawn by asking the strategy module for every cell,
     * so it can never drift from the advice the coach gives.
     */
    function renderChart() {
        var ups = [2, 3, 4, 5, 6, 7, 8, 9, 10, 1];
        var rows = [];
        var current = null;

        if (game && game.getState() === 'player' && game.getHand()) {
            current = {
                shape: handShape(game.getHand().cards),
                up: Blackjack.Utils.value(game.getDealer().getUpCard())
            };
        }

        if (chartTab === 'hard') {
            for (var t = 17; t >= 5; t-=1) {
                rows.push({ label: String(t), shape: { total: t, soft: false, pair: 0, cards: 2 } });
            }
        } else if (chartTab === 'soft') {
            for (var s = 20; s >= 13; s-=1) {
                rows.push({
                    label: 'A,' + (s - 11),
                    shape: { total: s, soft: true, pair: 0, cards: 2 }
                });
            }
        } else {
            [1, 10, 9, 8, 7, 6, 5, 4, 3, 2].forEach(function(value) {
                var name = value === 1 ? 'A' : value;
                rows.push({
                    label: name + ',' + name,
                    shape: {
                        total: value === 1 ? 12 : value * 2,
                        soft: value === 1,
                        pair: value,
                        cards: 2
                    }
                });
            });
        }

        var html = '<table class="chart"><thead><tr><th></th>';

        ups.forEach(function(up) {
            html += '<th>' + (up === 1 ? 'A' : up) + '</th>';
        });

        html += '</tr></thead><tbody>';

        rows.forEach(function(row) {
            html += '<tr><th class="rowhead">' + row.label + '</th>';

            ups.forEach(function(up) {
                var cell = chartCell(row.shape, up);
                var isNow = current &&
                    current.up === up &&
                    current.shape.total === row.shape.total &&
                    !!current.shape.soft === !!row.shape.soft &&
                    (chartTab === 'pairs' ? current.shape.pair === row.shape.pair : !current.shape.pair);

                html += '<td class="' + cell.className + (isNow ? ' now' : '') + '">' + cell.text + '</td>';
            });

            html += '</tr>';
        });

        html += '</tbody></table>';

        html += '<div class="legend">' +
            '<span><i style="background:#ff7a8a"></i>Hit</span>' +
            '<span><i style="background:#7fd7ff"></i>Stand</span>' +
            '<span><i style="background:#ffd166"></i>Double</span>' +
            '<span><i style="background:#9cf0c4"></i>Split</span>' +
            '<span><i style="background:#cbb2ff"></i>Surrender</span>' +
            '</div>' +
            '<div class="coach-note" style="border:0">Dealer ' +
            (settings.dealerHitSoft17 ? 'hits' : 'stands on') + ' soft 17, ' +
            (settings.doubleAfterSplit ? 'doubling after a split allowed' : 'no double after split') + ', ' +
            (settings.surrender ? 'late surrender allowed' : 'no surrender') + '. ' +
            'Lower case letters are the fallback when the first choice is not on offer: ' +
            '<b>Ds</b> means double, otherwise stand.</div>';

        el('chartBody').innerHTML = html;
    }

    function chartCell(shape, up) {
        var pick = Blackjack.Strategy.basic(shape, up, rules(), {
            "double": true,
            split: !!shape.pair,
            surrender: settings.surrender
        });

        if (pick === SPLIT) {
            return { text: 'P', className: 'p' };
        }

        if (pick === SURRENDER) {
            var without = Blackjack.Strategy.basic(shape, up, rules(), {
                "double": true,
                split: !!shape.pair,
                surrender: false
            });

            return { text: 'R' + (without === STAND ? 's' : 'h'), className: 'r' };
        }

        if (pick === DOUBLE) {
            var noDouble = Blackjack.Strategy.basic(shape, up, rules(), {
                "double": false,
                split: !!shape.pair,
                surrender: settings.surrender
            });

            return { text: 'D' + (noDouble === STAND ? 's' : ''), className: 'd' };
        }

        if (pick === STAND) {
            return { text: 'S', className: 's' };
        }

        return { text: 'H', className: 'h' };
    }

    function segmented(options, value, onPick) {
        var wrap = document.createElement('div');
        wrap.className = 'segmented';

        options.forEach(function(option) {
            var node = document.createElement('button');
            node.textContent = option.label;

            if (option.value === value) {
                node.classList.add('on');
            }

            node.addEventListener('click', function() {
                onPick(option.value);
            });

            wrap.appendChild(node);
        });

        return wrap;
    }

    function settingRow(name, hint, control) {
        var row = document.createElement('div');
        row.className = 'row';

        var text = document.createElement('div');
        text.innerHTML = '<div class="name">' + name + '</div>' + (hint ? '<div class="hint">' + hint + '</div>' : '');
        row.appendChild(text);
        row.appendChild(control);

        return row;
    }

    function renderSettings() {
        var body = el('settingsBody');
        body.innerHTML = '';

        body.appendChild(settingRow('Coach', 'when to be told about your play',
            segmented([
                { label: 'After', value: 'feedback' },
                { label: 'Before', value: 'hints' },
                { label: 'Off', value: 'off' }
            ], settings.coach, function(value) {
                settings.coach = value;
                hideCoach();
                save();
                renderSettings();
                renderControls();
            })));

        body.appendChild(settingRow('Decks', 'cards in the shoe',
            segmented([
                { label: '1', value: 1 },
                { label: '2', value: 2 },
                { label: '6', value: 6 },
                { label: '8', value: 8 }
            ], settings.decks, function(value) {
                settings.decks = value;
                applyRules();
            })));

        body.appendChild(settingRow('Soft 17', 'what the dealer does on soft 17',
            segmented([
                { label: 'Hits', value: true },
                { label: 'Stands', value: false }
            ], settings.dealerHitSoft17, function(value) {
                settings.dealerHitSoft17 = value;
                applyRules();
            })));

        body.appendChild(settingRow('Double after split', 'doubling a hand made by splitting',
            segmented([
                { label: 'Yes', value: true },
                { label: 'No', value: false }
            ], settings.doubleAfterSplit, function(value) {
                settings.doubleAfterSplit = value;
                applyRules();
            })));

        body.appendChild(settingRow('Late surrender', 'give up half the bet on the first two cards',
            segmented([
                { label: 'Yes', value: true },
                { label: 'No', value: false }
            ], settings.surrender, function(value) {
                settings.surrender = value;
                applyRules();
            })));

        body.appendChild(settingRow('Sound', 'cards, chips and the verdict',
            segmented([
                { label: 'On', value: true },
                { label: 'Off', value: false }
            ], settings.sound, function(value) {
                settings.sound = value;
                Blackjack.Sound.setEnabled(value);

                if (value) {
                    Blackjack.Sound.play('chip');
                }

                save();
                renderSettings();
            })));

        body.appendChild(settingRow('Card counting line', 'show the running and true count',
            segmented([
                { label: 'Show', value: true },
                { label: 'Hide', value: false }
            ], settings.showCount, function(value) {
                settings.showCount = value;
                save();
                renderSettings();
                renderHud();
            })));

        var reset = document.createElement('button');
        reset.className = 'danger';
        reset.textContent = 'Reset bankroll to $500';
        reset.addEventListener('click', function() {
            bankroll = 500;
            bet = 25;
            save();
            renderHud();
            renderControls();
        });
        body.appendChild(reset);
    }

    function applyRules() {
        save();
        renderSettings();

        var state = game ? game.getState() : 'idle';

        if (state === 'idle' || state === 'settled') {
            newGame();
            renderDealer();
            renderPlayer();
            renderControls();
            banner('Table changed', settings.decks + (settings.decks === 1 ? ' deck' : ' decks') + ', dealer ' +
                (settings.dealerHitSoft17 ? 'hits' : 'stands on') + ' soft 17');
        }
    }

    function newGame() {
        game = new Blackjack.Game('You', 'Dealer', {
            numberOfDecks: settings.decks,
            dealerHitSoft17: settings.dealerHitSoft17,
            doubleAfterSplit: settings.doubleAfterSplit,
            surrender: settings.surrender,
            blackjackPayout: 1.5,
            penetration: 0.75,
            bankroll: bankroll,
            minBet: 5
        });
    }

    /* ---------------------------------------------------------------- boot */

    function bind() {
        el('coachHead').addEventListener('click', function() {
            var open = el('coach').classList.toggle('open');
            el('app').classList.toggle('compact', open);
        });

        el('statsButton').addEventListener('click', function() {
            renderStats();
            showSheet('statsSheet');
        });

        el('chartButton').addEventListener('click', function() {
            renderChart();
            showSheet('chartSheet');
        });

        el('settingsButton').addEventListener('click', function() {
            renderSettings();
            showSheet('settingsSheet');
        });

        el('bankrollPill').addEventListener('click', function() {
            renderStats();
            showSheet('statsSheet');
        });

        el('scrim').addEventListener('click', closeSheet);

        Array.prototype.forEach.call(document.querySelectorAll('.sheet-grip'), function(grip) {
            grip.addEventListener('click', closeSheet);
        });

        el('chartTabs').addEventListener('click', function(event) {
            var target = event.target.closest('button[data-chart]');

            if (!target) {
                return;
            }

            chartTab = target.dataset.chart;
            Array.prototype.forEach.call(el('chartTabs').children, function(node) {
                node.classList.toggle('on', node === target);
            });
            renderChart();
        });

        // Keep a stray double tap from zooming the table on iOS
        document.addEventListener('gesturestart', function(event) {
            event.preventDefault();
        });

        // iOS only lets audio start from inside a gesture, so the first
        // touch anywhere opens the context
        function wake() {
            Blackjack.Sound.unlock();
            document.removeEventListener('touchend', wake);
            document.removeEventListener('mousedown', wake);
        }

        document.addEventListener('touchend', wake);
        document.addEventListener('mousedown', wake);
    }

    function boot() {
        if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
            navigator.serviceWorker.register('sw.js').catch(function() {
                // Offline play is a bonus, not a requirement
            });
        }

        restore();
        Blackjack.Sound.setEnabled(settings.sound);
        newGame();
        bind();
        startWorker();
        renderHud();
        renderControls();
        renderDealer();
        renderPlayer();
        banner('Blackjack Coach', 'Place a bet — every move gets graded');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }
}());
