# Wikipedia Mind Palace

CS 1377 final project by Jasmine Liu, Steven Ding and Mateo Campoverde-Fordon.

The app turns a Wikipedia article into a 3D room. Each chunk of the article becomes a stop along a path,
and the reader picks the object that will hold it. Claude suggests the room's theme and 3–5 objects per
stop, and the reader still makes the final choice.

## Run it

```bash
npm install
npm run dev            # http://localhost:8000
```

To turn on Claude suggestions, copy `.env.example` to `.env` and set `ANTHROPIC_API_KEY`. Without a key
everything still works: the app shows a notice and falls back to the offline keyword matcher. On a
public site, Claude is limited to people who sign in with a Brown account (see "Who can use Claude"). three.js
loads from jsDelivr, so the browser needs internet access.

The app has three modes, switched at the top of the landing page:

- **Demo** (`/`): the nine ready-made palaces (see below). Open to everyone: no sign-in, no Claude, no
  cost.
- **Explore** (`/?explore`): the full app. Any Wikipedia article, with Claude suggesting the setting and
  objects. Needs a Google sign-in with a Brown account (see "Who can use Claude"); until someone signs in,
  the page shows the sign-in button instead of the search box.
- **Study session** (`/?study`): the timed version for the user study. Its own sign-in (name, email, age;
  no Google account), a fixed article, a countdown and the memory quiz. With a MongoDB database,
  participants can do this on their own computers and the data is collected in one place.

| URL | What it opens |
|---|---|
| `/` | Demo mode: the ready-made palaces |
| `/?explore` | Explore mode: sign in, then search any article |
| `/?article=Roman%20Empire` | Explore mode, building a palace for that article right away (after sign-in) |
| `/?sample` | the ready-made Honey bee palace |
| `/?study` | **Study session mode** (see below): what participants open |
| `/?study=admin` | the research team's page: everyone who signed in, downloads |
| `/?study=local` | a study session kept in this browser only (no database) |
| `/gallery.html` | all 113 objects in the kit, for checking models |

## How a palace is made

1. **Article:** the text is fetched from the Wikipedia API (`js/wiki.js`). `extension/` is a Chrome
   content script that adds an “Open in Mind Palace” button on Wikipedia pages.
2. **Chunks:** non-content sections (References, See also…) are dropped and the text is split into at most
   8 stops. Normal mode trims long sections, with the full text one click away. *Complete* mode, used in
   the study, never trims: long sections are split by paragraph, so every sentence is kept.
3. **Claude:** `api/suggest.js` sends the chunks to Claude (`lib/palace-ai.js`, model `claude-opus-5-5`)
   with the object catalog. Claude returns one theme and 5 objects per chunk, each with a one-line
   “hook” tied to a detail in the text. Structured output limits Claude to object ids that exist. The
   API key stays on the server.
4. **Reader picks, in 3D:** the suggested objects float on a ring around the stop, slowly circling
   (`js/room.js`). Pointing at one opens its hook, shows a faint full-size preview on the stop and lights
   up the sentence it stands for in the text (`js/anchors.js` matches hook to sentence). Clicking it sends
   it down to the stop, where it grows to its real size. The panel lists the same objects by name (for
   keyboards and phones) and can open the full kit. Each object is used only once per room.
5. **Palace:** one of three buildings (`js/settings.js`), each with its own architecture, landmark and
   route. `js/room.js` adds the numbered stops, the dotted path and the camera. The reader can take a guided
   tour, walk freely, or (outside the study) do a self-recall test.

| Setting | For | Landmark | Route through the stops |
|---|---|---|---|
| **Observatory** | cosmology, physics, maths, science and technology | the great telescope aimed through the dome slit at the moon | a ring around the telescope |
| **Grand Library** | literature, legends, biography, philosophy, religion | the tall arched window | a U past the book alcoves |
| **Museum Gallery** | history, art, culture, geography, nature, society | the statue under the pediment | a weave from wall to wall |

Claude picks the setting from the article. The reader can change it from the top bar, and placed objects
move with it. To add a setting, write one builder function in `js/settings.js` and one entry in `THEMES`
in `js/catalog.js`.

Object kit: `js/catalog.js` holds names, descriptions (what Claude reads) and keywords (for the fallback).
`js/objects.js` builds the 3D models from primitives, so no asset files are needed. To add an object, add
one line to each file.

## Ready-made articles

The articles in `data/palaces/` were built ahead of time: their chunks, setting and object suggestions
are fixed, so they open at once and Claude is not called. They are listed in `data/palaces/index.json`
and shown as buttons on the landing page. Typing one of their titles, following a link to one, or
arriving from the extension opens the ready-made palace too. Any other article is built live with Claude.

