const READ_STORAGE_KEY = "favorite-writers-reader:read-ids";

const state = {
  posts: [],
  authors: new Set(),
  readIds: loadReadIds(),
  query: "",
  source: "all",
  readFilter: "all",
  loading: false
};

const authorOrder = ["Ross Douthat", "Jamelle Bouie", "David French", "Adam Tooze", "John Ganz"];

const postsEl = document.querySelector("#posts");
const authorFiltersEl = document.querySelector("#authorFilters");
const searchInput = document.querySelector("#searchInput");
const sourceFilters = document.querySelector("#sourceFilters");
const readFilters = document.querySelector("#readFilters");
const refreshButton = document.querySelector("#refreshButton");
const statusText = document.querySelector("#statusText");
const readCountText = document.querySelector("#readCountText");
const updatedText = document.querySelector("#updatedText");
const countBadge = document.querySelector("#countBadge");
const emptyState = document.querySelector("#emptyState");
const errorStrip = document.querySelector("#errorStrip");

loadPosts();

refreshButton.addEventListener("click", () => loadPosts(true));
searchInput.addEventListener("input", (event) => {
  state.query = event.target.value.trim().toLowerCase();
  render();
});

sourceFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.source = button.dataset.source;
  sourceFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  render();
});

readFilters.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  state.readFilter = button.dataset.read;
  readFilters.querySelectorAll("button").forEach((item) => item.classList.toggle("active", item === button));
  render();
});

postsEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-read-toggle]");
  if (!button) return;
  toggleRead(button.dataset.readToggle);
});

async function loadPosts(force = false) {
  setLoading(true);

  try {
    const response = await fetch(`data/posts.json${force ? `?t=${Date.now()}` : ""}`);
    if (!response.ok) throw new Error("Falha ao buscar feeds");
    const data = await response.json();
    state.posts = data.posts;

    if (state.authors.size === 0) {
      data.posts.forEach((post) => state.authors.add(post.author));
      renderAuthorFilters();
    }

    statusText.textContent = "Mostrando o snapshot mais recente publicado.";
    updatedText.textContent = `Atualizado em ${formatDateTime(data.fetchedAt)}`;
    renderErrors(data.errors);
    render();
  } catch (error) {
    statusText.textContent = "Não consegui carregar os feeds agora.";
    renderErrors([{ source: "Reader", message: error.message }]);
  } finally {
    setLoading(false);
  }
}

function renderAuthorFilters() {
  const authors = authorOrder.filter((author) => state.authors.has(author));
  authorFiltersEl.innerHTML = authors
    .map(
      (author) => `
        <label class="check-row">
          <input type="checkbox" value="${escapeHtml(author)}" checked />
          <span>${escapeHtml(author)}</span>
        </label>
      `
    )
    .join("");

  authorFiltersEl.addEventListener("change", () => {
    state.authors = new Set(
      [...authorFiltersEl.querySelectorAll("input:checked")].map((input) => input.value)
    );
    render();
  });
}

function render() {
  const filtered = state.posts.filter((post) => {
    const matchesAuthor = state.authors.has(post.author);
    const matchesSource =
      state.source === "all" ||
      post.outlet === state.source ||
      (state.source === "Substack" && post.outlet !== "The New York Times");
    const read = state.readIds.has(post.id);
    const matchesRead =
      state.readFilter === "all" ||
      (state.readFilter === "read" && read) ||
      (state.readFilter === "unread" && !read);
    const haystack = `${post.title} ${post.description} ${post.author} ${post.outlet}`.toLowerCase();
    const matchesQuery = !state.query || haystack.includes(state.query);
    return matchesAuthor && matchesSource && matchesRead && matchesQuery;
  });

  countBadge.textContent = filtered.length;
  renderReadCount();
  emptyState.classList.toggle("hidden", filtered.length > 0);
  postsEl.innerHTML = filtered.map(renderPost).join("");
}

function renderPost(post) {
  const read = state.readIds.has(post.id);
  const image = post.image
    ? `<img class="thumb" src="${post.image}" alt="" loading="lazy" referrerpolicy="no-referrer" />`
    : "";

  return `
    <article class="post ${image ? "" : "no-image"} ${read ? "is-read" : ""}">
      <div>
        <div class="post-meta">
          <span class="pill">${escapeHtml(post.author)}</span>
          <span>${escapeHtml(post.outlet)}</span>
          <span>${formatDate(post.publishedAt)}</span>
          ${read ? '<span class="read-status">Lido</span>' : ""}
        </div>
        <h3><a href="${post.link}" target="_blank" rel="noreferrer">${escapeHtml(post.title)}</a></h3>
        <p>${escapeHtml(post.description || "Sem resumo no feed.")}</p>
        <div class="post-actions">
          <a class="read-link" href="${post.link}" target="_blank" rel="noreferrer">Abrir artigo</a>
          <button class="mark-read" type="button" data-read-toggle="${escapeHtml(post.id)}">
            ${read ? "Marcar como não lido" : "Marcar como lido"}
          </button>
        </div>
      </div>
      ${image}
    </article>
  `;
}

function toggleRead(id) {
  if (state.readIds.has(id)) {
    state.readIds.delete(id);
  } else {
    state.readIds.add(id);
  }

  saveReadIds();
  render();
}

function renderReadCount() {
  const readCount = state.posts.filter((post) => state.readIds.has(post.id)).length;
  const total = state.posts.length;
  readCountText.textContent = total ? `${readCount} de ${total} marcados como lidos.` : "";
}

function renderErrors(errors = []) {
  if (!errors.length) {
    errorStrip.classList.add("hidden");
    errorStrip.textContent = "";
    return;
  }

  errorStrip.classList.remove("hidden");
  errorStrip.textContent = errors.map((error) => `${error.source}: ${error.message}`).join(" | ");
}

function setLoading(loading) {
  state.loading = loading;
  refreshButton.disabled = loading;
  refreshButton.classList.toggle("loading", loading);
}

function loadReadIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(READ_STORAGE_KEY) || "[]"));
  } catch {
    return new Set();
  }
}

function saveReadIds() {
  localStorage.setItem(READ_STORAGE_KEY, JSON.stringify([...state.readIds]));
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
