import { mkdir, writeFile } from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

const feeds = [
  {
    id: "ross-douthat",
    author: "Ross Douthat",
    outlet: "The New York Times",
    type: "Colunas",
    url: "https://www.nytimes.com/svc/collections/v1/publish/www.nytimes.com/column/ross-douthat/rss.xml"
  },
  {
    id: "jamelle-bouie",
    author: "Jamelle Bouie",
    outlet: "The New York Times",
    type: "Colunas",
    url: "https://www.nytimes.com/svc/collections/v1/publish/www.nytimes.com/by/jamelle-bouie/rss.xml"
  },
  {
    id: "david-french",
    author: "David French",
    outlet: "The New York Times",
    type: "Colunas",
    url: "https://www.nytimes.com/svc/collections/v1/publish/www.nytimes.com/by/david-french/rss.xml"
  },
  {
    id: "ezra-klein",
    author: "Ezra Klein",
    outlet: "The New York Times",
    type: "Colunas",
    url: "https://www.nytimes.com/svc/collections/v1/publish/www.nytimes.com/by/ezra-klein/rss.xml"
  },
  {
    id: "adam-tooze",
    author: "Adam Tooze",
    outlet: "Chartbook",
    type: "Blog",
    url: "https://adamtooze.substack.com/feed",
    proxyUrl: "https://cors.eu.org/https://adamtooze.substack.com/feed",
    readerUrl: "https://r.jina.ai/http://r.jina.ai/http://https://adamtooze.substack.com/feed",
    fallbackUrl: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fadamtooze.substack.com%2Ffeed"
  },
  {
    id: "john-ganz",
    author: "John Ganz",
    outlet: "Unpopular Front",
    type: "Blog",
    url: "https://www.unpopularfront.news/feed",
    proxyUrl: "https://cors.eu.org/https://www.unpopularfront.news/feed",
    readerUrl: "https://r.jina.ai/http://r.jina.ai/http://https://www.unpopularfront.news/feed"
  },
  {
    id: "nick-catoggio",
    author: "Nick Catoggio",
    outlet: "The Dispatch",
    type: "Colunas",
    url: "https://thedispatch.com/author/nick-catoggio/feed/"
  },
  {
    id: "max-read",
    author: "Max Read",
    outlet: "Read Max",
    type: "Blog",
    url: "https://maxread.substack.com/feed",
    proxyUrl: "https://cors.eu.org/https://maxread.substack.com/feed",
    readerUrl: "https://r.jina.ai/http://r.jina.ai/http://https://maxread.substack.com/feed",
    fallbackUrl: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fmaxread.substack.com%2Ffeed"
  },
  {
    id: "derek-thompson-substack",
    author: "Derek Thompson",
    outlet: "Read Derek",
    type: "Blog",
    url: "https://www.derekthompson.org/feed",
    proxyUrl: "https://cors.eu.org/https://www.derekthompson.org/feed",
    readerUrl: "https://r.jina.ai/http://r.jina.ai/http://https://www.derekthompson.org/feed",
    fallbackUrl: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fwww.derekthompson.org%2Ffeed"
  },
  {
    id: "derek-thompson-atlantic",
    author: "Derek Thompson",
    outlet: "The Atlantic",
    type: "Artigos",
    url: "https://www.theatlantic.com/author/derek-thompson/",
    readerUrl: "https://r.jina.ai/http://r.jina.ai/http://https://www.theatlantic.com/author/derek-thompson/",
    parser: "atlanticAuthor"
  }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  htmlEntities: true
});

const settled = await Promise.allSettled(feeds.map(fetchFeed));
const posts = [];
const errors = [];

settled.forEach((result, index) => {
  if (result.status === "fulfilled") {
    posts.push(...result.value);
  } else {
    errors.push({
      source: feeds[index].author,
      message: result.reason?.message || "Nao foi possivel carregar o feed."
    });
  }
});

posts.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

