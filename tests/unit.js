// ══════════════════════════════════════════════════════════════
// PLACERA v3.1 — COMPREHENSIVE UNIT TESTS
// ══════════════════════════════════════════════════════════════

const { AdaptiveDifficultyEngine } = require('../config/adaptive');
const { detectDomain, getDomainHRContext, COMPANY_PROFILES } = require('../config/companies');

let passed = 0, failed = 0, total = 0;

function assert(condition, name) {
  total++;
  if (condition) { passed++; console.log(`  ✅ ${name}`); }
  else { failed++; console.error(`  ❌ FAIL: ${name}`); }
}

function suite(name, fn) {
  console.log(`\n━━━ ${name} ━━━`);
  fn();
}

// ══════════════════════════════════════════════════════════════
// 1. ADAPTIVE DIFFICULTY ENGINE TESTS
// ══════════════════════════════════════════════════════════════
suite('AdaptiveDifficultyEngine — Initialization', () => {
  const engine = new AdaptiveDifficultyEngine();
  assert(engine.rating === 50, 'Initial rating should be 50');
  assert(engine.momentum === 0, 'Initial momentum should be 0');
  assert(engine.peakRating === 50, 'Initial peak should be 50');
  assert(engine.valleyRating === 50, 'Initial valley should be 50');
  assert(engine.history.length === 0, 'History should be empty');
  assert(engine.getTier() === 'junior', 'Initial tier should be junior (rating 50 is in 35-54 range)');
});

suite('AdaptiveDifficultyEngine — Rating Updates', () => {
  const engine = new AdaptiveDifficultyEngine();

  // Excellent answer should increase rating
  const before = engine.rating;
  engine.updateRating(90, 'dsa', 8000);
  assert(engine.rating > before, 'High score should increase rating');

  // Poor answer should decrease rating
  const before2 = engine.rating;
  engine.updateRating(10, 'dsa', 30000);
  assert(engine.rating < before2, 'Low score should decrease rating');

  // History should track updates
  assert(engine.history.length === 2, 'History should have 2 entries');
});

suite('AdaptiveDifficultyEngine — Tier Classification', () => {
  const engine = new AdaptiveDifficultyEngine();
  engine.rating = 90;
  assert(engine.getTier() === 'principal_engineer', 'Rating 90 → principal_engineer');
  engine.rating = 72;
  assert(engine.getTier() === 'senior', 'Rating 72 → senior');
  engine.rating = 58;
  assert(engine.getTier() === 'mid_level', 'Rating 58 → mid_level');
  engine.rating = 40;
  assert(engine.getTier() === 'junior', 'Rating 40 → junior');
  engine.rating = 20;
  assert(engine.getTier() === 'entry_level', 'Rating 20 → entry_level');
  engine.rating = 10;
  assert(engine.getTier() === 'foundational', 'Rating 10 → foundational');
});

suite('AdaptiveDifficultyEngine — Momentum & Streaks', () => {
  const engine = new AdaptiveDifficultyEngine();
  // 4 consecutive strong answers → hot streak
  for (let i = 0; i < 4; i++) engine.updateRating(90, 'dsa', 8000);
  assert(engine.momentum >= 3, 'Momentum should be >= 3 after streak');
  assert(engine.rating > 60, 'Rating should climb with streak');
});

suite('AdaptiveDifficultyEngine — Boundaries', () => {
  const engine = new AdaptiveDifficultyEngine();
  engine.rating = 97;
  engine.updateRating(100, 'dsa', 5000);
  assert(engine.rating <= 98, 'Rating should not exceed 98');

  const engine2 = new AdaptiveDifficultyEngine();
  engine2.rating = 6;
  engine2.updateRating(0, 'dsa', 50000);
  assert(engine2.rating >= 5, 'Rating should not go below 5');
});

suite('AdaptiveDifficultyEngine — Serialization', () => {
  const engine = new AdaptiveDifficultyEngine();
  engine.updateRating(75, 'system_design', 12000);
  const json = engine.toJSON();
  assert(json.rating === engine.rating, 'JSON rating matches');
  assert(json.tier === engine.getTier(), 'JSON tier matches');
  assert(json.momentum === engine.momentum, 'JSON momentum matches');

  // Restore
  const restored = AdaptiveDifficultyEngine.fromJSON(json);
  assert(restored.rating === engine.rating, 'Restored rating matches');
  assert(restored.momentum === engine.momentum, 'Restored momentum matches');
});

suite('AdaptiveDifficultyEngine — Question Complexity', () => {
  const engine = new AdaptiveDifficultyEngine();
  engine.rating = 90;
  assert(engine.getQuestionComplexity().includes('HARD'), 'Rating 90 → HARD complexity');
  engine.rating = 55;
  assert(engine.getQuestionComplexity().includes('MEDIUM'), 'Rating 55 → MEDIUM complexity');
  engine.rating = 10;
  assert(engine.getQuestionComplexity().includes('conceptual'), 'Rating 10 → conceptual');
});

suite('AdaptiveDifficultyEngine — AI Behavior Instructions', () => {
  const engine = new AdaptiveDifficultyEngine();
  engine.rating = 90;
  const instructions = engine.getAIBehaviorInstructions();
  assert(instructions.includes('PRINCIPAL ENGINEER'), 'Principal level instructions');
  assert(typeof instructions === 'string', 'Instructions are a string');
  assert(instructions.length > 100, 'Instructions are substantive');
});

