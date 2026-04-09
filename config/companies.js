// ══════════════════════════════════════════════════════════════
// COMPANY PROFILES — Centralized Configuration
// ══════════════════════════════════════════════════════════════

const COMPANY_PROFILES = {
    TCS: {
        interviewer_tech: 'Amara, Technical Architect at TCS',
        interviewer_hr: 'Amara, Executive AI Talent Architect at TCS',
        difficulty: 'medium',
        dsa_topics: ['arrays', 'strings', 'linked lists', 'stacks/queues', 'searching/sorting', 'basic trees'],
        system_design_level: 'basic',
        system_design_topics: ['design a global bank backend', 'retail management system', 'TCS iON scaling infrastructure'],
        core_subjects: ['DBMS', 'OOPS', 'CN', 'Software Engineering'],
        job_role_questions: ['How do you handle a client-side disagreement?', 'Describe your approach to learning legacy systems.'],
        values: 'Integrity (TCS Way), Excellence, Responsibility, Respect for the Community, Customer First, Long-term Resonance',
        hr_pillars: ['Ethical Scaling', 'Client Resilience', 'Cultural Friction', 'First-Principles Logic', 'Legacy Continuity']
    },
    Microsoft: {
        interviewer_tech: 'Amara, Senior SDE-2 at Microsoft',
        interviewer_hr: 'Amara, University Recruiter at Microsoft',
        difficulty: 'hard',
        dsa_topics: ['trees and binary search trees', 'graphs (BFS/DFS)', 'dynamic programming', 'sliding window', 'two pointers', 'recursion and backtracking'],
        system_design_level: 'intermediate',
        system_design_topics: ['design a notification service', 'design a collaborative document editor like Google Docs', 'design a rate limiter', 'design a cache system with LRU eviction'],
        core_subjects: ['OS (concurrency, threading, locks, semaphores)', 'DBMS (ACID properties, transactions, indexing strategies)', 'Computer Networks (load balancers, CDNs, WebSockets)', 'System design fundamentals (CAP theorem, consistency)'],
        job_role_questions: ['How would you design a feature from scratch with no clear requirements?', 'How do you handle technical disagreements with senior engineers?', 'Tell me about a time you refactored code for scalability.'],
        values: 'growth mindset, problem solving, optimization, system thinking',
        hr_pillars: ['Ownership Integrity', 'Frugal Innovation', 'Operational Excellence']
    },
    Amazon: {
        interviewer_tech: 'Amara, Principal SDE at Amazon',
        interviewer_hr: 'Amara, Senior Leadership Recruiter at Amazon',
        difficulty: 'hard',
        dsa_topics: ['kadane', 'lca', 'union find', 'heaps', 'dp', 'binary search'],
        system_design_level: 'intermediate',
        system_design_topics: ['Amazon cart system', 'distributed scheduler', 'last-mile delivery tracking'],
        core_subjects: ['Distributed systems', 'CAP theorem', 'Sharding/Replication', 'Microservices'],
        values: 'Customer Obsession, Ownership, Invent and Simplify, Bias for Action',
        hr_pillars: ['Ownership Integrity', 'Frugal Innovation', 'Operational Excellence']
    },
    Google: {
        interviewer_tech: 'Amara, L6 Staff Engineer at Google',
        interviewer_hr: 'Amara, Googliness & Leadership Specialist',
        difficulty: 'very hard',
        dsa_topics: ['segment trees', 'dijkstra', 'trie', 'complex dp', 'bit manipulation'],
        system_design_level: 'advanced',
        system_design_topics: ['Design Google Search', 'Design highly available K-V store', 'Design Spanner-like DB'],
        values: 'Googliness, Proactive Problem Solving, Empathy for Users, Technical Humility, Impact at Scale',
        hr_pillars: ['Systemic Empathy', 'Technical Humility', 'Ambiguity Tolerance', 'Googliness (Cultural DNA)']
    }
};

