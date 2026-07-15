// config.js
class Config {
  constructor() {
    this.minPageCount = 20;
    this.minFavoriteCount = 0;
    this.minViewCount = 1000;
    this.excludeAI = false;
    this.excludeTags = [
      "ロリ",
      "loli",
      "ふたなり",
      "男の娘",
      "ショタ",
      "ホモ",
      "ゲイ",
      "BL",
      "リョナ",
      "ボテ腹",
      "爆乳",
      "おねショタ"
    ];
  }
}

// search-query.js
class SearchQuery {
  constructor({
    word,
    page = 1,
    order = "date_d",
    mode = "r18",
    aiType = 0,
    csw = 0,
    sMode = "s_tag_tc",
    ratio = "",
    lang = "ja"
  }) {
    this.word = word;
    this.page = page;
    this.order = order;
    this.mode = mode;
    this.aiType = aiType;
    this.csw = csw;
    this.sMode = sMode;
    this.ratio = ratio;
    this.lang = lang;
  }
  static fromLocation() {
    const url = new URL(location.href);
    const tagMatch = url.pathname.match(/^\/tags\/([^/]+)(?:\/artworks)?\/?$/);
    const isTagSearch = Boolean(tagMatch);
    const rawSMode = url.searchParams.get("s_mode") ?? "tag_tc";
    const sMode = isTagSearch
      ? "s_tag_full"
      : (rawSMode.startsWith("s_") ? rawSMode : `s_${rawSMode}`);
    const word = isTagSearch
      ? decodeURIComponent(tagMatch[1])
      : (url.searchParams.get("q") ?? "");
    return new SearchQuery({
      word,
      page: Number(url.searchParams.get("p") ?? 1),
      order: url.searchParams.get("order") ?? "date_d",
      mode: url.searchParams.get("mode") ?? "r18",
      aiType: Number(url.searchParams.get("ai_type") ?? 0),
      csw: Number(url.searchParams.get("csw") ?? 0),
      sMode,
      ratio: url.searchParams.get("ratio") ?? "",
      lang: url.searchParams.get("lang") ?? "ja"
    });
  }
  clone(values = {}) {
    return new SearchQuery({
      ...this,
      ...values
    });
  }
}