Currently: Black hole, Great Wall of China, Honey bee, Jazz, Leonardo da Vinci, Photosynthesis, Roman
Empire, Solar System, Volcano.

The study's article (Chasse-galerie) has a pre-built palace too, but it is left out of this list on
purpose, so participants cannot read it in the Demo before or between their sessions. The build script
skips every article named in `data/study.json` when it writes the index; the study loads its file directly.

To add one (uses `ANTHROPIC_API_KEY`, one Claude call, and updates the index):

```bash
npm run build-palace -- "Octopus" --explore
```

`--explore` chunks the article the way the live app does (long sections trimmed, full text one click
away). Without it the text is kept complete, which is what the study article uses. An existing file is
not replaced unless you pass `--force`; never do that to the study article once the study has started.
To remove an article, delete its file and run `npm run build-palace -- --index`.

## Study session mode (`/?study`)

This follows the teammate's *User Study Design*. What a participant goes through:

1. **Sign-in:** name, email and age, all required.
2. **Walkthrough:** a short how-it-works for their condition (4 cards for the palace, 3 for the article).
3. **Timed reading:** the countdown (15 min, from `data/study.json`) starts when they press *Start
   reading*, before any object is placed, so building the palace counts as reading time. It shows in the
   top bar and turns red in the last minute.
4. **Reading closes:** when time runs out, or they press *I'm done*, the room or article is taken off
   the page and stays closed.
5. **Memory quiz:** the 8 questions from the study design, on one page, with their own countdown
   (10 min, `quizMinutes` in `data/study.json`; 0 = no limit). The timer starts when they press *Start the
   quiz*. Answers are saved as they type; when the time is up, what is written is handed in.
6. **Closed:** a thank-you screen that says when the follow-up quiz opens.
7. **Two days later, the retake:** the participant opens the same link (and signs in with the same email
   address if the browser no longer remembers them) and gets the same 8 questions again, with the same time
   limit. The article stays closed: this round measures what is still remembered. It opens
   `retakeAfterHours` (48) after the first quiz was handed in; before that the link shows the opening time.
   Needs the database; leave `retakeAfterHours` out of `data/study.json` to run the retake outside the app.

### With a database (participants on their own computers)

Set `MONGODB_URI` and `STUDY_ADMIN_KEY` (see `.env.example`) and `/?study` becomes a link you can send out:

- **The server assigns the condition**, balanced between Mind Palace and standard article (whichever has
  fewer people so far; a coin flip when level), and numbers participants P01, P02, …
- **The server keeps the clock.** A reload, another computer or a changed system clock cannot add time.
- **One email address, one session.** Signing in again with the same address, on any computer, continues
  that session with the clock still running, or shows the closed screen if it is over.
- **The link asks who is there, every time.** A finished session is not remembered by the browser, so the
  next person on the same computer gets the sign-in page, and only the same email address leads back to
  that session. The exception is a session in the middle of reading or of a quiz: a reload continues it at
  once, so no time is lost.
- **Progress is saved as they go** (about 1.5 s after each action, and when the page is closed), so a
  crash loses almost nothing. If nobody presses *I'm done* and the page is closed, the session counts as
  timed out once the 15 minutes have passed.
- **`/?study=admin`** (asks for `STUDY_ADMIN_KEY`) lists everyone with their status, and downloads all
  sessions as JSON, the summary table as CSV, or one session. *Delete* removes a session, for example your
  own test runs, and lets that address take part again.
- **The quiz is kept on the server.** The questions (`lib/study-quiz.js`) are only sent once that
  participant's reading has closed, the quiz clock is the server's, and the expected answers never go to a
  participant. A reload or another computer continues the quiz with the answers typed so far.
- **Grading:** the researcher page shows who has finished the quiz and the retake, and lists the expected
  answers. The CSV has one column per question and round (`q1`…, `retake_q1`…); the JSON puts each answer
  next to the question and the expected answer. It also records how long each round took, how long after
  the reading the quiz began, and how many hours after the quiz the retake began.
- **Forms after each round:** set `afterReadingUrl` in `data/study.json` to a form (an `https://` link),
  for example the follow-up questions, and the screen after the first quiz shows a *Continue to the
  questions* button. `afterRetakeUrl` does the same after the retake, for the second-session question.
- **Nobody is reminded automatically.** The closed screen tells participants when to come back; send them
  the link again after two days. The researcher page shows whose retake is open and not yet started.

