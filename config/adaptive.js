// ══════════════════════════════════════════════════════════════
// ADAPTIVE DIFFICULTY ENGINE — ELO-Inspired Rating System
// ══════════════════════════════════════════════════════════════
// Instead of 4 buckets, this uses a continuous 0-100 difficulty spectrum
// that adjusts like a chess ELO rating based on answer performance.

class AdaptiveDifficultyEngine {
  constructor() {
    this.rating = 50; // Start at midpoint (0-100 scale)
    this.history = [];
    this.kFactor = 12; // How much each answer shifts difficulty (higher = more reactive)
    this.momentum = 0; // Tracks consecutive direction to detect streaks
    this.peakRating = 50;
    this.valleyRating = 50;
  }

  /**
   * Update difficulty based on answer quality
   * @param {number} answerScore - 0 to 100, how well they answered
   * @param {string} questionType - 'dsa', 'system_design', 'behavioral', 'core_cs'
   * @param {number} responseTimeMs - How long they took to answer
   */
  updateRating(answerScore, questionType = 'general', responseTimeMs = 15000) {
    // Weight by question type (technical answers matter more for difficulty scaling)
    const typeWeight = {
      'dsa': 1.4,
      'system_design': 1.3,
      'core_cs': 1.2,
      'behavioral': 0.8,
      'general': 1.0
    }[questionType] || 1.0;

    // Time bonus — fast good answers mean higher skill
    const timeFactor = responseTimeMs < 10000 ? 1.15 :
                       responseTimeMs < 20000 ? 1.0 :
                       responseTimeMs < 40000 ? 0.9 : 0.8;

    // Calculate expected vs actual performance
    const expected = this.rating / 100; // What we expect them to score at this difficulty
    const actual = (answerScore / 100) * typeWeight * timeFactor;

    // ELO-style update
    const delta = this.kFactor * (actual - expected);
    const oldRating = this.rating;
    this.rating = Math.max(5, Math.min(98, this.rating + delta));

    // Momentum tracking for streak detection
    if (delta > 0) {
      this.momentum = Math.min(5, this.momentum + 1);
    } else {
      this.momentum = Math.max(-5, this.momentum - 1);
    }

    // Streak amplification — if they're on a roll, accelerate harder
    if (this.momentum >= 3) {
      this.rating = Math.min(98, this.rating + 2); // Extra push for hot streaks
    } else if (this.momentum <= -3) {
      this.rating = Math.max(5, this.rating - 2); // Extra cushion for cold streaks
    }

    // Track peaks and valleys
    if (this.rating > this.peakRating) this.peakRating = this.rating;
    if (this.rating < this.valleyRating) this.valleyRating = this.rating;

    this.history.push({
      answerScore,
      questionType,
      responseTimeMs,
      oldRating,
      newRating: this.rating,
      delta: this.rating - oldRating,
      timestamp: Date.now()
    });

    return this;
  }

  // Get the current difficulty tier (human-readable)
  getTier() {
    if (this.rating >= 85) return 'principal_engineer';
    if (this.rating >= 70) return 'senior';
    if (this.rating >= 55) return 'mid_level';
    if (this.rating >= 35) return 'junior';
    if (this.rating >= 18) return 'entry_level';
    return 'foundational';
  }