await mkdir("public/data", { recursive: true });
await writeFile(
  "public/data/posts.json",
  JSON.stringify(
    {
      fetchedAt: new Date().toISOString(),
      posts,
      errors
    },
    null,
    2
  )
);

console.log(`Generated public/data/posts.json with ${posts.length} posts.`);

async function fetchFeed(feed) {
  if (feed.parser === "atlanticAuthor") {
    return fetchAtlanticAuthorPosts(feed);
  }

  const response = await fetchFeedUrl(feed.url);

  if (!response.ok && feed.proxyUrl) {
    const proxyResponse = await fetchFeedUrl(feed.proxyUrl);
    if (proxyResponse.ok) {
      return parseXmlFeed(await proxyResponse.text(), feed);
    }
  }

  if (!response.ok && feed.readerUrl) {
    try {
      return await fetchReaderPosts(feed);
    } catch {
      // Fall through to the JSON fallback when available.
    }
  }

  if (!response.ok && feed.fallbackUrl) {
    const fallbackResponse = await fetchFeedUrl(feed.fallbackUrl);
    if (!fallbackResponse.ok) {
      throw new Error(`${response.status} ${response.statusText}; fallback ${fallbackResponse.status} ${fallbackResponse.statusText}`);
    }

    return normalizeRss2Json(await fallbackResponse.json(), feed);
  }

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const channel = parsed.rss?.channel || parsed.feed || {};
  const items = asArray(channel.item || channel.entry);

  return items.slice(0, 12).map((item) => normalizeItem(item, feed));
}

function parseXmlFeed(xml, feed) {
  const parsed = parser.parse(xml);
  const channel = parsed.rss?.channel || parsed.feed || {};
  const items = asArray(channel.item || channel.entry);
  return items.slice(0, 12).map((item) => normalizeItem(item, feed));
}

