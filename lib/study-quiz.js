// The memory quiz of the user study ("Questions after reading" in the User Study Design).
// Kept on the server on purpose: participants must not be able to see the questions
// before or while they read, so this file is never sent to the browser as a file.
// The questions go out only once a participant's reading session has closed (lib/study-api.js);
// the expected answers only go to the research team's page.
//
// Do not change the ids, wording or order once the study has started: answers are
// stored under these ids, and the same quiz is used for everyone.
export const QUIZ = [
  { id: 'q1', text: 'Why was Gallery punished in the original French legend?', answer: 'He hunted instead of attending Sunday mass' },
  { id: 'q2', text: "What First Nations story element was combined with Gallery's legend?", answer: 'A flying canoe' },
  { id: 'q3', text: 'Why do the voyagers working at a remote timber camp run the chasse-galerie?', answer: 'To visit their sweethearts and return before work' },
  { id: 'q4', text: 'Name the two actions forbidden by the pact with the Devil.', answer: "Mentioning God's name and touching a church cross" },
  { id: 'q5', text: 'Which amusement ride drew inspiration from the legend?', answer: "A sawmill log ride (La Pitoune at Montreal's La Ronde amusement park)" },
  { id: 'q6', text: 'How was the legend referenced at the 2010 Winter Olympics opening ceremony?', answer: 'Through a canoe carrying a fiddler (Colin Maier) lowered from the ceiling' },
  { id: 'q7', text: 'The story was retold through what medium in December 2001?', answer: "A radio program (C'est la Vie)" },
  { id: 'q8', text: 'When was the first feature film adaptation released?', answer: 'February 2016 (Wild Run: The Legend)' },
];