  // Get AI behavior instructions based on current difficulty
  getAIBehaviorInstructions() {
    const tier = this.getTier();
    const r = Math.round(this.rating);
    const streak = this.momentum;

    const instructions = {
      'principal_engineer': `
DIFFICULTY: PRINCIPAL ENGINEER LEVEL (${r}/100)
The candidate is EXCEPTIONAL. This is a top-percentile performer.
→ Ask questions that would challenge a Staff/Principal engineer
→ Push for novel algorithmic approaches, not textbook answers
→ Ask about trade-offs at massive scale (billions of records, petabyte storage)
→ Challenge every assumption: "But what if your cache goes down?" "What about partition tolerance?"
→ Demand optimal solutions — reject O(n²) outright
→ Use phrases like: "That's good, but at Google scale, that breaks. What's your Plan B?"
→ Be intellectually intense but respectful — you're evaluating a potential peer
${streak >= 3 ? '→ STREAK DETECTED: They are on fire. Ask something truly novel.' : ''}`,

      'senior': `
DIFFICULTY: SENIOR LEVEL (${r}/100)
The candidate is performing WELL above average.
→ Ask advanced follow-ups: edge cases, concurrency issues, race conditions
→ Don't accept first answers — push for depth: "What about the failure mode?"
→ Ask them to compare approaches: "Why not use X instead of Y?"
→ System design: expect them to discuss consistency models, replication strategies
→ DSA: expect optimal time complexity with clean implementations
→ Use phrases like: "Solid — but let's see if you've thought about this edge case..."
${streak >= 3 ? '→ STREAK: Push into principal-level territory on next question.' : ''}`,

      'mid_level': `
DIFFICULTY: INTERMEDIATE LEVEL (${r}/100)
The candidate is performing at expected levels for a standard hire.
→ Ask standard interview questions with reasonable depth expectations
→ Accept correct but not optimal solutions — then ask "Can you do better?"
→ If they give a brute force solution, guide them toward optimization
→ Test for understanding, not just memorization
→ Use phrases like: "Good foundation — now how would you optimize that?"`,

      'junior': `
DIFFICULTY: DEVELOPMENT LEVEL (${r}/100)
The candidate is struggling on some areas.
→ Simplify your questions slightly — but don't make it obvious
→ If they're stuck, offer a small hint: "Think about what data structure naturally handles FIFO..."
→ Break complex questions into smaller steps
→ Be encouraging when they get something right: "Good, that's the right instinct"
→ Use phrases like: "Let's approach this step by step..." or "What's the simplest case you can think of?"
${streak <= -3 ? '→ COLD STREAK: They need confidence. Give an easier question next.' : ''}`,

      'entry_level': `
DIFFICULTY: FOUNDATIONAL LEVEL (${r}/100)
The candidate needs support but keep the assessment fair.
→ Ask fundamentals: basic data structures, simple algorithms, core concepts
→ If they can't solve something, walk through the first step with them
→ Accept partial correct answers and acknowledge what they got right
→ Focus on fundamentals: "What's the difference between a stack and a queue?"
→ Be patient and encouraging — they may be nervous
→ Use phrases like: "No worries, let's try a simpler version of this..."`,

      'foundational': `
DIFFICULTY: BASIC REVIEW (${r}/100)
The candidate is significantly struggling.
→ Focus purely on conceptual understanding, not implementation
→ Ask definitional questions: "Can you explain what recursion is in your own words?"
→ Be very patient and supportive
→ If they show any sign of understanding, praise it
→ Use phrases like: "That's a good start — let's build on that understanding..."`,
    };

    return instructions[tier] || instructions['mid_level'];
  }

  // Get question complexity instructions for AI prompt
  getQuestionComplexity() {
    const r = this.rating;
    if (r >= 85) return 'Ask HARD LeetCode level or above. Segment trees, advanced DP, graph algorithms, distributed system challenges.';
    if (r >= 70) return 'Ask MEDIUM-HARD LeetCode. Advanced graphs, heaps, complex DP, system design with scale requirements.';
    if (r >= 55) return 'Ask MEDIUM LeetCode. Trees, hashmaps, two pointers, sliding window, basic system design.';
    if (r >= 35) return 'Ask EASY-MEDIUM LeetCode. Arrays, strings, linked lists, basic trees, sorting algorithms.';
    if (r >= 18) return 'Ask EASY LeetCode. Basic array operations, string manipulation, simple searching/sorting.';
    return 'Ask conceptual questions. Definitions, basic understanding of data structures, simple logic.';
  }

  // Serialize for session storage
  toJSON() {
    return {
      rating: this.rating,
      history: this.history,
      momentum: this.momentum,
      peakRating: this.peakRating,
      valleyRating: this.valleyRating,
      tier: this.getTier()
    };
  }

  // Restore from serialized data
  static fromJSON(data) {
    const engine = new AdaptiveDifficultyEngine();
    if (data) {
      engine.rating = data.rating || 50;
      engine.history = data.history || [];
      engine.momentum = data.momentum || 0;
      engine.peakRating = data.peakRating || 50;
      engine.valleyRating = data.valleyRating || 50;
    }
    return engine;
  }
}

module.exports = { AdaptiveDifficultyEngine };
