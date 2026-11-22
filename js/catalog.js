// The fixed object kit and room themes, as plain data (no three.js), so both the
// browser and the Claude proxy (api/suggest.js) can use them.
//   desc     – what the object can stand for; Claude reads this to pick objects
//   keywords – word stems for the offline keyword fallback (mapper.js)

const O = (id, name, icon, desc, keywords) => ({ id, name, icon, desc, keywords: keywords.split(' ') });

export const OBJECTS = [
  // ---- original kit ----
  O('tree', 'Tree', '🌳', 'nature, growth, family trees, origins, life, ecology', 'nature plant forest species ecolog evolution biolog life environment habitat organism origin genus famil phylogen growth root wild'),
  O('bookshelf', 'Bookshelf', '📚', 'books, literature, scholarship, history writing, language, names', 'history literature book writing written publication study research education knowledge language etymolog name word term philosoph author novel scholar'),
  O('chair', 'Chair', '🪑', 'everyday people, home life, roles in a group, sitting in office', 'people person life early personal family home house daily society social member worker role caste community'),
  O('dog', 'Dog', '🐕', 'animals, loyalty, domestication, companionship, behaviour', 'animal behavio domestic companion mammal pet breed loyal guard hunt predator'),
  O('globe', 'Globe', '🌍', 'the world, geography, countries, distribution, spread', 'world country countries geograph distribution international global region population continent map native range nation'),
  O('clock', 'Grandfather clock', '🕰️', 'time, eras, dates, cycles, chronology, deadlines', 'time era century timeline period date chronolog age year cycle stage season day midnight morning deadline'),
  O('lamp', 'Floor lamp', '💡', 'ideas, theories, discoveries, insight, electricity', 'idea theory invention discover science concept innovation principle hypothes insight light electric understand'),
  O('telescope', 'Telescope', '🔭', 'astronomy, space, observation, looking far away', 'astronom space star planet observ universe physics sky orbit galax solar navigation vision sight'),
  O('flask', 'Lab bench', '⚗️', 'chemistry, experiments, medicine, nutrition, compounds', 'chemi experiment medicine drug compound reaction element protein acid molecul laborator nutrition nutrient vitamin toxin venom enzyme'),
  O('statue', 'Marble bust', '🗿', 'famous people, legacy, classical culture, monuments', 'culture art religio myth legacy monument sculpt symbol ancient greek roman tradition heritage bust portrait'),
  O('crown', 'Crown', '👑', 'kings, queens, empires, government, power, royalty', 'king queen empire government politic power ruler monarch state reign dynasty royal leader authority hierarch'),
  O('treasure', 'Treasure chest', '💰', 'money, trade, economy, wealth, products, value', 'econom money trade market cost industr business price financ product wealth value commerc export resource income treasure'),
  O('piano', 'Piano', '🎹', 'music, composers, performance, classical music', 'music song compos perform piano concert classical melody album'),
  O('sword', 'Sword in stone', '⚔️', 'war, battles, conflict, defence, legends of heroes', 'war battle militar conflict army weapon defen attack threat fight invasion enemy kill hero'),
  O('ship', 'Model ship', '⛵', 'sea voyages, exploration, navies, colonisation, migration', 'sea ocean travel explor voyage navy colonial port island journey sail ship'),
  O('heart', 'Heart', '❤️', 'love, romance, health, the body, emotions, disease', 'health disease body anatom medical blood love romance sweetheart emotion heart lover marriage'),
  O('gear', 'Gears', '⚙️', 'machines, mechanisms, processes, systems, engineering', 'machine engine mechani production engineer structure process system method manufactur build construct function'),
  O('flower', 'Potted flowers', '🌸', 'flowers, gardens, pollination, agriculture, beauty', 'flower agricult crop pollinat cultivat garden bloom nectar pollen petal'),
  O('candle', 'Candelabra', '🕯️', 'rituals, remembrance, night, mourning, faith', 'death memor ritual ceremony wax spirit sacred mourn funeral faith candle vigil'),
  O('geode', 'Crystal geode', '💎', 'geology, minerals, gems, rocks, hidden value', 'geolog earth mineral rock crystal gem cave soil fossil'),
  O('computer', 'Computer desk', '💻', 'computers, software, data, the internet, digital media', 'computer software data digital internet algorithm network technolog program code electronic information online video game'),
  O('trophy', 'Trophy', '🏆', 'awards, prizes, winning, records, achievements', 'award achiev sport competition record success reception champion prize win honou honor'),
  O('easel', 'Easel', '🎨', 'painting, visual art, artists, images, design', 'painting art style visual image color colour depict portrait design illustrat artist cover'),

  // ---- transport ----
  O('canoe', 'Flying canoe', '🛶', 'canoes, rivers, voyageurs, paddling, flight, journeys by water', 'canoe river paddl voyageur boat lake rowing fly flight float'),
  O('car', 'Car', '🚗', 'cars, roads, driving, modern life, the automotive industry', 'car automobile road driv vehicle motor highway traffic'),
  O('train', 'Locomotive', '🚂', 'railways, trains, the industrial age, travel overland', 'train railway rail locomotive station steam track'),
  O('airplane', 'Airplane', '✈️', 'flight, aviation, air travel, pilots, air forces', 'airplane aircraft aviation pilot flight airline air jet'),
  O('bicycle', 'Bicycle', '🚲', 'cycling, everyday transport, balance, sport', 'bicycle cycl bike pedal ride'),
  O('rocket', 'Rocket', '🚀', 'space flight, rockets, missiles, ambition, launches', 'rocket launch spacecraft missile nasa astronaut space mission'),
  O('balloon', 'Hot-air balloon', '🎈', 'ballooning, lightness, rising up, early flight, adventure', 'balloon rise float air lift adventure'),
  O('anchor', 'Anchor', '⚓', 'harbours, sailors, staying put, stability, the navy', 'anchor harbo sailor naval maritime stabil port dock'),

  // ---- nature ----
  O('pine', 'Pine tree', '🌲', 'forests, northern wilderness, winter, logging, Christmas', 'pine forest wood wilderness north winter tree logging lumber christmas'),
  O('palm', 'Palm tree', '🌴', 'tropics, islands, beaches, hot climates, holidays', 'palm tropic island beach coast warm desert oasis holiday'),
  O('cactus', 'Cactus', '🌵', 'deserts, drought, survival, the American Southwest', 'cactus desert drought arid dry survival mexico'),
  O('mushroom', 'Giant mushroom', '🍄', 'fungi, decay, forests, fairy tales, toxicity', 'mushroom fung spore decay toxic poison fairy'),
  O('mountain', 'Snowy peaks', '🏔️', 'mountains, climbing, borders, altitude, challenges', 'mountain peak summit climb alp himalay altitude range hill'),
  O('volcano', 'Volcano', '🌋', 'eruptions, disasters, geology, sudden change, anger', 'volcan erupt lava disaster earthquake magma explosion'),
  O('cloud', 'Rain cloud', '🌧️', 'weather, rain, climate, storms, gloom', 'weather rain cloud storm climate wind monsoon flood'),
  O('sun', 'Sun lamp', '☀️', 'the sun, energy, summer, daytime, solar power, gods of light', 'sun solar summer heat energy light day bright'),
  O('moon', 'Moon globe', '🌙', 'the moon, night, tides, dreams, the night sky', 'moon night lunar tide dark sky dream midnight'),
  O('snowman', 'Snowman', '⛄', 'winter, snow, cold, New Year, childhood fun', 'snow winter cold ice frozen frost blizzard'),
  O('fishbowl', 'Fishbowl', '🐠', 'fish, water life, aquariums, being watched', 'fish aquat water marine aquarium sea lake'),
  O('birdcage', 'Birdcage', '🐦', 'birds, captivity, song, freedom vs. confinement', 'bird cage song captiv freedom feather wing'),
  O('cat', 'Cat', '🐈', 'cats, curiosity, independence, superstition, pets', 'cat feline curious independen superstit pet'),
  O('horse', 'Rocking horse', '🐴', 'horses, cavalry, riding, childhood, galloping', 'horse cavalry riding gallop childhood toy rider'),
  O('butterfly', 'Butterfly case', '🦋', 'insects, transformation, metamorphosis, collecting', 'butterfl insect metamorph transform collect moth'),
  O('skull', 'Skull', '💀', 'death, anatomy, danger, mortality, fossils, pirates', 'death dead skull anatom mortal danger die skeleton bone pirate'),
  O('beehive', 'Beehive', '🐝', 'bees, hard work, colonies, honey, cooperation', 'bee hive honey colony swarm cooperat busy'),
  O('fruitbowl', 'Fruit bowl', '🍎', 'food, fruit, diet, harvest, abundance', 'food fruit diet eat harvest apple meal nutrition cuisine'),
  O('wheat', 'Wheat sheaf', '🌾', 'farming, bread, grain, harvest, rural life', 'wheat grain farm harvest bread rural agricult field crop'),
  O('axe', 'Axe & stump', '🪓', 'lumberjacks, logging camps, forestry, hard labour, chopping', 'axe lumber logger logging timber camp forest chop wood labo woodcutter'),
  O('campfire', 'Campfire', '🔥', 'fire, storytelling, camping, warmth, gatherings', 'fire camp flame warm burn story gather'),
  O('tent', 'Tent', '⛺', 'camps, expeditions, nomads, temporary homes', 'tent camp expedition nomad shelter refugee'),

  // ---- science & tech ----
  O('microscope', 'Microscope', '🔬', 'biology, cells, germs, close study, research', 'microscop cell bacteri germ microb research biolog virus'),
  O('atom', 'Atom model', '⚛️', 'physics, atoms, nuclear power, particles, chemistry', 'atom nuclear physic particle electron quantum radiat'),
  O('dna', 'DNA helix', '🧬', 'genetics, DNA, heredity, evolution, identity', 'dna gene genetic hered chromosom mutation inherit genom'),
  O('magnet', 'Horseshoe magnet', '🧲', 'magnetism, attraction, forces, pulling together', 'magnet attract force pull field compass'),
  O('abacus', 'Abacus', '🧮', 'mathematics, counting, numbers, statistics', 'math number count arithmet statistic calculat algebra equation'),
  O('chalkboard', 'Chalkboard', '📝', 'school, teaching, lessons, formulas, education', 'school teach lesson class student education formula lecture university'),
  O('hourglass', 'Hourglass', '⏳', 'time running out, waiting, durations, mortality', 'hourglass wait duration limit sand countdown'),
  O('compass', 'Compass', '🧭', 'navigation, direction, exploration, finding the way', 'compass direction navigat north south explor route'),
  O('magnifier', 'Magnifying glass', '🔍', 'investigation, detectives, crime, close reading, evidence', 'investigat detective crime evidence mystery clue search examin'),
  O('firstaid', 'Medicine box', '🩺', 'medicine, doctors, hospitals, treatment, cures', 'medicine doctor hospital treatment cure patient therapy surgery nurse'),
  O('robot', 'Robot', '🤖', 'robots, automation, AI, science fiction, the future', 'robot automat artificial intelligen android science fiction futur machine'),
  O('satellite', 'Satellite', '🛰️', 'satellites, orbit, telecommunications, GPS, space age', 'satellite orbit telecom signal gps broadcast'),
  O('windmill', 'Windmill', '🌬️', 'wind power, energy, mills, the Netherlands, grinding grain', 'windmill wind mill energy renewable dutch netherland power'),
  O('factory', 'Factory', '🏭', 'industry, factories, pollution, mass production, workers', 'factory industr pollut manufactur plant mass production smoke worker'),

  // ---- arts & media ----
  O('fiddle', 'Fiddle', '🎻', 'fiddles and violins, folk music, dancing, string players', 'fiddl violin folk string dance jig reel'),
  O('guitar', 'Guitar', '🎸', 'guitars, bands, rock and pop, singer-songwriters', 'guitar band rock pop singer songwriter album'),
  O('drum', 'Drum', '🥁', 'drums, rhythm, marching, ceremonies, heartbeat', 'drum rhythm beat march percussion parade'),
  O('horn', 'Brass horn', '📯', 'hunting horns, brass bands, fanfare, announcements', 'horn trumpet brass fanfare hunting announce'),
  O('gramophone', 'Gramophone', '📀', 'records, recordings, old music, the 1900s', 'record recording gramophone phonograph label album sound'),
  O('microphone', 'Microphone', '🎤', 'singing, speeches, performance, podcasts, voices', 'microphone sing vocal voice speech perform podcast narrat'),
  O('filmcamera', 'Film camera', '🎥', 'films, cinema, directors, animation, documentaries', 'film movie cinema director animat documentar screen actor hollywood'),
  O('masks', 'Theatre masks', '🎭', 'theatre, drama, plays, musicals, comedy and tragedy', 'theat drama play stage musical comedy tragedy actor opera'),
  O('typewriter', 'Typewriter', '⌨️', 'writers, journalism, novels, manuscripts, authors', 'writer typewriter journal manuscript novel author wrote essay'),
  O('quill', 'Quill & inkwell', '🪶', 'old documents, poetry, signatures, treaties, letters', 'quill ink poem poet sign treaty letter document charter'),
  O('newspaper', 'Newspapers', '📰', 'news, the press, magazines, reports, publicity', 'news newspaper press magazine report headline journalis publish'),
  O('storybook', 'Storybook on lectern', '📖', 'a single story, legends, folktales, scripture, reading aloud', 'story tale legend folk fable myth scripture bible reading narrat'),
  O('vase', 'Amphora', '🏺', 'archaeology, pottery, ancient trade, artefacts', 'archaeolog pottery ancient artifact artefact excavat ceramic'),
  O('bell', 'Bell', '🔔', 'church bells, warnings, celebrations, calling people together', 'bell church toll ring alarm chime'),

  // ---- communication ----
  O('radio', 'Vintage radio', '📻', 'radio programmes, broadcasting, wartime news, storytelling on air', 'radio broadcast program station listen air wireless'),
  O('tv', 'Television', '📺', 'television, TV shows, mass media, broadcasting', 'television tv show series episode broadcast channel media'),
  O('telephone', 'Telephone', '☎️', 'telephones, calls, communication, invention of the phone', 'telephone phone call communicat conversation'),
  O('postbox', 'Post box', '📮', 'mail, letters, postage stamps, the postal service', 'mail post letter stamp postal postage deliver'),

  // ---- society, belief, history ----
  O('scales', 'Scales of justice', '⚖️', 'law, courts, trials, fairness, rights', 'law court trial justice judge legal right fair crime verdict'),
  O('ballot', 'Ballot box', '🗳️', 'elections, voting, democracy, parties', 'election vote ballot democra party campaign referendum'),
  O('flag', 'Flag', '🚩', 'nations, independence, identity, symbols, Olympics', 'flag nation independen patriot identity symbol country state'),
  O('castle', 'Castle tower', '🏰', 'castles, the Middle Ages, fortresses, sieges, nobility', 'castle medieval fortress siege noble lord knight fort'),
  O('helmet', 'Knight helmet', '🪖', 'knights, armour, chivalry, soldiers, protection', 'knight armor armour chivalr soldier helmet crusade'),
  O('cannon', 'Cannon', '💣', 'artillery, naval battles, explosions, revolutions', 'cannon artiller gun explos revolution bombard'),
  O('bow', 'Bow & arrows', '🏹', 'hunting, archery, aiming at a target, Indigenous traditions', 'hunt hunter archer bow arrow target aim'),
  O('chess', 'Chess set', '♟️', 'strategy, games, tactics, rivalries, planning', 'chess strateg game tactic rival plan move'),
  O('chapel', 'Chapel with cross', '⛪', 'churches, Christianity, mass, God, steeples, sin and salvation', 'church christian mass god chapel steeple cross priest sunday catholic pray sin salvation blasphem'),
  O('pyramid', 'Pyramid', '🔺', 'Egypt, ancient wonders, tombs, hierarchies', 'pyramid egypt pharaoh tomb ancient wonder'),
  O('column', 'Greek column', '🏛️', 'classical Greece and Rome, architecture, democracy, philosophy', 'greek greece rome roman classical architect column temple philosoph'),
  O('trident', "Devil's pitchfork", '🔱', 'the Devil, hell, temptation, pacts, sin; also Neptune and the sea', 'devil satan lucifer hell demon pact temptation sin damn neptune trident'),
  O('cauldron', "Witch's cauldron", '🧪', 'witches, magic, spells, curses, potions, folklore', 'witch magic spell curse potion folklore sorcer bewitch enchant'),
  O('crystalball', 'Crystal ball', '🔮', 'prophecy, fortune telling, the future, mystery, the supernatural', 'prophec fortune future predict mystic supernatural ghost spirit'),
  O('lantern', 'Lantern', '🏮', 'night journeys, guidance, festivals, light in darkness', 'lantern night guide festival dark journey'),
  O('key', 'Giant key', '🗝️', 'secrets, solutions, access, unlocking, keys to a city', 'key secret unlock solution access lock open'),
  O('suitcase', 'Suitcase', '🧳', 'travel, immigration, tourism, moving away, settlers', 'travel immigra emigra tourism tourist settler moving luggage abroad'),
  O('cradle', 'Cradle', '👶', 'birth, babies, childhood, beginnings, family', 'birth baby born child childhood infant cradle mother'),
  O('bed', 'Bed', '🛏️', 'sleep, dreams, rest, illness, night-time', 'sleep dream bed rest night ill'),
  O('door', 'Open door', '🚪', 'entrances, new beginnings, transitions, opportunities, homes', 'door entrance enter portal transition opportunit gateway'),
  O('lighthouse', 'Lighthouse', '🗼', 'coasts, warnings, guidance, shipwrecks, safety', 'lighthouse coast shipwreck warn beacon safety'),

  // ---- leisure & food ----
  O('soccer', 'Football', '⚽', 'football/soccer, team sports, the World Cup, fans', 'football soccer sport team player league cup goal'),
  O('torch', 'Olympic torch', '🔦', 'the Olympics, opening ceremonies, carrying a flame, national pride', 'olymp ceremon torch flame games athlete opening tribute'),
  O('ferris', 'Ferris wheel', '🎡', 'amusement parks, rides, fairs, entertainment, going round', 'amusement park ride fair carnival entertain roller coaster attraction'),
  O('dice', 'Dice', '🎲', 'games, chance, luck, gambling, probability', 'dice chance luck gambl probabil game random'),
  O('cake', 'Tiered cake', '🎂', 'celebrations, parties, festivals, birthdays, weddings', 'celebrat party festiv birthday wedding feast anniversar'),
  O('teapot', 'Teapot', '🫖', 'tea, hospitality, conversation, British and Chinese culture', 'tea teapot hospitalit british china conversation'),
  O('barrel', 'Barrel & bottle', '🍷', 'alcohol, drinking, rum, beer and wine, breweries, taverns', 'alcohol drink drunk rum beer ale wine brew whisk tavern liquor'),
];