Setup: create a free cluster at MongoDB Atlas, add a database user, allow network access from anywhere
(Vercel's addresses change), and copy the connection string into `MONGODB_URI`. Data goes to the
`sessions` collection of the `mind_palace` database, one document per participant. Code: `api/study.js`,
`lib/study-api.js`, `lib/study-db.js`.

Things to know: the sign-in is not a real login (anyone who knows a participant's email address can open
that participant's session, though not their name or age), and the endpoint has no rate limit.

### Without a database (`/?study=local`, or when `MONGODB_URI` is not set)

A researcher sets the session up on their own computer: participant ID, condition (or random), article and
reading time. The participant then signs in, reads and takes the quiz as above. The log, with the quiz
answers, stays in that browser; download it under *Researcher* on the closed screen, or all of them from the
setup screen. The closed screen stays up after a reload until the researcher presses *New session*. The quiz
questions come from the local server (`npm run dev`); on a server that has a database, a `?study=local`
session ends without the quiz. There is no retake in this mode.

What keeps the two conditions comparable:

- **Same text.** Both conditions are built from the same pre-built palace file
  (`data/palaces/chasse-galerie.json`). The control page shows exactly the palace's text (no images in
  either condition). All 8 quiz answers are present.
- **Same suggestions and setting for everyone.** Claude runs once at build time, not per participant:
  `npm run build-palace -- "Chasse-galerie"` (uses `ANTHROPIC_API_KEY`). The current file holds Claude's
  suggestions and is set to the Grand Library. Don't rebuild it once the study has started.
- **Same quiz, no extra practice.** Both conditions get the same memory quiz after the reading. The
  palace's own self-recall test is hidden in study mode (it would be extra retrieval practice the control
  group doesn't get), and there are no outbound links.
- **Control condition:** a plain Wikipedia-style page. Participants highlight by selecting text and click
  a highlight to remove it, as in the proposal.

Each log contains timestamped events (stop views, object choices with the suggestion's rank or “full
list” and whether it was picked in the room or by name, rereads, tour/walk, highlights), the final objects, seconds per stop and how the session ended. A
reload mid-session resumes with the original start time.

Logs hold the participant's name, email and age (`person`), so treat the database and any downloaded
files as personal data: keep them out of the repo and share them only within the team.

The familiarity rating and the follow-up questions stay outside the app (e.g. a form). Don't change the
questions in `lib/study-quiz.js` once the study has started.

## Who can use Claude (sign-in)

Asking Claude about a new article spends API credit, so on a public site it sits behind a sign-in.
The ready-made palaces, the keyword suggestions and the study are free and need no sign-in.

- Set `GOOGLE_CLIENT_ID` and the Explore page shows a "Sign in with Google" button. Only accounts in
  `ALLOWED_EMAIL_DOMAINS` (default `brown.edu`) get Claude's suggestions; the server checks Google's
  signed token, including the account's Workspace domain, so typing a Brown address is not enough.
  `ALLOWED_EMAILS` adds single addresses outside the domain (a teammate's Gmail, say).
- Everyone signed in gets `SUGGEST_DAILY_LIMIT` Claude requests a day (default 10; one request = one
  article). With `MONGODB_URI` set, the count is kept in the `usage` collection (email, day, count;
  rows delete themselves after 30 days). Without a database it is counted in memory, which Vercel does
  not keep between server instances, so set `MONGODB_URI` for a limit that holds.
- Someone not signed in sees the sign-in button in place of the search box. Someone over the limit, or
  hit by a Claude error, still gets the palace: the objects are then matched by keywords, and a notice
  says so.
- Without `GOOGLE_CLIENT_ID`, Claude is open to everyone on your own computer (`npm run dev`) and the
  Explore page says so; put a client ID in `.env` to see the sign-in button locally. On Vercel, Explore is
  **switched off** without it, so a deployment cannot expose the key by accident.

To get a client ID: Google Cloud console > APIs & Services > Credentials > Create credentials > OAuth
client ID > Web application. Under "Authorized JavaScript origins" add the site's address
(`https://<project>.vercel.app`) and, for local testing, `http://localhost:8000` and `http://localhost`.
No client secret is used. The code is in `lib/access.js`, `api/auth.js` and `js/access.js`.

As a last line of defence, set a monthly spend limit for the API key in the Claude Console.

## Deploy (Vercel)

The repo deploys as-is: static files plus the `api/suggest.js`, `api/auth.js` and `api/study.js`
functions. Set these in the Vercel project's environment variables:

- for the study: `MONGODB_URI` and `STUDY_ADMIN_KEY`
- for Claude in Explore mode: `ANTHROPIC_API_KEY` **and** `GOOGLE_CLIENT_ID` (see above). With only the
  API key, Claude stays off on Vercel.

`vercel.json` makes sure the study function can read `data/`, and redirects requests for `lib/` and
`scripts/` so the quiz questions cannot be opened as a file. After deploying, check that
`https://<project>.vercel.app/lib/study-quiz.js` does not show them.

Article text from Wikipedia under CC BY-SA 4.0.