// pixiv-client.js
class PixivClient {
  constructor({
    retryDelayMs = 400,
    maxRetries = 0,
    requestIntervalMs = 200
  } = {}) {
    this.retryDelayMs = retryDelayMs;
    this.maxRetries = maxRetries;
    this.requestIntervalMs = requestIntervalMs;
    // 次回リクエスト可能時刻
    this.nextRequestTime = performance.now();
    // シリアル実行キュー
    this.requestQueue = Promise.resolve();
  }
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  async waitForInterval() {
    const now = performance.now();
    if (this.nextRequestTime > now) {
      await this.delay(this.nextRequestTime - now);
    }
    // 次回開始可能時刻を更新
    this.nextRequestTime = performance.now() + this.requestIntervalMs;
  }
  enqueue(task) {
    const promise = this.requestQueue.then(async () => {
      await this.waitForInterval();
      return task();
    });
    // エラーでもキューが止まらないようにする
    this.requestQueue = promise.catch(() => { });
    return promise;
  }
  createUrl(query) {
    const url = new URL(`https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(query.word)}`);
    url.searchParams.set("order", query.order);
    url.searchParams.set("mode", query.mode);
    url.searchParams.set("p", query.page);
    url.searchParams.set("ai_type", query.aiType);
    url.searchParams.set("csw", query.csw);
    url.searchParams.set("s_mode", query.sMode || "s_tag_tc");
    url.searchParams.set("ratio", query.ratio);
    url.searchParams.set("lang", query.lang);
    return url;
  }
  normalizeWork(item) {
    return {
      id: item.id,
      title: item.title,
      imageUrl: item.url,
      pageCount: item.pageCount,
      width: item.width,
      height: item.height,
      tags: item.tags,
      userId: item.userId,
      userName: item.userName,
      aiType: item.aiType,
      xRestrict: item.xRestrict,
      restrict: item.restrict,
      illustType: item.illustType,
      createDate: item.createDate,
      updateDate: item.updateDate,
      profileImageUrl: item.profileImageUrl,
      isOriginal: item.isOriginal,
      description: item.description,
      alt: item.alt,
      isAd: item.isAdContainer === true
    };
  }
  async search(query) {
    const response = await fetch(this.createUrl(query), {
      credentials: "same-origin"
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    if (json.error) {
      throw new Error(json.message);
    }
    const body = json.body?.illustManga;
    if (!body) {
      throw new Error("Invalid response.");
    }
    return {
      page: query.page,
      total: body.total,
      lastPage: body.lastPage,
      hasNext: query.page < body.lastPage,
      works: body.data
        .filter(item => !item.isAdContainer)
        .map(item => this.normalizeWork(item))
    };
  }
  async getWorkDetails(id) {
    return this.enqueue(async () => {
      for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
        try {
          const response = await fetch(
            `https://www.pixiv.net/touch/ajax/illust/details?illust_id=${id}`,
            {
              credentials: "omit"
            }
          );
          if (!response.ok) {
            if (response.status === 429 || response.status >= 500) {
              throw new Error(`HTTP ${response.status}`);
            }
            return {
              favoriteCount: "-",
              viewCount: "-"
            };
          }
          const json = await response.json();
          const details = json.body?.illust_details ?? json.body ?? {};
          return {
            favoriteCount: Number(details.bookmark_user_total ?? 0),
            viewCount:
              Number(
                String(details.rating_view ?? "0").replace(/[^0-9.-]/g, "")
              ) || 0
          };
        } catch (error) {
          if (attempt < this.maxRetries) {
            await this.delay(this.retryDelayMs * (attempt + 1));
            continue;
          }
          return {
            favoriteCount: "-",
            viewCount: "-"
          };
        }
      }
      return {
        favoriteCount: "-",
        viewCount: "-"
      };
    });
  }
}

// filter.js
class Filter {
  constructor(config, client) {
    this.config = config;
    this.client = client;
  }
  async apply(works) {
    const filtered = [];
    for (const work of works) {
      if (await this.accept(work)) {
        filtered.push(work);
      }
    }
    return filtered;
  }
  async accept(work) {
    if (!this.isAdAllowed(work) ||
      !this.isAiAllowed(work) ||
      !this.meetsPageCount(work) ||
      !this.isTagAllowed(work)) {
      return false;
    }
    return await this.hasMinimumCounts(work);
  }
  isAdAllowed(work) {
    return !work.isAd;
  }
  isAiAllowed(work) {
    if (!this.config.excludeAI) return true;
    return work.aiType !== 2;
  }
  meetsPageCount(work) {
    return work.pageCount >= this.config.minPageCount;
  }
  isTagAllowed(work) {
    if (this.config.excludeTags.length === 0) return true;
    const tags = Array.isArray(work.tags) ? work.tags : [];
    return !tags.some(tag => this.config.excludeTags.includes(tag));
  }
  async hasMinimumCounts(work) {
    const details = await this.client.getWorkDetails(work.id);
    work.favoriteCount = details.favoriteCount ?? '-';
    work.viewCount = details.viewCount ?? '-';

    if (this.config.minFavoriteCount > 0 && work.favoriteCount !== '-' && work.favoriteCount < this.config.minFavoriteCount) {
      return false;
    }
    if (this.config.minViewCount > 0 && work.viewCount !== '-' && work.viewCount < this.config.minViewCount) {
      return false;
    }
    return true;
  }
}

// pixiv-dom.js
class PixivDom {
  getGrid() {
    return document.querySelector("div.m-0.p-0.gap-0.grid.grid-cols-3.grid-flow-dense");
  }
  getTemplate(grid) {
    const template = grid.firstElementChild?.cloneNode(true);
    if (!template) {
      throw new Error("Template not found.");
    }
    return template;
  }
  getLink(node) {
    return node.querySelector("a");
  }
  getImage(node) {
    return node.querySelector("img");
  }
  getImageContainer(node) {
    return node.querySelector("img")?.closest("div");
  }
  getPagination() {
    return [...document.querySelectorAll("nav")]
      .find(nav => nav.querySelector("[aria-current='true']"));
  }
  removePageCount(node) {
    node.querySelector(".sc-e414e6ba-16")?.remove();
  }
  removeBadge(node) {
    node.querySelector(".sc-e414e6ba-9")?.remove();
  }
  removeAds() {
    document.querySelectorAll('[id^="adsdk"]')
      .forEach(el => el.remove());
    document.querySelectorAll('[class^="mb-16"]')
      .forEach(el => el.remove());
    document.querySelectorAll('.mt-36')
      .forEach(el => el.remove());
    document.querySelectorAll('div[style^="display: block"]')
      .forEach(e => e.remove());
    document.querySelectorAll('div[class="w-full"]').
      forEach(div => div.remove());
  }
  startAdGuard() {
    this.removeAds();
    const observer = new MutationObserver(() => {
      this.removeAds();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
    return observer;
  }
}

// renderer.js
class Renderer {
  constructor(dom) {
    this.dom = dom;
    this.grid = dom.getGrid();
    this.template = dom.getTemplate(this.grid);
  }
  clear() {
    this.grid.replaceChildren();
  }
  create(work) {
    const node = this.template.cloneNode(true);
    this.updateLink(node, work);
    this.updateImage(node, work);
    this.cleanup(node);
    this.addStats(node, work);
    return node;
  }
  updateLink(node, work) {
    node.dataset.ga4EntityId = `illust/${work.id}`;
    const link = this.dom.getLink(node);
    if (!link) return;
    link.href = `/artworks/${work.id}`;
    link.dataset.gtmValue = work.id;
  }
  updateImage(node, work) {
    const img = this.dom.getImage(node);
    if (!img) return;
    img.src = work.imageUrl;
    img.alt = work.alt;
  }
  cleanup(node) {
    this.dom.removePageCount(node);
    this.dom.removeBadge(node);
  }
  addStats(node, work) {
    const container = this.dom.getImageContainer(node);
    if (!container) return;
    container.style.position = "relative";
    container.style.display = "block";
    container.style.overflow = "hidden";
    let overlay = container.querySelector(".pe-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "pe-overlay";
      container.appendChild(overlay);
    }
    overlay.replaceChildren();
    this.appendStat(overlay, "page", `📖 ${Number(work.pageCount ?? 0).toLocaleString()}`, "ページ数");
    this.appendStat(overlay, "favorite", `♥ ${work.favoriteCount ?? '-'}`, "お気に入り数");
    this.appendStat(overlay, "view", `👁 ${work.viewCount ?? '-'}`, "閲覧回数");
  }
  appendStat(overlay, kind, text, label) {
    const stat = document.createElement("div");
    stat.className = `pe-stat pe-stat--${kind}`;
    stat.setAttribute("title", label);
    stat.textContent = text;
    overlay.appendChild(stat);
  }
  append(work) {
    this.grid.appendChild(this.create(work));
  }
  appendAll(works) {
    const fragment = document.createDocumentFragment();
    works.forEach(work => {
      fragment.appendChild(this.create(work));
    });
    this.grid.appendChild(fragment);
  }
  getLoadingElement() {
    let el = document.querySelector(".pe-loading");
    if (!el) {
      el = document.createElement("div");
      el.className = "pe-loading";
      el.hidden = true;
      el.textContent = "⏳ 次ページを読み込み中...";
      this.insertElement(el, ".pe-progress", ".pe-loading");
    }
    return el;
  }
  getProgressElement() {
    let el = document.querySelector(".pe-progress");
    if (!el) {
      el = document.createElement("div");
      el.className = "pe-progress";
      this.insertElement(el, ".pe-progress", ".pe-loading");
    }
    return el;
  }
  insertElement(el, beforeSelector, afterSelector) {
    const beforeTarget = document.querySelector(beforeSelector);
    const afterTarget = document.querySelector(afterSelector);
    if (beforeTarget) {
      beforeTarget.before(el);
      return;
    }
    if (afterTarget) {
      afterTarget.after(el);
      return;
    }
    const anchor = this.dom.getPagination() || document.body;
    if (anchor.before) {
      anchor.before(el);
    } else {
      anchor.appendChild(el);
    }
  }
  showLoading() {
    this.getLoadingElement().hidden = false;
  }
  hideLoading() {
    this.getLoadingElement().hidden = true;
  }
  updateProgress(current, last) {
    this.getProgressElement().textContent =
      `${current} / ${last} ページ読込済み`;
  }
}

// pager.js
class Pager {
  constructor(query, client, filter, renderer, dom) {
    this.baseQuery = query;
    this.client = client;
    this.filter = filter;
    this.renderer = renderer;
    this.dom = dom;
    this.currentPage = query.page - 1;
    this.lastPage = Infinity;
    this.loading = false;
    this.loadingPage = null;
    this.loadedIds = new Set();
    this.pagination = null;
    this.scrollHandler = null;
    this.ticking = false;
  }
  init() {
    this.pagination = this.dom.getPagination();
  }
  createQuery(page) {
    return this.baseQuery.clone({ page });
  }
  async load(page) {
    if (this.loading || page > this.lastPage) return;
    this.loading = true;
    this.loadingPage = page;
    this.renderer.showLoading();
    try {
      const result = await this.client.search(this.createQuery(page));
      if (this.loadingPage !== page) return;
      this.lastPage = result.lastPage;
      const works = (await this.filter.apply(result.works)).filter(work => {
        if (this.loadedIds.has(work.id)) return false;
        this.loadedIds.add(work.id);
        return true;
      });
      this.renderer.appendAll(works);
      this.currentPage = page;
      this.renderer.updateProgress(
        this.currentPage,
        this.lastPage
      );
      this.pagination = this.dom.getPagination();
      this.handleScroll();
    } finally {
      this.renderer.hideLoading();
      this.loading = false;
      this.loadingPage = null;
    }
  }
  async loadCurrent() {
    this.renderer.clear();
    this.loadedIds.clear();
    this.currentPage = this.baseQuery.page - 1;
    this.lastPage = Infinity;
    await this.load(this.currentPage + 1);
  }
  async loadNext() {
    if (this.currentPage >= this.lastPage) return;
    await this.load(this.currentPage + 1);
  }
  handleScroll() {
    if (this.loading || this.currentPage >= this.lastPage) return;
    const pagination = this.pagination || this.dom.getPagination();
    if (!pagination) return;
    this.pagination = pagination;
    const rect = this.pagination.getBoundingClientRect();
    if (rect.top <= window.innerHeight && rect.bottom >= 0) {
      this.loadNext();
    }
  }
  start() {
    this.scrollHandler = () => {
      if (this.ticking) return;
      this.ticking = true;
      requestAnimationFrame(() => {
        this.ticking = false;
        this.handleScroll();
      });
    };
    window.addEventListener("scroll", this.scrollHandler, {
      passive: true
    });
    this.handleScroll();
  }
}

// main.js
function injectStyle() {
  if (document.getElementById("pe-style")) return;
  const style = document.createElement("style");
  style.id = "pe-style";
  style.textContent = `
.pe-overlay{
  position:absolute;
  top:2px;
  right:2px;
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  gap:2px;
  z-index:999;
  pointer-events:none;
}
.pe-stat{
  display:flex;
  align-items:center;
  gap:4px;
  background:rgba(0,0,0,.6);
  color:#fff;
  font-size:10px;
  font-weight:bold;
  line-height:1;
  border-radius:4px;
  white-space:nowrap;
}
.pe-stat--favorite{
  color:#ff7ea8;
}
.pe-stat--view{
  color:#7ec8ff;
}
.pe-loading,
.pe-progress{
  margin:4px 0;
  text-align:center;
  font-size:14px;
  color:#666;
  font-weight:bold;
}`;
  document.head.appendChild(style);
}
(async () => {
  injectStyle();
  const config = new Config();
  const dom = new PixivDom();
  const query = SearchQuery.fromLocation();
  const client = new PixivClient({
    maxConcurrent: 1,
    retryDelayMs: 500,
    maxRetries: 0
  });
  const filter = new Filter(config, client);
  const renderer = new Renderer(dom);
  const pager = new Pager(query, client, filter, renderer, dom);
  dom.startAdGuard();
  pager.init();
  await pager.loadCurrent();
  pager.start();
  window.pixiv = {
    config,
    query,
    client,
    filter,
    renderer,
    pager
  };
})();
