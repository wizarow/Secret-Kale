# Secret Kale

The hidden-role party game, online. 5 to 10 players, bots fill empty seats. Democrats vs Republicans, and one party hides a team.
v1 · Ishan Atul's render

## Run locally
    node server.js      # http://localhost:3000   (Node 18+, no dependencies)
    npm test            # rule checks and simulated games (engine), then run test/server.test.js for a full game over HTTP
    node build.js       # writes dist/secret-kale-demo.html (whole app in one page, plays against bots)

## Deploy on Render (same as Judgement and Asshole)
1. Push this folder to a GitHub repo.
2. Render > New > Web Service > pick the repo.
3. Build command: leave empty. Start command: `node server.js`. Free plan is fine.
4. Open the URL, tap Start a table, share the room code or invite link.
Don't redeploy mid-game: live rooms are held in memory and drop on restart. The free plan sleeps when idle.

## Files
- `server.js`            rooms, live updates (server-sent events), static files
- `public/engine.js`     all the rules and the bots; shared by server and browser
- `public/index.html`    the whole UI (the Election Night look)
- `test/engine.test.js`  rule checks and full simulated games, 5 to 10 players, every bot level
- `test/server.test.js`  one full game over HTTP and server-sent events with five human clients
- `build.js`             makes the single-page demo

## Rules as built (base Secret Hitler, retold for two parties)
- 5 to 10 players (bots count). Each game one party is the hidden team (needs 6 bills); the other is the majority (needs 5).
  Which party hides is drawn at random every game.
- Roles: majority members, hidden-team members, and one Kingpin (on the hidden team).
  Players 5/6/7/8/9/10: 3/4/4/5/5/6 majority and 1/1/2/2/3/3 hidden team besides the Kingpin.
- Hidden team and Kingpin know each other. At 5 or 6 players the Kingpin also knows the team; at 7 or more the Kingpin does not.
- The Reveal (the board game's night phase), once at the start: every human looks at their role in private and taps "I've seen it"; the first vote waits for all of them (bots never hold it up; an away human is passed after 25 s). It does not repeat.
- After 3 hidden-team bills, each elected Speaker who is not the Kingpin is marked "Not the Kingpin" in public (the table's "is the new Chancellor Hitler?" check).
- 17 bills: 6 majority, 11 hidden team. The President rotates around the table.
  The President nominates a Speaker; everyone alive votes Yea or Nay, shown together; more Yea than Nay elects, a tie fails.
- The last elected President and Speaker cannot be nominated (only the last Speaker when 5 players are left).
- Three failed votes in a row: the top bill is enacted by chaos, no power, term limits clear.
- Legislative session: the President draws 3, discards 1, passes 2; the Speaker enacts 1.
- Powers from hidden-team bills (the 6th wins): 5-6 players: peek (3rd), execution (4th, 5th). 7-8: investigate (2nd), special election (3rd), execution (4th, 5th). 9-10: investigate (1st, 2nd), special election (3rd), execution (4th, 5th).
- After 5 hidden-team bills the Speaker may ask for a veto; the President must agree (both bills discarded, tracker +1).
- Hidden team wins: 6 hidden-team bills, or the Kingpin elected Speaker after 3. Majority wins: 5 majority bills, or the Kingpin executed.
- Dead players cannot vote, be nominated or chat; their roles stay hidden until the end.
- The tracker resets whenever a bill is enacted. The record shows every vote, and at the end every draw and discard.

## Settings
Name, text size, host: seats (5 to 10), bots on/off, bot level (Easy, Medium, Hard), turn timer (Off, 30 s, 45 s, 1 min, 2 min), remove a player (a bot takes the seat mid-game).

## Notes
- Name is required to create or join. Rejoin after a refresh is automatic on the same device. `/?r=CODE` prefills the room code.
- Turn timer: when it runs out a bot plays that turn and a note appears in the chat.
- A disconnected human who is up to act (or still to vote) is played for after 25 seconds, at Medium, and gets control back when they return, with the same secret role.
- Bots never chat. Chat is in-app only; there is no claims log.
- Not built yet: the Mastermind variant (waiting for the rules text).
- Connection: same handling as Judgement. SSE with a 10 s heartbeat, resync on wake, polling fallback, `/health` for an uptime pinger.
