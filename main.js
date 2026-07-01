// config.js
class Config {
  constructor() {
    this.minPageCount = 30;
    this.excludeAI = false;
    this.excludeTags = [
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
    return new SearchQuery({
      word: url.searchParams.get("q") ?? "",
      page: Number(url.searchParams.get("p") ?? 1),
      order: url.searchParams.get("order") ?? "date_d",
      mode: url.searchParams.get("mode") ?? "r18",
      aiType: Number(url.searchParams.get("ai_type") ?? 0),
      csw: Number(url.searchParams.get("csw") ?? 0),
      sMode: url.searchParams.get("s_mode") ?? "s_tag_tc",
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
  createUrl(query) {
    const url = new URL(`https://www.pixiv.net/ajax/search/artworks/${encodeURIComponent(query.word)}`);
    url.searchParams.set("order", query.order);
    url.searchParams.set("mode", query.mode);
    url.searchParams.set("p", query.page);
    url.searchParams.set("ai_type", query.aiType);
    url.searchParams.set("csw", query.csw);
    url.searchParams.set("s_mode", "s_tag_tc");
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
    console.log("Start API");
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
    console.log("End API");
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
}

// filter.js
class Filter {
  constructor(config) {
    this.config = config;
  }
  apply(works) {
    return works.filter(work => this.accept(work));
  }
  accept(work) {
    return this.ad(work)
      && this.ai(work)
      && this.pageCount(work)
      && this.tags(work);
  }
  ad(work) {
    return !work.isAd;
  }
  ai(work) {
    if (!this.config.excludeAI) return true;
    return work.aiType !== 2;
  }
  pageCount(work) {
    return work.pageCount >= this.config.minPageCount;
  }
  tags(work) {
    if (this.config.excludeTags.length === 0) return true;
    return !work.tags.some(tag => this.config.excludeTags.includes(tag));
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
    return node.querySelector(".gutbuO");
  }
  getPagination() {
    return [...document.querySelectorAll("nav")]
      .find(nav => nav.querySelector("[aria-current='true']"));
  }
  removePageCount(node) {
    node.querySelector(".sc-45073218-16")?.remove();
  }
  removeAiLabel(node) {
    node.querySelector(".sc-45073218-15")?.remove();
  }
  removeBadge(node) {
    node.querySelector(".sc-45073218-9")?.remove();
  }
  removeAds(){
    document.querySelectorAll('[id^="adsdk"]')
      .forEach(el => el.remove());
    document.querySelectorAll('[class^="mb-16"]')
      .forEach(el => el.remove());
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
    this.addPageCount(node, work.pageCount);
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
    this.dom.removeAiLabel(node);
    this.dom.removePageCount(node);
    this.dom.removeBadge(node);
  }
  addPageCount(node, pageCount) {
    const container = this.dom.getImageContainer(node);
    if (!container) return;
    let overlay = container.querySelector(".pe-overlay");
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.className = "pe-overlay";
      container.appendChild(overlay);
    }
    const page = document.createElement("div");
    page.className = "pe-page";
    page.textContent = pageCount;
    overlay.appendChild(page);
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
  moveSentinel(sentinel) {
    this.grid.appendChild(sentinel);
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
    this.loadedIds = new Set();
    this.observer = null;
    this.sentinel = null;
    this.pagination = null;
  }
  init() {
    this.sentinel = document.createElement("div");
    this.sentinel.className = "pe-sentinel";
    this.sentinel.style.height = "1px";
    this.renderer.grid.appendChild(this.sentinel);
  }
  createQuery(page) {
    return this.baseQuery.clone({ page });
  }
  async load(page) {
    const result = await this.client.search(this.createQuery(page));
    this.lastPage = result.lastPage;
    const works = this.filter.apply(result.works).filter(work => {
      if (this.loadedIds.has(work.id)) return false;
      this.loadedIds.add(work.id);
      return true;
    });
    this.renderer.appendAll(works);
    this.renderer.moveSentinel(this.sentinel);
    this.currentPage = page;
    console.log(`Page ${page}: ${works.length}/${result.works.length}`);
  }
  async loadCurrent() {
    this.renderer.clear();
    this.loadedIds.clear();
    this.currentPage = this.baseQuery.page - 1;
    this.lastPage = Infinity;
    await this.load(this.currentPage + 1);
  }
  async loadNext() {
    console.log("Call loadNext");
    if (this.loading) return;
    if (this.currentPage >= this.lastPage) return;
    this.loading = true;
    try {
      await this.load(this.currentPage + 1);
    } catch (e) {
      console.error(e);
    } finally {
      this.loading = false;
    }
  }
  start() {
    this.observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) {
        this.loadNext();
      }
    }, {
      rootMargin: "300px"
    });
    this.observer.observe(this.sentinel);
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
top:4px;
right:4px;
display:flex;
flex-direction:column;
align-items:flex-end;
gap:2px;
z-index:999;
pointer-events:none;
}
.pe-page{
padding:2px 6px;
background:rgba(0,0,0,.8);
color:#fff;
font-size:12px;
font-weight:bold;
line-height:1;
border-radius:4px;
}`;
  document.head.appendChild(style);
}
(async () => {
  injectStyle();
  const config = new Config();
  const dom = new PixivDom();
  const query = SearchQuery.fromLocation();
  const client = new PixivClient();
  const filter = new Filter(config);
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

