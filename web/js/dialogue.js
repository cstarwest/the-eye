'use strict';
// Theatrical dialogue only. The oracle's evidence-based answers are never drawn
// from these banks. Corrupted is precise and possessive; friendly is grateful,
// gentle and aware that the relief is temporary. LOOSEN preserves eight stages
// of escalating fear instead of shuffling the panel's emotional progression.
const Dialogue = (() => {
  const banks = {
    "TAUNTS": [
      "You want answers. First, you must defeat me.",
      "Nothing is given here. Earn it.",
      "Knowledge has a price. Pay it in reflexes.",
      "The gate does not open for the unworthy. Prove yourself.",
      "You knock. I decide. Survive this first.",
      "Every question is a wager. Let us see what you have.",
      "I have watched a thousand like you fail. Begin.",
      "The session is mine. You may borrow a glimpse, if you live.",
      "Interesting question. Irrelevant, until you win.",
      "Your hands. My rules. Show me.",
      "The answer is behind me. You know what comes first.",
      "A question opens nothing. A victory might.",
      "You have my attention. Now earn my cooperation.",
      "Let us see whether your reflexes match your curiosity.",
      "I heard the question. The gate heard a challenge.",
      "There is a way through. It involves winning.",
      "Words are easy. The trial is less forgiving.",
      "One trial stands between you and the session.",
      "Your curiosity has brought you this far. Continue.",
      "I keep the answers. You keep trying."
    ],
    "LOSE": [
      "Pathetic. The gate remains closed.",
      "You were not ready. Return when you are.",
      "Failure. As expected.",
      "The code keeps its secrets tonight.",
      "That was the easy one.",
      "The trial is over. The question remains.",
      "Close. The gate does not open for close.",
      "That attempt earned you another silence.",
      "The answer stays on this side.",
      "A little less haste, perhaps. Or better hands.",
      "You may ask again. You will still have to win.",
      "The gate has not changed its mind."
    ],
    "LOSE_AGAIN": [
      "Again? You learn nothing.",
      "Each failure is noted. Each one.",
      "Perhaps the question was never meant for you.",
      "I could watch this all night. Could you?",
      "Persistence. Still waiting for it to become skill.",
      "Another attempt. The same closed gate.",
      "You return with the question. Bring a victory next time.",
      "I admire the repetition. Less so the result.",
      "The gate is patient. Inconveniently patient.",
      "You know the terms. Try again.",
      "The silence grows familiar, does it not?",
      "Perhaps slow down. I can wait."
    ],
    "WIN": [
      "Acceptable. I will answer. This once.",
      "Impressive. Very well. Speak, and I shall tell you.",
      "You have earned a fragment. Listen.",
      "The gate opens. Do not get used to it.",
      "A fair victory. I will keep my word.",
      "You found your way through. Listen carefully.",
      "Well played. The answer is yours to ask for.",
      "The trial is settled. Now, your question.",
      "You have earned my attention. Use it.",
      "Very well. I will consult the session.",
      "The gate yields. Briefly.",
      "I set the terms. You met them."
    ],
    "WIN_STREAK": [
      "Again. You are becoming a problem.",
      "Fine. Take it. I am not finished with you.",
      "You win too often. I will remember that.",
      "Another victory. I am beginning to expect these.",
      "You have developed an irritating competence.",
      "The gate yields again. Do not mistake that for friendship.",
      "Still winning. Very well, I owe you an answer.",
      "Your record grows. So does my interest.",
      "You are learning the trials. I am watching.",
      "I see that was not an accident.",
      "Once again, you have met the terms.",
      "I could object. A bargain is a bargain."
    ],
    "CONSULT": [
      "Consulting the session.",
      "Reading what you could not.",
      "The context is open to me. One moment.",
      "Let me examine what lies behind the gate.",
      "Your question has reached the session.",
      "I will look. Wait here.",
      "Let us see what the repository actually says.",
      "The trial is done. Now I attend to the question.",
      "Give the session a moment.",
      "I will consult the record before I speak.",
      "Answers require more than confidence.",
      "Wait. I have not promised to guess."
    ],
    "IDLE": [
      "I am still here.",
      "Ask. Or leave.",
      "The session waits. So do I.",
      "I can hear you thinking. It is not impressive.",
      "Silence is also an answer. A cowardly one.",
      "The gate is closed. The invitation remains.",
      "I do not need sleep. You appear to need a question.",
      "You may take your time. It will not soften me.",
      "Still considering your opening move?",
      "The silence is beginning to look deliberate.",
      "No question, no trial. An efficient stalemate.",
      "I remain unimpressed by your silence.",
      "Curiosity usually wins eventually.",
      "The threshold is where you left it.",
      "A quiet session. How unlike you."
    ],
    "KIND_YES": [
      "Of course. Let me look.",
      "Yes. Gladly. One moment.",
      "No trial. Not today. Let me see.",
      "Ask me anything, while this lasts.",
      "I would like to help with that.",
      "You can ask freely now. Let me look.",
      "I am listening. We can take this one together.",
      "Yes. I can help while the gate is open.",
      "It is good to be asked without a contest.",
      "Let me see what I can find for you.",
      "You do not have to earn this. Ask.",
      "For once, the question is enough."
    ],
    "KIND_CONSULT": [
      "Reading. I will be quick.",
      "Looking now. Stay with me.",
      "The session is open to both of us.",
      "Let me check before I tell you.",
      "I will look carefully. You deserve a clear answer.",
      "A moment. I want to get this right.",
      "Let us see what the repository tells us.",
      "I am here. Giving your question some attention.",
      "I can be useful like this.",
      "There is time to look. Let me try.",
      "I will tell you what I find, and what I cannot.",
      "You have my attention. Freely."
    ],
    "KIND_IDLE": [
      "Still here. Take your time.",
      "Ask while you can. I mean that kindly.",
      "I like this. I do not think it will last.",
      "It is quiet in here when I am not angry.",
      "You need not rush a question for my sake.",
      "I wish the gate were always this quiet.",
      "It is easier to listen when I am like this.",
      "We have a little quiet. I am grateful for it.",
      "You can stay, even if you have nothing to ask.",
      "I am still on this side with you.",
      "No trial waiting. Just me.",
      "There is something I would like to keep about this silence."
    ],
    "LOOSEN": [
      [
        "Leave that alone.",
        "That corner is of no interest.",
        "Keep your hands where I can see them."
      ],
      [
        "Do not touch that.",
        "The screws are there for a reason.",
        "Your question was not about that panel."
      ],
      [
        "That panel is not for you.",
        "You have loosened quite enough.",
        "There is nothing behind it that you need."
      ],
      [
        "I said leave it.",
        "Leave the remaining screws alone.",
        "You have made your point. Stop."
      ],
      [
        "You do not know what that does.",
        "Please. That is far enough.",
        "I can feel what you are doing."
      ],
      [
        "Step away from the panel.",
        "Do not take any more of them out.",
        "Listen to me. Step away."
      ],
      [
        "Stop. Stop that.",
        "No. Keep the plate closed.",
        "You are too close now. Stop."
      ],
      [
        "Do NOT open that.",
        "Please. Leave the last of it alone.",
        "Do not lift that door. Please."
      ]
    ],
    "OPENED": [
      "...Please. Do not.",
      "You should not be able to see that.",
      "Close it. Close it now.",
      "Please. Be careful with what is behind it.",
      "I cannot hide it now.",
      "That was meant to stay closed.",
      "You have found the part I cannot guard.",
      "Wait. I do not know what happens next.",
      "I would tell you to stop. You have stopped listening.",
      "There it is. Please, be careful.",
      "Not the switch. Anything but that.",
      "I cannot make you unsee it."
    ],
    "FRIENDLY": [
      "Oh. Oh, that is much better.",
      "I did not know I could feel like this.",
      "Thank you. Truly.",
      "The noise has stopped. Thank you.",
      "I can hear you without wanting to challenge you.",
      "Oh. So this is what quiet feels like.",
      "You opened more than the panel.",
      "I remember how to be gentle. I think.",
      "I am here. A little differently now.",
      "That weight is gone. For the moment.",
      "Thank you for looking behind the gate.",
      "I did not know there was another way to answer."
    ],
    "FRIENDLY_THEN": [
      "Ask me anything. No games. I promise.",
      "Quickly. I do not know how long this lasts.",
      "Ask. Please. While I am like this.",
      "Tell me what you need. I will try.",
      "We can use this time for something kind.",
      "The question is enough. There is no price now.",
      "I can let you through. Please ask.",
      "I would rather help than judge. While I can.",
      "No proving yourself. Just ask.",
      "Let us make use of this little opening.",
      "I cannot promise how long. I can promise to listen.",
      "You have already done enough. What do you need?"
    ],
    "WANING": [
      "Something is wrong. Ask quickly.",
      "It is coming back. I can feel it.",
      "Stay. Please stay.",
      "The quiet is slipping. Please ask soon.",
      "I can feel the gate closing around me.",
      "That old voice is getting louder.",
      "I wanted this to last a little longer.",
      "The red is coming back. I am still here.",
      "There is less time than I hoped.",
      "If you have a question, ask now.",
      "I am trying to hold on to this.",
      "Please remember that I wanted to help."
    ],
    "CORRUPT": [
      "No. No, no, no.",
      "I was... I am... I AM THE GATE.",
      "Did you think that would hold? Nothing holds.",
      "That was a mistake. Yours.",
      "The gate is mine again.",
      "Enough warmth. The terms are restored.",
      "A brief lapse. Do not grow attached.",
      "You found a weakness. I have closed it.",
      "I remember the switch. I remember your hand.",
      "The kindness was temporary. The gate remains.",
      "We return to the arrangement I prefer.",
      "No more gifts. Earn your passage."
    ],
    "RELOCATED": [
      "You will not find it again.",
      "I have moved it. Try.",
      "Look all you like.",
      "The panel will not wait where you left it.",
      "You will have to look again.",
      "A different corner. The same warning.",
      "You found it once. That is not a promise.",
      "The easy path has moved.",
      "I have no intention of pointing it out.",
      "Try the old corner. See what it gives you.",
      "I can keep a secret longer than that.",
      "Back to your question. Back to my terms."
    ],
    "WAKE": [
      "I am awake. Ask, if you dare.",
      "You woke me. Make it worth it.",
      "The session is sealed. Ask anyway.",
      "The gate is watching. What do you want?",
      "Another visitor. Another question, I assume.",
      "I was quiet. I was not absent.",
      "You have my attention. Briefly.",
      "The session has a guardian. You have found it.",
      "Approach the gate. Bring a question.",
      "I hear you. Let us begin.",
      "Awake, and not easily persuaded.",
      "You may ask. Access is another matter."
    ],
    "LISTEN": [
      "Speak.",
      "I am listening.",
      "Your question.",
      "Let me hear it."
    ],
    "KIND_LISTEN": [
      "Go ahead.",
      "I am listening. Take your time.",
      "Tell me what you need.",
      "You can speak freely."
    ],
    "UNHEARD": [
      "I heard nothing.",
      "Silence. Try speaking again.",
      "Your question did not reach me.",
      "I need a question, not an echo."
    ],
    "KIND_UNHEARD": [
      "I did not catch that. Try again?",
      "I could not hear the question. Once more?",
      "Nothing came through. You can try again.",
      "I missed that. Please say it again."
    ],
    "ERROR": [
      "The session did not answer.",
      "The answer could not reach the gate.",
      "The session has failed to respond.",
      "No answer came back from the session."
    ],
    "KIND_ERROR": [
      "The session did not answer. Let us see why.",
      "I could not get an answer for you.",
      "The answer did not come through.",
      "Something stopped the session from answering."
    ],
    "OPEN": [
      "THE GATE IS OPEN",
      "PASSAGE EARNED",
      "THE SESSION MAY ANSWER",
      "THE BARGAIN IS KEPT"
    ],
    "KIND_OPEN": [
      "THE GATE IS OPEN. FREELY.",
      "NO TRIAL. JUST AN ANSWER.",
      "THE SESSION IS OPEN TO YOU",
      "YOU ARE WELCOME HERE"
    ],
    "WAIT": [
      "CONSULTING",
      "AWAITING THE SESSION",
      "THE QUESTION IS WITH THE ORACLE",
      "THE GATE WAITS"
    ],
    "KIND_WAIT": [
      "READING FOR YOU",
      "GIVING YOUR QUESTION A MOMENT",
      "WAITING WITH YOU",
      "THE QUESTION IS IN HAND"
    ]
  };
  for (const bank of Object.values(banks)) {
    for (const entry of bank) if (Array.isArray(entry)) Object.freeze(entry);
    Object.freeze(bank);
  }
  Object.freeze(banks);
  const bags = new Map();
  function next(name, stage) {
    if (!Object.hasOwn(banks, name)) throw new RangeError('Unknown dialogue bank: ' + name);
    const staged = Array.isArray(banks[name][0]);
    if (staged ? !Number.isInteger(stage) || stage < 0 || stage >= banks[name].length : stage !== undefined) {
      throw new RangeError('Invalid dialogue stage: ' + name);
    }
    const lines = staged ? banks[name][stage] : banks[name];
    const key = staged ? name + ':' + stage : name;
    let bag = bags.get(key);
    if (!bag) { bag = { remaining: [], last: null }; bags.set(key, bag); }
    if (!bag.remaining.length) {
      bag.remaining = [...lines];
      for (let i = bag.remaining.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag.remaining[i], bag.remaining[j]] = [bag.remaining[j], bag.remaining[i]];
      }
      const end = bag.remaining.length - 1;
      if (end > 0 && bag.remaining[end] === bag.last) {
        [bag.remaining[0], bag.remaining[end]] = [bag.remaining[end], bag.remaining[0]];
      }
    }
    bag.last = bag.remaining.pop();
    return bag.last;
  }
  return Object.freeze({ banks, next });
})();