// ── AMAZON 16 LEADERSHIP PRINCIPLES ──
const AMAZON_LPS = [
  'Customer Obsession', 'Ownership', 'Invent and Simplify', 'Are Right, A Lot',
  'Learn and Be Curious', 'Hire and Develop the Best', 'Insist on the Highest Standards',
  'Think Big', 'Bias for Action', 'Frugality', 'Earn Trust', 'Dive Deep',
  'Have Backbone; Disagree and Commit', 'Deliver Results', 'Strive to be Earth\'s Best Employer',
  'Success and Scale Bring Broad Responsibility'
];

// ── DOMAIN DETECTION ENGINE ──
function detectDomain(resumeData) {
  const skills = (resumeData.skills || []).join(' ').toLowerCase();
  const projects = (resumeData.projects || []).map(p => (p.name + ' ' + p.description + ' ' + (p.tech || []).join(' '))).join(' ').toLowerCase();
  const all = skills + ' ' + projects + ' ' + (resumeData.domain || '').toLowerCase() + ' ' + (resumeData.degree || '').toLowerCase();

  const domainSignals = {
    'software_engineering': ['react', 'node', 'python', 'java', 'javascript', 'api', 'backend', 'frontend', 'fullstack', 'devops', 'kubernetes', 'docker', 'aws', 'cloud', 'microservices', 'sql', 'mongodb', 'git', 'ci/cd', 'rest', 'graphql', 'typescript'],
    'data_science': ['machine learning', 'deep learning', 'tensorflow', 'pytorch', 'pandas', 'numpy', 'nlp', 'computer vision', 'data analysis', 'statistics', 'regression', 'neural network', 'scikit', 'jupyter', 'r programming', 'bigquery', 'hadoop', 'spark'],
    'product_management': ['product', 'roadmap', 'stakeholder', 'agile', 'scrum', 'user story', 'jira', 'sprint', 'a/b testing', 'pricing', 'go-to-market', 'competitive analysis', 'okr', 'kpi', 'mvp', 'prd'],
    'marketing': ['marketing', 'seo', 'sem', 'content', 'social media', 'branding', 'campaign', 'analytics', 'google ads', 'facebook ads', 'copywriting', 'crm', 'hubspot', 'mailchimp', 'growth hacking', 'engagement'],
    'finance': ['finance', 'accounting', 'excel', 'valuation', 'dcf', 'financial modeling', 'investment', 'banking', 'audit', 'risk', 'compliance', 'tally', 'sap', 'quickbooks', 'tax', 'portfolio', 'equity'],
    'design': ['figma', 'sketch', 'adobe', 'ui/ux', 'user research', 'wireframe', 'prototype', 'design system', 'typography', 'illustrator', 'photoshop', 'interaction design', 'usability', 'accessibility'],
    'healthcare': ['healthcare', 'medical', 'clinical', 'patient', 'diagnosis', 'pharma', 'biotech', 'nursing', 'hospital', 'health informatics', 'ehr', 'fhir', 'hipaa', 'telemedicine'],
    'mechanical': ['cad', 'solidworks', 'autocad', 'ansys', 'thermodynamics', 'manufacturing', 'cnc', 'mechanical', 'fluid dynamics', 'fea', 'matlab', 'robotics', '3d printing'],
    'civil': ['civil', 'structural', 'construction', 'surveying', 'autocad', 'staad', 'concrete', 'geotechnical', 'transportation', 'urban planning'],
    'electrical': ['electrical', 'embedded', 'iot', 'arduino', 'raspberry pi', 'pcb', 'vlsi', 'verilog', 'vhdl', 'power systems', 'control systems', 'plc', 'scada', 'circuit'],
    'human_resources': ['hr', 'recruitment', 'talent acquisition', 'onboarding', 'employee engagement', 'performance management', 'human resources', 'succession planning', 'hris', 'workday'],
    'sales': ['sales', 'business development', 'lead generation', 'pipeline', 'cold calling', 'negotiation', 'salesforce', 'crm', 'account management', 'revenue', 'quota']
  };

  let bestDomain = 'general';
  let bestScore = 0;
  for (const [domain, keywords] of Object.entries(domainSignals)) {
    const score = keywords.filter(k => all.includes(k)).length;
    if (score > bestScore) { bestScore = score; bestDomain = domain; }
  }
  return bestDomain;
}

