import express from "express";
import { XMLParser } from "fast-xml-parser";

const app = express();
const port = process.env.PORT || 3000;

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
    url: "https://adamtooze.substack.com/feed"
  },
  {
    id: "john-ganz",
    author: "John Ganz",
    outlet: "Unpopular Front",
    type: "Blog",
    url: "https://www.unpopularfront.news/feed"
  }
];

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  htmlEntities: true
});

let cache = {
  fetchedAt: 0,
  payload: null
};

const CACHE_TTL_MS = 10 * 60 * 1000;

app.use(express.static("public"));

app.get("/api/sources", (_req, res) => {
  res.json(feeds.map(({ id, author, outlet, type, url }) => ({ id, author, outlet, type, url })));
});

app.get("/api/posts", async (req, res) => {
  const force = req.query.refresh === "1";

  if (!force && cache.payload && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    res.json({ ...cache.payload, cached: true });
    return;
  }

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

  const payload = {
    fetchedAt: new Date().toISOString(),
    posts,
    errors
  };

  cache = {
    fetchedAt: Date.now(),
    payload
  };

  res.json({ ...payload, cached: false });
});

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: {
      "user-agent": "FavoriteWritersReader/1.0 (+local personal RSS reader)",
      accept: "application/rss+xml, application/xml, text/xml"
    }
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml);
  const channel = parsed.rss?.channel || parsed.feed || {};
  const items = asArray(channel.item || channel.entry);

  return items.slice(0, 12).map((item) => normalizeItem(item, feed));
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

app.listen(port, () => {
  console.log(`Favorite writers reader running at http://localhost:${port}`);
});
