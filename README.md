# Blackjack Coach

Play blackjack on your phone and find out after every move whether it was the mathematically best one.

### ▶︎ [arnauddc807.github.io/blackjack](https://arnauddc807.github.io/blackjack/)

On iOS, tap Share → *Add to Home Screen* and it opens full screen and plays without a signal.

<p>
  <img src="app/screens/table.png" alt="A hand of sixteen against a six" width="30%">
  <img src="app/screens/coach.png" alt="The verdict, with the expected value of every option" width="30%">
  <img src="app/screens/chart.png" alt="The basic strategy chart" width="30%">
</p>

## The idea

Sixteen against a six is the hand everyone gets wrong, and winning it teaches you nothing. In the screenshot above the player stood, the dealer busted, the player made $25 — and the coach still reports that the best play on the table was worth **minus thirteen cents on the dollar**. Standing was right. The hand was a loser anyway.

So the app grades decisions, never outcomes: ✓ you picked the best action, ≈ another was better by less than half a cent on the dollar, ✕ you gave something up, and here is how much. Expand a verdict for the expected value of every option side by side, the dealer's bust chance, and a note when the shoe disagrees with the printed chart.

## What "best" means here

Most trainers check your move against a basic strategy chart. A chart is an average: computed once, for a full shoe, blind to the four aces and eleven tens that have already gone by.

This one solves the hand you are holding against the cards actually left in the shoe. It walks the dealer's every possible draw, taking each card with the probability it really has, and does the same for every way you might play the hand out. The answer is exact — no simulation, no lookup, no infinite-deck approximation — so as a shoe drains the advice moves with it, and the app says so when it moves off the book. Two standard simplifications: the halves of a split are valued independently, and the dealer's peek is applied when the hole card is drawn rather than folded back into your own draw probabilities. Neither changes which action wins.

## At the table

- **Chips and a bankroll**, blackjack at 3:2, and everything a real table offers: splits to four hands, doubles, double after split, late surrender, insurance, and a dealer who peeks for a natural.
- **A shoe with a cut card** that runs down and gets reshuffled, with an optional Hi-Lo running and true count on screen.
- **Your own rules.** One to eight decks, dealer hits or stands on soft 17, double after split, surrender. The coach, the chart and the odds all follow.
- **Coaching after your move, before it, or not at all.** Set to *Before* and the best action is ringed while you decide.
- **A session record**: accuracy, streaks, money, the expected value you have handed back, and your recent mistakes with the play that would have been better.
- **The chart**, drawn for your table's rules by the same solver that grades you, with your current hand outlined in its cell.
- **Sound**, synthesised in the browser — cards on felt, chips, the riffle of a new shoe, a couple of notes for the verdict. Off with one tap.

## Under the hood

No framework, no build step, no dependencies — three libraries and an interface, served as files.

| File | |
| --- | --- |
| `src/Game.js` | The table: shoe, cut card, bets, splits, doubles, surrender, insurance, the peek, settlement. |
| `src/Strategy.js` | The solver, plus the basic strategy chart. |
| `src/Utils.js` | Hand scoring, soft totals, card counting helpers. |
| `src/Probability.js` | The original win/lose/push probability library, untouched. |
| `app/` | Interface, styles, sound, and the worker the solver runs in. |

```js
var game = new Blackjack.Game('player', 'house', { numberOfDecks: 6, dealerHitSoft17: true });

game.deal(25);

var analysis = Blackjack.Strategy.analyze({
	counts: game.getUnseenCounts(),                             // what you cannot see, hole card included
	playerCards: game.getHand().getCards(),
	up: Blackjack.Utils.value(game.getDealer().getUpCard()),
	rules: game.getRules()
});

analysis.best;        // "Double"
analysis.ev;          // { Stand: -0.1179, Hit: 0.3399, Double: 0.6799, Surrender: -0.5 }
analysis.basic;       // "Double" — what the chart says
analysis.dealer.bust; // 0.4393
```

Expected values are in units of the original bet: `+1` wins it outright, `-0.5` is the cost of a surrender. Solving a split against six decks takes a couple of hundred milliseconds cold and single digits once the memo tables are warm, so the app runs it in a web worker and asks the moment a decision opens — the verdict is waiting before you tap.

**Game** — `deal(bet)` `getActions()` `hit()` `stand()` `double()` `split()` `surrender()` `insure(take)` `playDealer()` `getHands()` `getHand()` `getState()` `getResults()` `getNet()` `getBankroll()` `getUnseenCounts()` `getCount()` `getShoe()` `getPlayer()` `getDealer()` `getRules()` `needsShuffle()`, with options for decks, soft 17, payout, penetration, surrender, double after split, split limits, insurance, bankroll and minimum bet.

**Strategy** — `analyze(options)` for every legal action's expected value, `dealer(up, counts, rules)` for the dealer's final totals, `basic(hand, up, rules, allowed)` for the textbook play, `reset()` to drop the memo tables.

**Utils** — `score(cards)` `hand(cards)` `value(card)` `isBlackjack(cards)` `counts(cards)` `total(counts)` `runningCount(cards)`

## Development

```
npm test      # 21 tests: the engine's rules and payouts, and a sweep of every hard
              # total, soft total and pair against all ten upcards, checking that
              # the exact solver and the printed chart agree
npm start     # serve at http://localhost:8080
npm run icons # redraw the app icons
```

The site is the repository: `index.html` at the root, everything beside it, all paths relative. Whatever is on the default branch is what is live.

## Credit

The game engine and probability library began as [Chris Zieba's blackjack](https://github.com/ChrisZieba/blackjack); the write-up behind it is [here](http://chriszieba.com/2015/03/30/blackjack-probabilities). [MIT](LICENSE) licensed.