// ── DOMAIN-SPECIFIC HR QUESTION BANK ──
function getDomainHRContext(domain) {
  const banks = {
    'software_engineering': {
      label: 'Software Engineering',
      scenarios: [
        'A critical production bug was found by a client at 2 AM. Walk me through exactly what you would do.',
        'Your team lead wants to use a technology you believe is wrong for the project. How do you handle this?',
        'You committed code that broke the build for the entire team. Nobody has noticed yet. What do you do?',
        'A junior developer on your team keeps pushing buggy code despite reviews. How do you address this?',
        'Your sprint deadline is in 2 days and you realize the feature needs 5 more days. What now?'
      ],
      guesstimates: [
        'How many software engineers does India need in the next 5 years?',
        'Estimate the number of API calls Google Maps handles per day.',
        'How much data does YouTube generate per minute?',
        'Estimate the cost of running WhatsApp for one day.'
      ]
    },
    'data_science': {
      label: 'Data Science & AI',
      scenarios: [
        'Your ML model achieves 95% accuracy in testing but performs poorly in production. What happened?',
        'The business team wants you to build a model that predicts customer churn, but the data is heavily biased. How do you proceed?',
        'Your model could potentially discriminate against certain demographics. The business says ship it anyway. What do you do?',
        'You discover that a competitor released a better model. Your management wants you to reverse-engineer it. Your thoughts?',
        'A stakeholder insists on using a specific algorithm you know is wrong for the problem. How do you convince them?'
      ],
      guesstimates: [
        'How many data points does Netflix use per user to recommend a movie?',
        'Estimate the total petabytes of data generated by Indian banks per year.',
        'How many self-driving car accidents happen per million miles driven?',
        'Estimate the cost of training GPT-4.'
      ]
    },
    'product_management': {
      label: 'Product Management',
      scenarios: [
        'Two equally important features are competing for the same sprint. The CEO wants Feature A, users want Feature B. What do you do?',
        'Your product just launched and the first 100 reviews are brutal. How do you respond?',
        'An engineer tells you a critical feature will take 3x longer than estimated. The launch is fixed. What now?',
        'Your competitor just launched the exact feature you have been building for 6 months. What is your strategy?',
        'A key stakeholder keeps changing requirements mid-sprint. How do you handle this?'
      ],
      guesstimates: [
        'How would you estimate the number of Uber rides in Delhi on a weekday?',
        'Estimate the revenue of Zomato Gold in Bangalore.',
        'How many WhatsApp messages are sent in India per day?',
        'Estimate the TAM for AI-powered interview prep tools in India.'
      ]
    },
    'general': {
      label: 'General Professional',
      scenarios: [
        'Tell me about a time you had to deliver bad news to your team or a stakeholder.',
        'Describe a situation where you had to work with someone you fundamentally disagreed with.',
        'Tell me about the hardest professional decision you have ever made.',
        'Describe a time you failed at something important. What did you learn?',
        'Tell me about a situation where you had to go above and beyond your role.'
      ],
      guesstimates: [
        'How many working professionals are there in Mumbai?',
        'Estimate the number of job interviews that happen in India per day.',
        'How many office buildings are there in Bangalore?',
        'Estimate the average commute time for corporate employees in Delhi NCR.'
      ]
    }
  };
  return banks[domain] || banks['general'];
}

module.exports = {
  COMPANY_PROFILES,
  AMAZON_LPS,
  detectDomain,
  getDomainHRContext
};
