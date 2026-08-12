# blackjack

> A blackjack game engine, an exact expected value solver, and a touch first web app that tells you after every move whether it was the best one available.

**Play it: [arnauddc807.github.io/blackjack](https://arnauddc807.github.io/blackjack/)** — add it to your home screen on iOS and it runs full screen, offline included.

The engine deals, splits, doubles, surrenders, peeks for a natural and settles the money. The strategy library solves the hand you are actually holding against the cards actually left in the shoe, so the advice is composition dependent rather than a lookup in a printed chart. The app is the two of them wired together with a coach that grades every decision in cents.

## The app

`index.html` at the root of the repository is the whole thing: no build step, no dependencies, no framework. Open it over any static host.

- **Play** with chips, splits up to four hands, doubles, late surrender and insurance.
- **Get graded.** Tap Hit and the coach tells you what hitting was worth, what the best action was worth, and the difference in cents per dollar of your bet. Expand the card for a bar chart of every option, the dealer's bust chance, and whether the exact shoe disagrees with the printed chart.
- **Or get told first.** Set the coach to *Before* and the best action is ringed before you commit.
- **Track it.** Accuracy, streaks, the expected value you have given away, and a list of your recent mistakes with the play that would have been better.
- **Look it up.** The basic strategy chart is generated from the same library that grades you, so it can never drift out of sync with the advice.
- **Change the table.** One to eight decks, dealer hits or stands on soft 17, double after split, late surrender, and an optional Hi-Lo count line.

## Usage

The three libraries can be used separately or together.

```js
var game = new Blackjack.Game('player1', 'house', {
	numberOfDecks: 6,
	dealerHitSoft17: true
});

game.deal(25);

var analysis = Blackjack.Strategy.analyze({
	counts: game.getUnseenCounts(),
	playerCards: game.getHand().getCards(),
	up: Blackjack.Utils.value(game.getDealer().getUpCard()),
	rules: game.getRules()
});

analysis.best;      // "Double"
analysis.ev.Double; // 0.6799…  in units of the original bet
analysis.basic;     // "Double" — what the printed chart says
analysis.dealer.bust; // 0.4393…
```

## Options

- `numberOfDecks` {Integer} — cards in the shoe. Casinos use between one and eight.
- `dealerHitSoft17` {Boolean} — `true` and the dealer draws to a soft 17.
- `blackjackPayout` {Number} — `1.5` for the usual three to two.
- `penetration` {Number} — how much of the shoe is dealt before the cut card comes out.
- `surrender` {Boolean} — offer late surrender.
- `doubleAfterSplit` {Boolean} — allow doubling a hand made by a split.
- `maxSplitHands` {Integer} — how many hands a split may end up as.
- `resplitAces` {Boolean} — split aces again, and draw more than one card to them.
- `insurance` {Boolean} — offer insurance when an ace shows.
- `bankroll` {Number}, `minBet` {Number}.

## API

### Game

- `deal(bet)` — shuffle when the cut card is out, take the bet, deal two cards to the player and two to the dealer with the second face down, peek for a natural, set the turn.
- `getActions()` — every action the hand in play may take right now.
- `hit()`, `stand()`, `double()`, `split()`, `surrender()` — play the hand in play.
- `insure(take)` — take or decline insurance.
- `playDealer()` — turn the hole card up, draw the dealer's hand out, settle, and return the cards drawn so an interface can pace them.
- `getHands()`, `getHand()` — every betting box, and the one in play.
- `getState()` — `idle`, `insurance`, `player`, `dealer` or `settled`.
- `getResults()`, `getNet()`, `getBankroll()`.
- `getUnseenCounts()` — the cards the player cannot see, counted by value, hole card included. This is what the solver wants.
- `getCount()` — the Hi-Lo running and true count of everything face up.
- `getShoe()`, `getPlayer()`, `getDealer()`, `getTurn()`, `setTurn(player)`, `getRules()`, `needsShuffle()`.

### Strategy

Values are in units of the original bet: `+1` is winning it outright, `-0.5` is the cost of a surrender.

- `analyze(options)` — the expected value of every legal action at a decision point, the best of them, the chart's answer, and the dealer's final total distribution. Takes `counts`, `up`, either `playerCards` or a `player` shape, plus `rules` and `allowed`.
- `dealer(up, counts, rules)` — the chance the dealer finishes on 17 through 21, busts, or turns over a natural.
- `basic(hand, up, rules, allowed)` — the textbook play for four to eight decks.
- `reset()` — drop the memo tables.

The solver walks the real shoe, so it costs more than a table lookup: a hand with a split runs in the low hundreds of milliseconds cold, and in single digits once the tables are warm. The app keeps it off the main thread in `app/coach.worker.js` and asks for the answer the moment a decision opens, so the verdict is waiting by the time a button is tapped.

Two simplifications are worth naming: the halves of a split are valued independently, and the dealer's peek is applied when the hole card is drawn rather than folded back into the player's own draw probabilities. Both are the usual practice and neither changes which action wins.

### Utils

- `score(cards)` — the total of a hand, aces counted as eleven until that would bust.
- `hand(cards)` — `{total, soft, bust, blackjack, cards}`.
- `value(card)`, `isBlackjack(cards)`, `counts(cards)`, `total(counts)`, `runningCount(cards)`.

### Probability

The original recursive probability library is still here and unchanged. `Strategy` supersedes it: it is exact, it handles splits and surrender, and it returns expected values rather than raw win, lose and push odds.

## Development

```
npm test              # the engine and solver test suite
npm start             # serve the app at http://localhost:8080
npm run icons         # redraw the app icons
grunt                 # lint and build dist/
```

The test suite checks the engine's payouts and rule handling, and sweeps every hard total, soft total and pair against all ten upcards to confirm that the exact solver and the printed chart agree.

## License

[MIT](https://github.com/ChrisZieba/blackjack/blob/master/LICENSE) license.