export const OBJECT_BY_ID = Object.fromEntries(OBJECTS.map((o) => [o.id, o]));

// Palace settings. The architecture for each id is built in settings.js; this is
// the plain-data side: the name shown in the UI, the description Claude reads when
// it picks a setting, keywords for the offline fallback, and UI colours.
// Every article must land in one of these, so the descriptions are broad.
export const THEMES = {
  observatory: {
    id: 'observatory',
    name: 'Observatory',
    route: 'a ring around the great telescope',
    desc: 'a domed observatory at night with a great telescope under the stars; for cosmology, astronomy, physics, mathematics, and science and technology in general',
    keywords: ['space', 'astronom', 'cosmolog', 'physics', 'star', 'planet', 'mathemat', 'quantum', 'galax', 'universe', 'orbit', 'scien', 'technolog', 'engineer', 'computer', 'chemi', 'theor'],
    accent: '#9db8ff',
    bg: '#04060d',
  },
  library: {
    id: 'library',
    name: 'Grand Library',
    route: 'a U past the book alcoves to the great window and back',
    desc: 'a two-storey library hall with walls of books, reading tables and warm lamps; for literature, stories, legends and folklore, biography, philosophy, language, religion and ideas',
    keywords: ['literature', 'language', 'philosoph', 'book', 'writ', 'poet', 'novel', 'author', 'legend', 'tale', 'folk', 'myth', 'story', 'religio', 'biograph', 'born', 'educat'],
    accent: '#f2c27a',
    bg: '#1a120b',
  },
  museum: {
    id: 'museum',
    name: 'Museum Gallery',
    route: 'a weave from wall to wall down the gallery',
    desc: 'a bright marble gallery with columns, a skylight and exhibits in arched niches; for history, empires and wars, art, archaeology, culture, geography, nature and society',
    keywords: ['art', 'culture', 'ancient', 'empire', 'king', 'war', 'dynasty', 'century', 'histor', 'paint', 'museum', 'archaeolog', 'species', 'animal', 'plant', 'country', 'politic', 'econom'],
    accent: '#a8843c',
    bg: '#cfcac0',
  },
};