async function fetchReaderPosts(feed) {
  const response = await fetchFeedUrl(`${feed.readerUrl}?t=${Date.now()}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const markdown = (await response.text()).replaceAll("\\n", "\n");
  const shellPosts = parseReaderFeed(markdown).slice(0, 12);
  const hydrated = await Promise.all(
    shellPosts.map((post) => hydrateReaderPost(post, feed).catch(() => post))
  );

  return hydrated.map((post) => ({
    id: `${feed.id}-${post.link}`,
    author: feed.author,
    outlet: feed.outlet,
    type: feed.type,
    sourceId: feed.id,
    sourceUrl: feed.url,
    title: cleanText(post.title || titleFromUrl(post.link)),
    description: cleanText(post.description || ""),
    link: post.link,
    image: post.image || "",
    publishedAt: post.publishedAt
  }));
}

async function fetchAtlanticAuthorPosts(feed) {
  const response = await fetchFeedUrl(feed.readerUrl);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);

  const markdown = (await response.text()).replaceAll("\\n", "\n");
  const posts = [];
  const regex = /\d+\.\s+### \[([^\]]+)\]\((https:\/\/www\.theatlantic\.com\/[^)]+)\)\s+([\s\S]*?)\n\n\[Derek Thompson\]\([^)]*\)\s+([A-Z][a-z]+ \d{1,2}, \d{4})/g;
  let match;

  while ((match = regex.exec(markdown))) {
    const [, title, link, description, date] = match;
    posts.push({
      id: `${feed.id}-${link}`,
      author: feed.author,
      outlet: feed.outlet,
      type: feed.type,
      sourceId: feed.id,
      sourceUrl: feed.url,
      title: cleanText(title),
      description: cleanText(description),
      link,
      image: "",
      publishedAt: new Date(`${date} 12:00:00 UTC`).toISOString()
    });
  }

  if (!posts.length) throw new Error("Atlantic nao retornou artigos.");
  return posts.slice(0, 12);
}

function parseReaderFeed(markdown) {
  const posts = [];
  const regex = /\[https:\/\/[^\]]+\]\((https:\/\/[^)]+)\)\s+([A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} GMT)/g;
  let match;

  while ((match = regex.exec(markdown))) {
    posts.push({
      link: match[1],
      publishedAt: new Date(match[2]).toISOString()
    });
  }

  return posts;
}

async function hydrateReaderPost(post, feed) {
  const response = await fetchFeedUrl(`https://r.jina.ai/http://r.jina.ai/http://${post.link}`);
  if (!response.ok) return post;

  const markdown = await response.text();
  const title = markdown.match(/^Title:\s*(.+)$/m)?.[1]?.trim();
  const published = markdown.match(/^Published Time:\s*(.+)$/m)?.[1]?.trim();
  const description = firstUsefulParagraph(markdown, feed.author);

  return {
    ...post,
    title,
    image: "",
    description,
    publishedAt: published ? new Date(published).toISOString() : post.publishedAt
  };
}

function titleFromUrl(url) {
  const slug = url.split("/").filter(Boolean).pop() || "Sem titulo";
  return slug
    .replace(/-/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function firstUsefulParagraph(markdown, author) {
  const body = markdown.split("Markdown Content:")[1] || "";
  const paragraphs = body
    .split(/\n{2,}/)
    .map((item) => cleanText(item))
    .filter((item) => item && !item.startsWith("Image ") && !item.includes(author) && item.length > 40);

  return paragraphs[0] || "";
}

function fetchFeedUrl(url) {
  return fetch(url, {
    headers: {
      "user-agent": "FavoriteWritersReader/1.0 (+local personal RSS reader)",
      accept: "application/rss+xml, application/xml, text/xml, application/json"
    }
  });
}

function normalizeRss2Json(payload, feed) {
  if (payload.status !== "ok" || !Array.isArray(payload.items)) {
    throw new Error(payload.message || "Fallback RSS2JSON nao retornou posts.");
  }

  return payload.items.slice(0, 12).map((item) => ({
    id: `${feed.id}-${item.link || item.guid || item.title}`,
    author: feed.author,
    outlet: feed.outlet,
    type: feed.type,
    sourceId: feed.id,
    sourceUrl: feed.url,
    title: cleanText(item.title || "Sem titulo"),
    description: cleanText(item.description || item.content || ""),
    link: item.link || "",
    image: item.thumbnail || "",
    publishedAt: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
  }));
}

function normalizeItem(item, feed) {
  const rawDate = item.pubDate || item.published || item.updated || item["dc:date"];
  const publishedAt = rawDate ? new Date(rawDate).toISOString() : new Date().toISOString();
  const link = normalizeLink(item.link);
  const title = cleanText(item.title || "Sem titulo");
  const description = cleanText(
    item.description ||
      item.summary ||
      item["content:encoded"] ||
      item.content ||
      ""
  );
  const image = findImage(item);

  return {
    id: `${feed.id}-${link || title}`,
    author: feed.author,
    outlet: feed.outlet,
    type: feed.type,
    sourceId: feed.id,
    sourceUrl: feed.url,
    title,
    description,
    link,
    image,
    publishedAt
  };
}

function asArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizeLink(link) {
  if (!link) return "";
  if (typeof link === "string") return link;
  if (Array.isArray(link)) {
    const alternate = link.find((entry) => entry.rel === "alternate") || link[0];
    return normalizeLink(alternate);
  }
  return link.href || link["#text"] || "";
}

function findImage(item) {
  const mediaContent = item["media:content"];
  if (mediaContent?.url) return mediaContent.url;
  const mediaThumbnail = item["media:thumbnail"];
  if (mediaThumbnail?.url) return mediaThumbnail.url;
  const enclosure = item.enclosure;
  if (enclosure?.type?.startsWith("image/") && enclosure.url) return enclosure.url;
  return "";
}

function cleanText(value) {
  const text = typeof value === "string" ? value : value?.["#text"] || "";
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}