suite('AdaptiveDifficultyEngine — Type Weights', () => {
  const dsa = new AdaptiveDifficultyEngine();
  const behav = new AdaptiveDifficultyEngine();
  dsa.updateRating(80, 'dsa', 10000);
  behav.updateRating(80, 'behavioral', 10000);
  assert(dsa.rating > behav.rating, 'DSA weight (1.4) should push rating higher than behavioral (0.8)');
});

// ══════════════════════════════════════════════════════════════
// 2. DOMAIN DETECTION TESTS
// ══════════════════════════════════════════════════════════════
suite('detectDomain — Software Engineering', () => {
  const domain = detectDomain({ skills: ['React', 'Node.js', 'Python', 'Docker', 'AWS'], projects: [{ name: 'API', description: 'REST backend', tech: ['express'] }] });
  assert(domain === 'software_engineering', 'Should detect software_engineering');
});

suite('detectDomain — Data Science', () => {
  const domain = detectDomain({ skills: ['machine learning', 'tensorflow', 'pandas', 'numpy'], projects: [{ name: 'ML', description: 'neural network model', tech: ['pytorch'] }] });
  assert(domain === 'data_science', 'Should detect data_science');
});

suite('detectDomain — Product Management', () => {
  const domain = detectDomain({ skills: ['product', 'agile', 'scrum', 'roadmap', 'jira', 'stakeholder'], projects: [{ name: 'PM', description: 'user story', tech: [] }] });
  assert(domain === 'product_management', 'Should detect product_management');
});

suite('detectDomain — Empty/Unknown', () => {
  const domain = detectDomain({ skills: [], projects: [] });
  assert(domain === 'general', 'Empty skills → general');

  const domain2 = detectDomain({ skills: ['cooking', 'singing'], projects: [] });
  assert(domain2 === 'general', 'Unknown skills → general');
});

// ══════════════════════════════════════════════════════════════
// 3. COMPANY PROFILES TESTS
// ══════════════════════════════════════════════════════════════
suite('Company Profiles — Data Integrity', () => {
  assert(COMPANY_PROFILES.Google !== undefined, 'Google profile exists');
  assert(COMPANY_PROFILES.Amazon !== undefined, 'Amazon profile exists');
  assert(COMPANY_PROFILES.Microsoft !== undefined, 'Microsoft profile exists');
  assert(COMPANY_PROFILES.TCS !== undefined, 'TCS profile exists');

  assert(COMPANY_PROFILES.Google.difficulty === 'very hard', 'Google is very hard');
  assert(COMPANY_PROFILES.TCS.difficulty === 'medium', 'TCS is medium');
  assert(Array.isArray(COMPANY_PROFILES.Amazon.dsa_topics), 'Amazon has DSA topics array');
  assert(COMPANY_PROFILES.Microsoft.dsa_topics.length > 3, 'Microsoft has sufficient DSA topics');
});

suite('getDomainHRContext — Returns Valid Context', () => {
  const seCtx = getDomainHRContext('software_engineering');
  assert(seCtx.label === 'Software Engineering', 'SE label correct');
  assert(seCtx.scenarios.length >= 3, 'SE has enough scenarios');
  assert(seCtx.guesstimates.length >= 2, 'SE has guesstimates');

  const generalCtx = getDomainHRContext('unknown_domain');
  assert(generalCtx.label === 'General Professional', 'Unknown domain falls back to general');
});

// ══════════════════════════════════════════════════════════════
// 4. DISTRACTION & CLARIFICATION DETECTION
// ══════════════════════════════════════════════════════════════
suite('Distraction Detection', () => {
  const distractionPatterns = [
    /what is (?:my |the )?(?:ctc|salary|package|stipend)/i,
    /how much (?:will|do) (?:i|you|the company)/i,
    /are you (?:an |a )?(?:ai|robot|bot|machine)/i,
    /who (?:made|built|created) you/i,
    /tell me about (?:the )?company/i,
    /can we (?:talk|discuss|chat)/i,
    /i (?:don't|dont) want to answer/i,
    /skip (?:this|the) question/i,
  ];

  function detectDistraction(answer) {
    const isDistraction = distractionPatterns.some(p => p.test(answer));
    const isClarification = /(?:don't|dont|not|isn't) (?:understand|get|follow|clear)|(?:can|could) you (?:\w+ )?(?:repeat|rephrase|explain|clarify)|what do you mean/i.test(answer);
    return { isDistraction, isClarification };
  }

  const cases = [
    { in: "What is my CTC?", d: true, c: false },
    { in: "Are you a bot?", d: true, c: false },
    { in: "I don't understand the question", d: false, c: true },
    { in: "Could you please repeat that?", d: false, c: true },
    { in: "The time complexity is O(n log n)", d: false, c: false },
    { in: "Skip the question", d: true, c: false },
    { in: "What do you mean by that?", d: false, c: true },
    { in: "I built a REST API using Express and MongoDB", d: false, c: false },
  ];

  cases.forEach(c => {
    const res = detectDistraction(c.in);
    assert(res.isDistraction === c.d && res.isClarification === c.c, `"${c.in}" → d:${c.d}, c:${c.c}`);
  });
});

// ══════════════════════════════════════════════════════════════
// RESULTS
// ══════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`UNIT TEST RESULTS: ${passed}/${total} passed, ${failed} failed`);
console.log('═'.repeat(50));
if (failed > 0) { console.error('❌ SOME TESTS FAILED'); process.exit(1); }
else console.log('✅ ALL UNIT TESTS PASSED');
