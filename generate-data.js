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
    id: "adam-tooze",
    author: "Adam Tooze",
    outlet: "Chartbook",
    type: "Blog",
    url: "https://adamtooze.substack.com/feed",
    fallbackUrl: "https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fadamtooze.substack.com%2Ffeed"
  },
  {
    id: "john-ganz",
    author: "John Ganz",
    outlet: "Unpopular Front",
    type: "Blog",
    url: "https://www.unpopularfront.news/feed"
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
    url: "https://maxread.substack.com/feed"
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
  const response = await fetchFeedUrl(feed.url);

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
