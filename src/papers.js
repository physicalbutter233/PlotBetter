const { XMLParser } = require('fast-xml-parser');

const ARXIV_API = 'http://export.arxiv.org/api/query';

/** First paper(s) to push when a topic has no history yet. */
const TOPIC_STARTERS = {
  openvla: ['2406.09246'],
};

async function fetchArxivPapers(query, maxResults = 15) {
  const params = new URLSearchParams({
    search_query: `all:${query}`,
    start: '0',
    max_results: String(maxResults),
    sortBy: 'submittedDate',
    sortOrder: 'descending',
  });

  const res = await fetch(`${ARXIV_API}?${params}`);
  if (!res.ok) throw new Error(`arXiv request failed: ${res.status}`);
  const xml = await res.text();
  return parseArxivFeed(xml);
}

async function fetchArxivByIds(ids) {
  if (!ids.length) return [];
  const params = new URLSearchParams({
    id_list: ids.join(','),
  });
  const res = await fetch(`${ARXIV_API}?${params}`);
  if (!res.ok) throw new Error(`arXiv id_list request failed: ${res.status}`);
  const xml = await res.text();
  return parseArxivFeed(xml);
}

function parseArxivFeed(xml) {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  const doc = parser.parse(xml);
  const feed = doc.feed || {};
  let entries = feed.entry || [];
  if (!Array.isArray(entries)) entries = entries ? [entries] : [];

  return entries.map((entry) => {
    const idUrl = typeof entry.id === 'string' ? entry.id : '';
    const arxivId = idUrl.split('/abs/').pop() || idUrl.split('/').pop() || '';
    let authors = entry.author;
    if (authors && !Array.isArray(authors)) authors = [authors];
    const authorNames = (authors || [])
      .map((a) => (typeof a === 'object' ? a.name : a))
      .filter(Boolean)
      .join(', ');

    const summary = (entry.summary || '').replace(/\s+/g, ' ').trim();
    const title = (entry.title || '').replace(/\s+/g, ' ').trim();

    return {
      arxivId,
      title,
      authors: authorNames,
      abstract: summary,
      url: idUrl || `https://arxiv.org/abs/${arxivId}`,
      published: entry.published || '',
    };
  });
}

function getStarterArxivId(topicName, pushedIds) {
  if (pushedIds.length > 0) return null;
  const key = topicName.trim().toLowerCase().replace(/\s+/g, '');
  const starters = TOPIC_STARTERS[key];
  if (!starters || starters.length === 0) return null;
  return starters[0];
}

/**
 * Pick paper by topic level (1=intro/survey bias, 5=recent specific work).
 */
function scorePaperForLevel(paper, level) {
  const abstract = (paper.abstract || '').toLowerCase();
  const title = (paper.title || '').toLowerCase();
  let score = 0;

  const surveyWords = ['survey', 'review', 'overview', 'introduction', 'tutorial', 'primer'];
  const advancedWords = ['novel', 'state-of-the-art', 'benchmark', 'framework', 'architecture'];

  if (level <= 2) {
    for (const w of surveyWords) {
      if (abstract.includes(w) || title.includes(w)) score += 3;
    }
  } else if (level >= 4) {
    for (const w of advancedWords) {
      if (abstract.includes(w) || title.includes(w)) score += 2;
    }
    if (paper.published) score += 1;
  } else {
    score += 1;
  }

  return score;
}

async function recommendPaper(topicName, level, excludeIds = []) {
  const exclude = new Set(excludeIds.map((id) => id.toLowerCase()));

  const starterId = getStarterArxivId(topicName, excludeIds);
  if (starterId && !exclude.has(starterId.toLowerCase())) {
    const [paper] = await fetchArxivByIds([starterId]);
    if (paper) {
      paper.isStarter = true;
      return paper;
    }
  }

  const query = topicName.replace(/-/g, ' ');
  const candidates = await fetchArxivPapers(query, 20);

  const filtered = candidates.filter((p) => p.arxivId && !exclude.has(p.arxivId.toLowerCase()));
  if (filtered.length === 0) {
    throw new Error(`No new papers found for topic "${topicName}". Try a different @topic keyword.`);
  }

  filtered.sort((a, b) => scorePaperForLevel(b, level) - scorePaperForLevel(a, level));
  return filtered[0];
}

function buildPaperCard(paper, topicName, level) {
  const abstractShort =
    paper.abstract.length > 480 ? `${paper.abstract.slice(0, 477)}...` : paper.abstract;

  let whyRelevant;
  if (paper.isStarter) {
    whyRelevant = `Anchor paper for "${topicName}" (level ${level}/5). Start here before broader arXiv recommendations.`;
  } else {
    whyRelevant = `This paper matches your topic "${topicName}" at cognitive level ${level}/5. Selected by recency and alignment with your current phase.`;
  }

  return {
    ...paper,
    whyRelevant,
    takeaways: extractTakeaways(paper.abstract),
    displayAbstract: abstractShort,
  };
}

function extractTakeaways(abstract) {
  const sentences = abstract.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
  if (sentences.length >= 3) return sentences.slice(0, 3);
  const chunks = [];
  for (let i = 0; i < abstract.length && chunks.length < 3; i += 160) {
    chunks.push(abstract.slice(i, i + 160).trim() + (i + 160 < abstract.length ? '...' : ''));
  }
  return chunks.length ? chunks : [abstract.slice(0, 200)];
}

/** Parse arXiv ID from bare id or abs/pdf URL. Returns normalized id or null. */
function parseArxivId(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const bare = raw.match(/^(\d{4}\.\d{4,5})(v\d+)?$/i);
  if (bare) return bare[1];

  const fromUrl = raw.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i);
  if (fromUrl) return fromUrl[1];

  return null;
}

module.exports = {
  fetchArxivPapers,
  fetchArxivByIds,
  recommendPaper,
  buildPaperCard,
  parseArxivId,
  TOPIC_STARTERS,
};
